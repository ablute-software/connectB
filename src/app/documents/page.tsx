'use client';
// Documents & Data Room — folder tree, documents with visibility attributes, grants, engagement
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card, PersonLink } from '@/components/ui';
import { useConfirm } from '@/lib/confirm';
import type { DocVisibility, Folder, FolderKind } from '@/lib/types';
import {
  collectFolderSelectionKeys, cycleGrantState,
  dueDiligenceUnderFolders, normalizeDocumentUrl, reorderByDrag, sanitizeStorageKey, type GrantState,
} from '@/lib/data-room';
import { grantStatus } from '@/lib/access-grants';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { entityStatusChip, passedNote, everyoneDncWarning } from '@/lib/grantee-warnings';
import { PeopleAccessPanel } from '@/components/documents/PeopleAccessPanel';
import { WhoHasAccessPanel } from '@/components/documents/WhoHasAccessPanel';
import { VaultKillSwitch } from '@/components/documents/VaultKillSwitch';
import { PageTour } from '@/components/onboarding/PageTour';
import { vaultAccessAdvice } from '@/lib/vault-access-advice';
import { VaultPinGate } from '@/components/documents/VaultPinGate';
import { VaultPrivacyNoticeModal } from '@/components/documents/VaultPrivacyNoticeModal';
import { isVaultPrivacyNoticeDue, readDemoVaultPrivacyNotice, writeDemoVaultPrivacyNotice } from '@/lib/vault-privacy-notice';
import { useTrackPageView } from '@/lib/use-track-page-view';

function fmtBytes(n?: number): string | undefined {
  if (n == null) return undefined;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

// Prompt 437 §D — presentation-only (the pure vaultAccessAdvice returns
// entities, never a formatted sentence), so the join lives with the page,
// not the lib.
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// P103 Bloco 3 — lock icon per visibility level, replacing the old plain
// text label. due_diligence keeps computeCellEffect's existing "no grant
// can ever have an effect here" behavior (was 'private') — the icon/name
// change alone, no new "confirmed meeting" gate is enforced here (not
// concretely specified anywhere; flagging back rather than inventing it).
const VISIBILITY_META: Record<DocVisibility, { icon: string; label: string; title: string }> = {
  due_diligence: { icon: '🔴🔒', label: 'Due diligence only', title: 'Due diligence only — fully closed, requires an access request' },
  on_grant: { icon: '🟡🔓', label: 'On request', title: 'On request — simple access grant needed' },
  open: { icon: '🟢🔓✕', label: 'Open', title: 'Openly shareable — still only reaches whoever you grant access to' },
};
const VISIBILITY_OPTIONS: DocVisibility[] = ['open', 'on_grant', 'due_diligence'];

interface PendingAccessRequest {
  id: string; requesterName: string | null; requesterEmail: string | null;
  folderNames: string[]; documentNames: string[]; requestedAt: string;
  // Prompt 518 §1 — how many items are still waiting, for requests whose
  // asks live in access_request_items rather than the flat arrays.
  pendingItemCount?: number;
}

export default function DocumentsPage() {
  useTrackPageView('/documents');
  const { db } = useStore();
  // Prompt 103 Bloco 2 — gate the whole page (both tabs) behind the Vault
  // Data Room PIN. A separate top-level component so the gate's own RPC
  // round-trip doesn't block the rest of this file's hooks from running
  // before db.org.id is known.
  // Prompt 398 §3.3 — Suspense wraps the useSearchParams() read inside
  // DocumentsPageInner (?grantFor=<entityId> deep-link), required by
  // Next.js for any client component that reads search params.
  return (
    <Suspense fallback={null}>
      <VaultPinGate orgId={db.org.id}>
        <DocumentsPageInner />
      </VaultPinGate>
    </Suspense>
  );
}

function DocumentsPageInner() {
  const {
    db, addDocument, deleteDocument, renameDocument, updateDocumentDetails, updateDocumentVisibility,
    moveDocumentToFolder, reorderDocuments, replaceDocumentFile, addDocumentVersion,
    createFolder, renameFolder, deleteFolder, addGrant, revokeGrant, recordNdaUpload,
    invitePersonForGrant,
  } = useStore();
  const confirm = useConfirm();
  // P78 Bloco 1 — "sit alongside Documents & Data Room", read as a tab
  // within the same page area rather than a separate route: both views
  // read the same useStore() db, just organized differently (folder-first
  // vs. person-first).
  const [tab, setTab] = useState<'documents' | 'people'>('documents');
  const [selFolder, setSelFolder] = useState<string>('');
  const [storageSizes, setStorageSizes] = useState<Record<string, number>>({});
  const [documentDetailsAvailable, setDocumentDetailsAvailable] = useState(false);
  const [ndaSystemAvailable, setNdaSystemAvailable] = useState(false);
  const [documentOrderingAvailable, setDocumentOrderingAvailable] = useState(false);
  const [documentVersionsAvailable, setDocumentVersionsAvailable] = useState(false);
  // Item 1 (Lote E) step 5 — pending access_requests for this org, the
  // founder-side half of the request/grant cycle (the investor-side write
  // and the guest-token preview flow already shipped; this was the one
  // still-stalled piece, confirmed in scope by Nuno).
  const [pendingAccessRequests, setPendingAccessRequests] = useState<PendingAccessRequest[]>([]);
  // E5 drag-and-drop state. `dragDocId` is the document currently being
  // dragged (reorder within a folder, or move onto a folder node in the
  // tree); `dragOverDocId` / `dragOverFolderId` drive the drop-target
  // highlight. `replacingDocId` is set while a per-document file swap uploads.
  const [dragDocId, setDragDocId] = useState<string | null>(null);
  const [dragOverDocId, setDragOverDocId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);
  // E6 — collapsed folder ids, persisted per org in localStorage so the tree
  // shape survives reloads. Keyed by org id (falls back to 'demo' when unset).
  const collapseKey = `dataroom-collapsed-${db.org.id || 'demo'}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapseLoaded, setCollapseLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => {
      setDocumentDetailsAvailable(!!me.capabilities?.documentDetails);
      setNdaSystemAvailable(!!me.capabilities?.ndaSystem);
      setDocumentOrderingAvailable(!!me.capabilities?.documentOrdering);
      setDocumentVersionsAvailable(!!me.capabilities?.documentVersions);
    }).catch(() => {});
  }, []);

  // Item 1 (Lote E) step 5 — reload whenever the org id resolves (real
  // Supabase mode; demo mode never has a real org id here, and the fetch
  // below just no-ops on a 400/404, same as every other org-scoped fetch
  // already in this file).
  function loadPendingAccessRequests() {
    if (!db.org.id) return;
    fetch(`/api/data-room/access-requests?orgId=${db.org.id}`).then((r) => r.json())
      .then((body) => setPendingAccessRequests(body.requests ?? [])).catch(() => {});
  }
  useEffect(loadPendingAccessRequests, [db.org.id]);

  // Prompt 403 §A / 404 §A — per-USER Vault privacy notice (not gated by
  // org.id: keyed by auth user, so it fires independently for every
  // member the first time THEY personally open this page, even into a
  // Vault that already has months of history and other members who
  // already dismissed it). Runs once on mount; T0 (first_shown_at) is
  // captured on this same read the first time it's null, per 403 §A.2's
  // own "simplifies the client" option.
  const [vaultNoticeOpen, setVaultNoticeOpen] = useState(false);
  const [vaultNoticeUserId, setVaultNoticeUserId] = useState<string | null>(null);
  const [vaultNoticeFirstShownAt, setVaultNoticeFirstShownAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const now = new Date();
      if (!authEnabled) {
        const state = readDemoVaultPrivacyNotice();
        if (!isVaultPrivacyNoticeDue(state.firstShownAt, state.lastShownAt, now)) return;
        const firstShownAt = state.firstShownAt ?? now;
        writeDemoVaultPrivacyNotice({ firstShownAt, lastShownAt: state.lastShownAt });
        if (!cancelled) { setVaultNoticeFirstShownAt(firstShownAt); setVaultNoticeOpen(true); }
        return;
      }
      try {
        const sb = browserClient();
        const { data: userData } = await sb.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) return;
        const { data } = await sb.from('vault_privacy_notice_state')
          .select('first_shown_at, last_shown_at').eq('user_id', userId).maybeSingle();
        const firstShownAt = data?.first_shown_at ? new Date(data.first_shown_at) : null;
        const lastShownAt = data?.last_shown_at ? new Date(data.last_shown_at) : null;
        if (!isVaultPrivacyNoticeDue(firstShownAt, lastShownAt, now)) return;
        const resolvedFirstShownAt = firstShownAt ?? now;
        if (!firstShownAt) {
          await sb.from('vault_privacy_notice_state')
            .upsert({ user_id: userId, first_shown_at: resolvedFirstShownAt.toISOString() });
        }
        if (!cancelled) {
          setVaultNoticeUserId(userId);
          setVaultNoticeFirstShownAt(resolvedFirstShownAt);
          setVaultNoticeOpen(true);
        }
      } catch { /* best-effort — never blocks the page */ }
    }
    run();
    return () => { cancelled = true; };
  }, []);

  async function acknowledgeVaultNotice() {
    setVaultNoticeOpen(false);
    const now = new Date();
    const firstShownAt = vaultNoticeFirstShownAt ?? now;
    if (!authEnabled) {
      writeDemoVaultPrivacyNotice({ firstShownAt, lastShownAt: now });
      return;
    }
    if (!vaultNoticeUserId) return;
    try {
      await browserClient().from('vault_privacy_notice_state')
        .upsert({ user_id: vaultNoticeUserId, first_shown_at: firstShownAt.toISOString(), last_shown_at: now.toISOString() });
    } catch { /* best-effort */ }
  }

  // Load persisted collapse state once the org id is known.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      setCollapsed(new Set(raw ? (JSON.parse(raw) as string[]) : []));
    } catch { setCollapsed(new Set()); }
    setCollapseLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseKey]);

  useEffect(() => {
    if (!collapseLoaded) return;
    try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* quota / private mode */ }
  }, [collapsed, collapseKey, collapseLoaded]);

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Folder ids differ between demo seed data and real Supabase UUIDs, so the
  // default can't be a hardcoded id — pick "Investor deck" by name once
  // folders have loaded, falling back to whatever folder exists first.
  useEffect(() => {
    if (selFolder || db.folders.length === 0) return;
    const preferred = db.folders.find((f) => f.name === 'Investor deck') ?? db.folders[0];
    if (preferred) setSelFolder(preferred.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.folders]);
  const [docName, setDocName] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docErr, setDocErr] = useState('');
  // P103 Bloco 3 — visibility used to be hardcoded to 'on_grant' on every
  // add path (link or upload), no UI to choose it. Shared by both add
  // flows below since they sit in the same "add to this folder" context.
  const [docVisibility, setDocVisibility] = useState<DocVisibility>('on_grant');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Grant Access rebuild (prompt 33 part 2 / 47) — stepped flow: entity
  // first (mandatory, never the reverse), then scope, then the same tree
  // picker as before. Unlike the old single-person flow, this one never
  // pre-loads "existing grants" into the tree — a multi-person submission
  // has no single existing state to diff against, so it's purely additive;
  // revoking an existing grant stays a separate action on the grants list
  // below, unchanged.
  const [grantEntityId, setGrantEntityId] = useState('');
  // Prompt 398 §3.3 — the Today page's interest-request advice links here
  // with ?grantFor=<entityId> instead of building a second grant flow
  // (same principle as 397 §C.2): pre-selects step 1 of the EXISTING
  // "Access grants" card, so a founder acting on the advice lands
  // straight at "2. Who gets access?" instead of searching again.
  const searchParams = useSearchParams();
  const grantForParam = searchParams.get('grantFor');
  useEffect(() => {
    if (grantForParam) setGrantEntityId(grantForParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grantForParam]);
  const [grantEntityQuery, setGrantEntityQuery] = useState('');
  // Prompt 278 §2 — an empty query used to return the WHOLE pipeline
  // (200+ funds rendered before typing a single character, confirmed in
  // the screenshots that prompted this). Autocomplete by default (empty
  // query shows nothing, typed characters show up to 10 matches); this
  // flag is the deliberate escape hatch for "I'd rather scroll and
  // recognize the name than type it" — bypasses the query/cap entirely
  // while true, and resets the moment the founder types again (see the
  // input's onChange below) so it never gets stuck showing everything
  // once they've started searching for real.
  const [showFullGrantList, setShowFullGrantList] = useState(false);
  const [grantScope, setGrantScope] = useState<'' | 'everyone' | 'specific'>('');
  const [grantSpecificIds, setGrantSpecificIds] = useState<string[]>([]);
  const [grantShowInvite, setGrantShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [grantExpiry, setGrantExpiry] = useState('');
  const [selection, setSelection] = useState<Record<string, GrantState>>({});
  // Prompt 154 gap 4 — a genuinely separate path from the entity-first flow
  // above, not a variant of it: this is for someone not anywhere in the CRM
  // yet (no entity to attach them to), so it skips straight from "who" to
  // "what they see," reusing the same tree picker (roots/GrantTreeNode/
  // selection) and the same addGrant() call, just with person_id omitted —
  // access_grants already supports that (PeopleAccessPanel.tsx's own
  // "orphan grants" basket is exactly this shape: person_id null,
  // invited_email/invited_name only).
  const [adHocInviteMode, setAdHocInviteMode] = useState(false);

  // "Everyone confirmed at this entity" — resolved live from
  // person_affiliations at grant-creation time, per the decision that this
  // must never be a frozen snapshot (same lesson as the 0042 quota sticky-
  // unlock backfill). This is still a one-time resolution at the moment the
  // founder clicks submit, not a truly dynamic per-login re-check — a fully
  // dynamic entity-wide grant would need access_grants to carry an
  // entity_id of its own, which the confirmed 29/07 schema decision doesn't
  // include (it only added invited_email/invited_name/confirmed_at/
  // self_verified). Flagged, not silently built past the confirmed schema —
  // re-running "Everyone confirmed" after a team change re-syncs it.
  const entityAffiliatedPeople = useMemo(() => {
    if (!grantEntityId) return [];
    const ids = new Set(db.personAffiliations.filter((a) => a.entity_id === grantEntityId && a.current).map((a) => a.person_id));
    return db.people.filter((p) => ids.has(p.id) || p.entity_id === grantEntityId);
  }, [db.personAffiliations, db.people, grantEntityId]);
  const grantEntity = db.entities.find((e) => e.id === grantEntityId);

  // Bug report 2026-08-03 — plain unsorted <select> over 757 entities was
  // "essentially unusable" (no typed filter, no alphabetical order). Sorts
  // and filters locally here only, rather than adding .order() to the
  // shared db.entities query, since other consumers of that query weren't
  // audited for an order dependency — same "safe alternative" PeopleAccessPanel
  // already uses for its own entity search.
  //
  // Prompt 121 §2.6 — reproduced against production data before touching
  // this: the filter only ever checked e.name, so typing an email address
  // NEVER matched anything, on any account, by construction (confirmed by
  // reading this exact code, not guessed). Separately, two of the four orgs
  // on the platform ("Sherlock Deal_ test", "Test & trial") have zero rows
  // in `entities` at all (confirmed via SQL), so any search there was also
  // guaranteed empty — genuinely nothing to find yet, not a bug. Widened to
  // match an entity's own contact email (Entity.email) and its affiliated
  // people's emails, alongside the existing name match.
  const grantEntityQuery_ = grantEntityQuery.trim().toLowerCase();
  // Prompt 278 §1 — the grant-entity list is "who could plausibly be an
  // investor to grant Vault access to", not the whole pipeline: a Reported
  // (resolved_blocked — a founder-submitted fraud/scam report, pending
  // platform review, see Prompt 277 A) or Not applicable (resolved_not_a_
  // fit — not even the right kind of investor) entity shouldn't be
  // offered here at all. hard_filter_status is checked directly rather
  // than duplicating frozen-classifier.ts's dormant-only interaction
  // logic — this list isn't about frozen/stale/stand-by, only about the
  // two hard-filter states that mean "not a real prospect."
  const grantableEntities = useMemo(
    () => db.entities.filter((e) => e.hard_filter_status !== 'resolved_blocked' && e.hard_filter_status !== 'resolved_not_a_fit'),
    [db.entities],
  );
  const filteredGrantEntities = useMemo(() => {
    if (!grantEntityQuery_) return grantableEntities.slice().sort((a, b) => a.name.localeCompare(b.name));
    return grantableEntities
      .filter((e) => {
        if (e.name.toLowerCase().includes(grantEntityQuery_)) return true;
        if (e.email && e.email.toLowerCase().includes(grantEntityQuery_)) return true;
        const affiliatedIds = new Set(db.personAffiliations.filter((a) => a.entity_id === e.id && a.current).map((a) => a.person_id));
        return db.people.some((p) => (p.entity_id === e.id || affiliatedIds.has(p.id))
          && ((p.email_verified?.toLowerCase().includes(grantEntityQuery_)) || (p.email_guess?.toLowerCase().includes(grantEntityQuery_))));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [grantableEntities, db.people, db.personAffiliations, grantEntityQuery_]);
  // Prompt 278 §2 — autocomplete, not "everything by default": an empty
  // query with the escape hatch off shows nothing to pick from yet; a
  // typed query shows up to 10 suggestions (not the unbounded list this
  // used to render). "Ver lista completa" (showFullGrantList) is the only
  // path back to the unbounded list.
  const visibleGrantEntities = grantEntityQuery_
    ? filteredGrantEntities.slice(0, 10)
    : (showFullGrantList ? filteredGrantEntities : []);

  // Prompt 121 §2.6 — "the two lists don't talk to each other": a founder
  // searching by name only ever saw their own org's entities, never the
  // platform catalog (536 rows, fetched into db.catalog regardless of org).
  // Shown as informational matches only — NOT directly selectable here.
  // Converting a catalog row into this org's own entity already exists as
  // unlockPack() on /pipeline, which is quota-gated by the org's plan
  // (plan_catalog_quota/catalog_blocked_count); wiring a second, quota-blind
  // "add to org" shortcut from this search box would let a founder route
  // around their plan's catalog cap — a billing-integrity call, not a search
  // bugfix. Flagging rather than silently building that shortcut; routes to
  // Pipeline's existing, quota-respecting unlock flow instead.
  const catalogMatches = useMemo(() => {
    if (!grantEntityQuery_) return [];
    const ownedNames = new Set(db.entities.map((e) => e.name.toLowerCase()));
    return db.catalog
      .filter((c) => !ownedNames.has(c.name.toLowerCase()) && c.name.toLowerCase().includes(grantEntityQuery_))
      .slice(0, 20);
  }, [db.catalog, db.entities, grantEntityQuery_]);

  // Prompt 171 §A — was signInWithOtp (a founder-triggered magic link into
  // the FULL /portal, "shouldCreateUser: true") — the actual bug: an
  // invited guest got the whole workspace, not the protected /guest/[token]
  // preview, because this OTP send was standing in for a real invite email
  // that never existed. Now calls the guest-invite route with
  // sendEmail:true, which mints/reuses the guest token and sends the
  // "{OrgName} shared their data room with you" email pointing at
  // /guest/[token] — signInWithOtp only ever runs now from inside that
  // page's own "Is this you?" CTA, after the recipient has already seen the
  // gated preview. No silent OTP fallback if Resend isn't configured or the
  // send fails — the founder sees the error and still has "Copy guest link".
  const [resendMsg, setResendMsg] = useState('');
  async function sendGuestInviteEmail(email: string) {
    setResendMsg('');
    try {
      const res = await fetch('/api/data-room/guest-invite', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: db.org.id, invitedEmail: email, sendEmail: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setResendMsg(body.error ?? 'Could not send the invite email — copy the link below and send it yourself'); return; }
      if (body.emailSent === false) { setResendMsg(body.emailError ?? 'Could not send the invite email — copy the link below and send it yourself'); return; }
      setResendMsg(`Data room invite sent to ${email}.`);
    } catch (e) {
      setResendMsg((e as Error).message ?? 'Could not send the invite email — copy the link below and send it yourself');
    }
  }

  // Data Room V2 — per-document management
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [detailsOpenId, setDetailsOpenId] = useState<string | null>(null);
  const [detailsText, setDetailsText] = useState('');
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);

  // Data Room V2 — folder management
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState('');
  const [newFolderKind, setNewFolderKind] = useState<FolderKind>('data_room');
  const [folderErr, setFolderErr] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameText, setFolderRenameText] = useState('');

  const roots = db.folders.filter((f) => !f.parent_id).sort((a, b) => a.position - b.position);
  const children = (id: string) => db.folders.filter((f) => f.parent_id === id).sort((a, b) => a.position - b.position);
  // E5 — documents sort by their persisted within-folder position (migration
  // 0027). created_at breaks ties so pre-0027 rows (all position 0) keep a
  // stable upload order rather than jumping around on every render.
  const docsIn = (id: string) => db.documents
    .filter((d) => d.folder_id === id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  // Prompt 33/47 — "active grants" used to mean exactly one thing (not
  // revoked, not expired). Now a grant can also be pending_confirmation
  // (invited_email set, confirmed_at still null) — visible in the app's own
  // list below so the founder can track/resend/revoke it, but grantStatus()
  // (not this filter) is what actually decides whether it's usable
  // elsewhere (e.g. counted toward "awaiting NDA").
  const visibleGrants = db.grants.filter((g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()));
  const confirmedActiveGrants = visibleGrants.filter((g) => grantStatus(g, new Date()) === 'active');

  // Prompt 437 §D — founder-side advice only (CLAUDE.md root rule: contact
  // counts and access state are derived data about the founder, no toggle
  // — this feeds a card on THIS page only, never anything investor-facing).
  // Built from visibleGrants (active only, same set "Awaiting NDA"/"Granted
  // so far" below already use) — a revoked/expired grant isn't really
  // "shared" any more, so it shouldn't count as either access or NDA
  // coverage.
  const vaultAdvice = useMemo(() => vaultAccessAdvice({
    entities: db.entities.map((e) => ({ id: e.id, name: e.name })),
    interactions: db.interactions.map((i) => ({ entity_id: i.entity_id, at: i.occurred_at, direction: i.direction })),
    grants: visibleGrants.map((g) => ({
      person_id: g.person_id ?? null, email: g.grantee_email ?? null,
      folder_id: g.folder_id ?? null, document_id: g.document_id ?? null,
      nda_required: g.nda_required,
    })),
    people: db.people.map((p) => ({ id: p.id, entity_id: p.entity_id, email: p.email_verified ?? p.email_guess ?? null })),
  }), [db.entities, db.interactions, visibleGrants, db.people]);

  // P120 Block B — 100 active grants can belong to as few as 3 distinct
  // people (one row per document/folder selected in the tri-state tree).
  // Grouping here, purely client-side over the same visibleGrants list, so
  // the panel shows "3 people" instead of "100 rows" without touching the
  // fine-grained grant data model (still needed for per-document revoke).
  const [expandedGrantGroups, setExpandedGrantGroups] = useState<Set<string>>(new Set());
  function toggleGrantGroup(key: string) {
    setExpandedGrantGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  const grantGroups = useMemo(() => {
    const map = new Map<string, { key: string; personId?: string; invitedName?: string; invitedEmail?: string; granteeEmail?: string; grants: typeof visibleGrants }>();
    for (const g of visibleGrants) {
      const key = g.person_id ?? g.invited_email ?? g.grantee_email ?? g.id;
      if (!map.has(key)) map.set(key, { key, personId: g.person_id ?? undefined, invitedName: g.invited_name ?? undefined, invitedEmail: g.invited_email ?? undefined, granteeEmail: g.grantee_email ?? undefined, grants: [] });
      map.get(key)!.grants.push(g);
    }
    return [...map.values()];
  }, [visibleGrants]);
  async function revokeAllInGroup(group: typeof grantGroups[number], label: string) {
    if (!(await confirm({ message: `Revoke all ${group.grants.length} grant(s) for ${label}? This cannot be undone.`, destructive: true }))) return;
    for (const g of group.grants) revokeGrant(g.id);
  }

  function resetGrantFlow() {
    setGrantEntityId(''); setGrantScope(''); setGrantSpecificIds([]);
    setGrantShowInvite(false); setInviteEmail(''); setInviteName('');
    setGrantExpiry(''); setSelection({}); setAdHocInviteMode(false);
  }

  function toggleFolderSelection(folderId: string) {
    const current = selection[`folder:${folderId}`] ?? 'none';
    const next = cycleGrantState(current);
    const keys = collectFolderSelectionKeys(folderId, db.folders, db.documents);
    setSelection((prev) => {
      const updated = { ...prev };
      for (const k of keys) updated[k] = next;
      return updated;
    });
  }

  function toggleDocSelection(docId: string) {
    const current = selection[`doc:${docId}`] ?? 'none';
    setSelection((prev) => ({ ...prev, [`doc:${docId}`]: cycleGrantState(current) }));
  }

  async function submitGrantTree() {
    if (!grantEntityId || !grantScope) return;
    const expires_at = grantExpiry ? `${grantExpiry}T23:59:59Z` : undefined;
    const selectedNodes = Object.entries(selection).filter(([, s]) => s !== 'none');
    if (!selectedNodes.length) return;

    // Resolve WHO, per the chosen scope. "Everyone confirmed" is resolved
    // right here, at submit time — see the note on entityAffiliatedPeople.
    let targetIds: string[] = grantScope === 'everyone'
      ? entityAffiliatedPeople.map((p) => p.id)
      : [...grantSpecificIds];

    // "+ Invite someone new" — only meaningful under "specific people".
    // Creates/reconciles the person now, and this grant (only this one)
    // carries invited_email/invited_name so it's born pending_confirmation.
    let invitedPersonId: string | null = null;
    if (grantScope === 'specific' && inviteEmail.trim() && inviteName.trim()) {
      const person = await invitePersonForGrant(grantEntityId, inviteEmail.trim(), inviteName.trim());
      invitedPersonId = person.id;
      if (!targetIds.includes(person.id)) targetIds = [...targetIds, person.id];
    }
    if (!targetIds.length) return;

    for (const personId of targetIds) {
      const isInvite = personId === invitedPersonId;
      for (const [key, state] of selectedNodes) {
        const [kind, id] = key.split(':');
        addGrant({
          person_id: personId, document_id: kind === 'doc' ? id : undefined,
          folder_id: kind === 'folder' ? id : undefined, expires_at, nda_required: state === 'shared_nda',
          invited_email: isInvite ? inviteEmail.trim().toLowerCase() : undefined,
          invited_name: isInvite ? inviteName.trim() : undefined,
        });
      }
    }
    const invitedEmailToNotify = invitedPersonId ? inviteEmail.trim().toLowerCase() : null;
    resetGrantFlow();
    // Item 1 (Lote E) / Prompt 171 §A — one call now both mints the
    // guest-preview token on the just-created invite grant AND sends the
    // guest-link email; no separate OTP send and no separate bare mint.
    if (invitedEmailToNotify) await sendGuestInviteEmail(invitedEmailToNotify);
  }

  // Prompt 154 gap 4 — same shape as the invite branch inside
  // submitGrantTree above, minus person_id/entity entirely: a genuinely
  // unknown contact, not yet anywhere in the CRM. Lands in
  // PeopleAccessPanel.tsx's existing "orphan grants" basket until someone
  // signs in and confirms "Is this you?", same as any other invited grant.
  async function submitAdHocEmailGrant() {
    const email = inviteEmail.trim().toLowerCase();
    const nameTrimmed = inviteName.trim();
    if (!email || !nameTrimmed) return;
    const expires_at = grantExpiry ? `${grantExpiry}T23:59:59Z` : undefined;
    const selectedNodes = Object.entries(selection).filter(([, s]) => s !== 'none');
    if (!selectedNodes.length) return;

    for (const [key, state] of selectedNodes) {
      const [kind, id] = key.split(':');
      addGrant({
        person_id: undefined, document_id: kind === 'doc' ? id : undefined,
        folder_id: kind === 'folder' ? id : undefined, expires_at, nda_required: state === 'shared_nda',
        invited_email: email, invited_name: nameTrimmed,
      });
    }
    resetGrantFlow();
    await sendGuestInviteEmail(email);
  }

  // Item 1 (Lote E) — the route is idempotent (hands back the existing
  // token if it's still live), so this doubles as "mint on demand" for any
  // pending invite that doesn't have one cached in `db.grants` yet (e.g. the
  // eager mint above failed, or the store hasn't refetched since).
  const [copiedGuestLinkFor, setCopiedGuestLinkFor] = useState<string | null>(null);
  // Prompt 518 §3 — when the clipboard write is refused, the link itself, so
  // the founder can select and copy it by hand. Without this the only
  // feedback was a "Copied!" that could be a lie.
  const [guestLinkFallback, setGuestLinkFallback] = useState<{ email: string; link: string } | null>(null);
  async function copyGuestLink(invitedEmail: string) {
    const res = await fetch('/api/data-room/guest-invite', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: db.org.id, invitedEmail }),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok || !body.token) { setResendMsg(body.error ?? 'Could not create a guest link.'); return; }
    const link = `${window.location.origin}/guest/${body.token}`;
    // Prompt 518 §3 — this used to be `.catch(() => {})` followed by an
    // unconditional "Copied!". The write happens AFTER an await fetch, which
    // in Safari (and others) is outside the click's user-activation window,
    // so the browser rejects it with NotAllowedError — silently, because the
    // rejection was swallowed. The founder saw "Copied!", pasted, and got
    // whatever was on the clipboard before: plausibly the investor's email
    // address, visible on the same row. Hence "copia o email".
    //
    // Now the real result decides what is shown, and a refusal produces a
    // selectable field with the link rather than a false success.
    let copied = false;
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch { copied = false; }

    if (copied) {
      setGuestLinkFallback(null);
      setCopiedGuestLinkFor(invitedEmail);
      setTimeout(() => setCopiedGuestLinkFor((cur) => (cur === invitedEmail ? null : cur)), 2000);
    } else {
      setCopiedGuestLinkFor(null);
      setGuestLinkFallback({ email: invitedEmail, link });
    }
  }

  async function uploadNda(file: File, inv: { personId?: string; email?: string; documentId?: string }) {
    try {
      const sb = browserClient();
      const path = `${db.org.id}/ndas/${crypto.randomUUID()}-${sanitizeStorageKey(file.name)}`;
      const { error } = await sb.storage.from('data-room').upload(path, file);
      if (error) throw error;
      const res = await fetch('/api/data-room/nda-upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storagePath: path, fileName: file.name, personId: inv.personId, granteeEmail: inv.email, documentId: inv.documentId }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'Upload failed');
      recordNdaUpload(body.nda, body.unlockedGrantIds ?? []);
    } catch (e) {
      alert(`NDA upload failed: ${(e as Error).message}`);
    }
  }

  const pendingNdaInvestors = useMemo(() => {
    // Block F — when every pending grant for this investor locks the SAME
    // single document, the upload is scoped to it (documentId passed
    // through to nda-upload, which then only unlocks that one grant); a
    // mix of documents/folders falls back to the pre-existing org-wide
    // unlock, unchanged.
    const map = new Map<string, { personId?: string; email?: string; label: string; count: number; documentIds: Set<string> }>();
    for (const g of confirmedActiveGrants) {
      if (!g.nda_required || g.nda_accepted_at) continue;
      const key = g.person_id ?? g.grantee_email ?? '';
      if (!key) continue;
      const label = g.person_id ? (db.people.find((p) => p.id === g.person_id)?.full_name ?? 'Unknown') : (g.grantee_email ?? '');
      const existing = map.get(key);
      const documentIds = existing?.documentIds ?? new Set<string>();
      if (g.document_id) documentIds.add(g.document_id);
      map.set(key, { personId: g.person_id, email: g.grantee_email, label, count: (existing?.count ?? 0) + 1, documentIds });
    }
    return [...map.values()].map((v) => ({
      personId: v.personId, email: v.email, label: v.label, count: v.count,
      documentId: v.documentIds.size === 1 ? [...v.documentIds][0] : undefined,
      documentName: v.documentIds.size === 1 ? db.documents.find((d) => d.id === [...v.documentIds][0])?.name : undefined,
    }));
  }, [confirmedActiveGrants, db.people, db.documents]);

  // File size isn't a DB column — Supabase Storage already tracks it, so a
  // single listing of the org's prefix is cheaper than a schema change.
  useEffect(() => {
    if (!authEnabled || !db.org.id) return;
    browserClient().storage.from('data-room').list(db.org.id, { limit: 1000 }).then(({ data, error }) => {
      if (error || !data) return;
      const map: Record<string, number> = {};
      for (const item of data) if (item.metadata?.size != null) map[`${db.org.id}/${item.name}`] = item.metadata.size;
      setStorageSizes(map);
    });
  }, [db.org.id, db.documents.length]);

  // F2: multiple files upload sequentially (one Storage round-trip each),
  // with per-file progress and a failed-file list — one bad file shouldn't
  // silently drop the rest of the batch. Prompt 301 §3 — verify-then-
  // confirm via the shared uploadAndVerifyFile helper: the document row is
  // only ever created after /api/data-room/verify-upload clears it.
  async function uploadFiles(files: File[]) {
    setUploadErr(''); setUploading(true);
    setUploadProgress({ done: 0, total: files.length, failed: [] });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const verified = await uploadAndVerifyFile(db.org.id, file);
        addDocument({
          folder_id: selFolder, name: file.name, storage_path: verified.storagePath,
          is_view_only: true, visibility: docVisibility, watermark: false, downloadable: false,
          malware_scan_status: verified.malwareScanStatus as 'not_scanned' | 'pending' | 'clean' | 'local_only' | 'flagged' | undefined,
        });
      } catch (e) {
        failed.push(`${file.name}: ${(e as Error).message}`);
      }
      setUploadProgress({ done: i + 1, total: files.length, failed: [...failed] });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setUploading(false);
    if (failed.length) setUploadErr(failed.join('\n'));
  }

  async function openStored(storagePath: string) {
    const sb = browserClient();
    const { data, error } = await sb.storage.from('data-room').createSignedUrl(storagePath, 60);
    if (error) { alert(`Could not open file: ${error.message}`); return; }
    window.open(data.signedUrl, '_blank');
  }

  // Prompt 301 §1 — download as a DISTINCT action from Open. Confirmed by
  // reading the Supabase JS client: a plain createSignedUrl() only ever
  // gets Content-Disposition: inline from Storage, so openStored()'s
  // window.open was never actually forcing a download for any of the
  // Vault's file types (browsers render PDFs/images inline given the
  // chance) — createSignedUrl's own `download` option is what forces
  // Content-Disposition: attachment.
  async function downloadStored(storagePath: string, fileName: string) {
    const sb = browserClient();
    const { data, error } = await sb.storage.from('data-room').createSignedUrl(storagePath, 60, { download: fileName });
    if (error) { alert(`Could not download file: ${error.message}`); return; }
    window.location.href = data.signedUrl;
  }

  // Prompt 301 §1 — version history moves from an inline <details> (only
  // visible when expanded) to a popup, opened by clicking the current
  // version number directly instead of it being small, inert text.
  const [versionModalDocId, setVersionModalDocId] = useState<string | null>(null);

  function startRenameDoc(d: { id: string; name: string }) { setRenamingDocId(d.id); setRenameText(d.name); }
  function saveRenameDoc() {
    if (renamingDocId && renameText.trim()) renameDocument(renamingDocId, renameText.trim());
    setRenamingDocId(null);
  }

  function startDetails(d: { id: string; details?: string }) {
    setDetailsOpenId(detailsOpenId === d.id ? null : d.id);
    setDetailsText(d.details ?? '');
  }
  function saveDetails(id: string) {
    updateDocumentDetails(id, detailsText);
    setDetailsOpenId(null);
  }

  async function confirmDeleteDoc(d: { id: string; name: string }) {
    if (await confirm({ message: `Delete "${d.name}"? This removes the file from storage and cannot be undone.`, destructive: true })) {
      deleteDocument(d.id);
    }
  }

  // E5 — drop the dragged document onto another document in the same folder:
  // recompute the order (reorderByDrag) and persist position = index.
  function handleDropOnDoc(targetId: string) {
    const src = dragDocId;
    setDragDocId(null); setDragOverDocId(null);
    if (!src || src === targetId) return;
    const ids = docsIn(selFolder).map((d) => d.id);
    const next = reorderByDrag(ids, src, targetId);
    if (next.join() !== ids.join()) reorderDocuments(selFolder, next);
  }

  // E5 — drop the dragged document onto a folder in the tree: move it there
  // (appends to the end of that folder's documents). No-op if it's already
  // in that folder.
  function handleDropOnFolder(folderId: string) {
    const src = dragDocId;
    setDragDocId(null); setDragOverDocId(null); setDragOverFolderId(null);
    if (!src) return;
    const doc = db.documents.find((d) => d.id === src);
    if (!doc || doc.folder_id === folderId) return;
    moveDocumentToFolder(src, folderId);
  }

  // E5/E7 — upload a new file for an existing document, keeping the same row
  // (name, folder, position, grants, details). When versioning is available
  // (migration 0029) this becomes "Nova versão": the prior file is KEPT as a
  // version (addDocumentVersion). Pre-migration it falls back to the legacy
  // replace (replaceDocumentFile swaps + removes the old object). Prompt
  // 301 §3 — same verify-then-confirm gate as a brand-new upload.
  async function newVersion(docId: string, file: File) {
    setReplacingDocId(docId);
    try {
      const verified = await uploadAndVerifyFile(db.org.id, file);
      const scan = { status: verified.malwareScanStatus, provider: verified.provider, sha256: verified.sha256 };
      if (documentVersionsAvailable) addDocumentVersion(docId, verified.storagePath, verified.size, scan);
      else replaceDocumentFile(docId, verified.storagePath);
    } catch (e) {
      alert(`Upload failed: ${(e as Error).message}`);
    } finally {
      setReplacingDocId(null);
    }
  }

  // Prompt 301 §2 — new version from a link/Drive URL. The content is
  // FETCHED server-side and stored as a real, scanned Storage object — see
  // the decision recorded in new-version-from-link/route.ts's own header —
  // never kept as a live external reference.
  const [linkVersionDocId, setLinkVersionDocId] = useState<string | null>(null);
  const [linkVersionUrl, setLinkVersionUrl] = useState('');
  const [linkVersionErr, setLinkVersionErr] = useState('');
  async function newVersionFromLink(docId: string) {
    if (!linkVersionUrl.trim()) return;
    setReplacingDocId(docId); setLinkVersionErr('');
    try {
      const res = await fetch('/api/data-room/new-version-from-link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docId, url: linkVersionUrl.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setLinkVersionErr(body.error ?? 'Could not fetch that link.'); return; }
      const scan = { status: body.malwareScanStatus, provider: body.provider, sha256: body.sha256 };
      if (documentVersionsAvailable) addDocumentVersion(docId, body.storagePath, body.size, scan);
      else replaceDocumentFile(docId, body.storagePath);
      setLinkVersionDocId(null); setLinkVersionUrl('');
    } finally {
      setReplacingDocId(null);
    }
  }

  // E7 — restore an older version: point the document back at that object as a
  // NEW current version (never a deletion). No upload — the object already
  // exists in Storage.
  // Restoring points back at an object that was already verified/scanned
  // when it was first uploaded — carry that same status through instead of
  // resetting it to 'not_scanned' (which would be dishonest either way: it
  // HAS been scanned, just not just now).
  function restoreVersion(docId: string, storagePath: string, size?: number) {
    const priorVersion = db.documentVersions.find((v) => v.document_id === docId && v.storage_path === storagePath);
    addDocumentVersion(docId, storagePath, size, priorVersion
      ? { status: priorVersion.malware_scan_status, sha256: priorVersion.content_sha256 }
      : undefined);
  }

  function startRenameFolder(f: Folder) { setRenamingFolderId(f.id); setFolderRenameText(f.name); }
  function saveRenameFolder() {
    if (renamingFolderId && folderRenameText.trim()) renameFolder(renamingFolderId, folderRenameText.trim());
    setRenamingFolderId(null);
  }

  function createNewFolder() {
    setFolderErr('');
    if (!newFolderName.trim()) return;
    createFolder(newFolderName.trim(), newFolderParent || undefined, newFolderKind);
    setNewFolderName(''); setNewFolderParent('');
  }

  async function confirmDeleteFolder(f: Folder) {
    setFolderErr('');
    if (!(await confirm({ message: `Delete folder "${f.name}"?`, destructive: true }))) return;
    try {
      deleteFolder(f.id, false);
    } catch (e) {
      const move = await confirm({ message: `${(e as Error).message}\n\nMove its contents to the parent folder instead?` });
      if (move) {
        try { deleteFolder(f.id, true); } catch (e2) { setFolderErr((e2 as Error).message); }
      }
    }
  }

  function FolderNode({ f, depth }: { f: Folder; depth: number }) {
    const kids = children(f.id);
    const isCollapsed = collapsed.has(f.id);
    return (
      <div>
        <div className="group flex items-center gap-1" style={{ paddingLeft: `${8 + depth * 14}px` }}>
          {renamingFolderId === f.id ? (
            <>
              <input value={folderRenameText} onChange={(e) => setFolderRenameText(e.target.value)} autoFocus
                className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
              <button onClick={saveRenameFolder} className="text-xs text-cyan-700 hover:underline">save</button>
            </>
          ) : (
            <>
              {kids.length > 0 ? (
                <button onClick={() => toggleCollapse(f.id)} title={isCollapsed ? 'Expand' : 'Collapse'}
                  className="w-3 shrink-0 text-[10px] text-gray-400 hover:text-gray-700">{isCollapsed ? '▸' : '▾'}</button>
              ) : (
                <span className="w-3 shrink-0" />
              )}
              <button onClick={() => setSelFolder(f.id)}
                onDragOver={dragDocId ? (e) => { e.preventDefault(); setDragOverFolderId(f.id); } : undefined}
                onDragLeave={dragDocId ? () => setDragOverFolderId((cur) => cur === f.id ? null : cur) : undefined}
                onDrop={dragDocId ? (e) => { e.preventDefault(); handleDropOnFolder(f.id); } : undefined}
                className={`flex flex-1 items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${
                  dragOverFolderId === f.id ? 'bg-cyan-100 ring-1 ring-cyan-400'
                    : selFolder === f.id ? 'bg-[#E8F4F8] font-medium text-[#0E7490]' : 'text-gray-700 hover:bg-gray-50'}`}>
                <span>{f.kind === 'data_room' ? '▣' : '▤'}</span> {f.name}
                <span className="ml-auto text-[10px] text-gray-400">{docsIn(f.id).length || ''}</span>
              </button>
              <button onClick={() => startRenameFolder(f)} title="Rename folder"
                className="hidden text-xs text-gray-400 hover:text-cyan-700 group-hover:inline">✎</button>
              <button onClick={() => confirmDeleteFolder(f)} title="Delete folder"
                className="hidden text-xs text-gray-400 hover:text-[#B00000] group-hover:inline">🗑</button>
            </>
          )}
        </div>
        {!isCollapsed && kids.map((k) => <FolderNode key={k.id} f={k} depth={depth + 1} />)}
      </div>
    );
  }

  function TriStateBox({ state, onClick }: { state: GrantState; onClick: () => void }) {
    const style = state === 'none'
      ? 'border border-gray-300 bg-white'
      : state === 'shared'
      ? 'border border-cyan-600 bg-cyan-600 text-white'
      : 'border border-amber-600 bg-amber-500 text-white';
    const title = state === 'none' ? 'Not shared — click to share' : state === 'shared' ? 'Shared — click to also require an NDA' : 'Shared + NDA required — click to unshare';
    return (
      <button type="button" onClick={onClick} title={title}
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-bold leading-none ${style}`}>
        {state === 'shared' ? '✓' : state === 'shared_nda' ? '🔒' : ''}
      </button>
    );
  }

  function GrantTreeNode({ f, depth }: { f: Folder; depth: number }) {
    const kids = children(f.id);
    const docs = docsIn(f.id);
    return (
      <div>
        <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 14}px` }}>
          <TriStateBox state={selection[`folder:${f.id}`] ?? 'none'} onClick={() => toggleFolderSelection(f.id)} />
          <span className="text-sm text-gray-700">{f.kind === 'data_room' ? '▣' : '▤'} {f.name}</span>
        </div>
        {docs.map((d) => (
          <div key={d.id} className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
            <TriStateBox state={selection[`doc:${d.id}`] ?? 'none'} onClick={() => toggleDocSelection(d.id)} />
            <span className="text-xs text-gray-600">{d.name}</span>
          </div>
        ))}
        {kids.map((k) => <GrantTreeNode key={k.id} f={k} depth={depth + 1} />)}
      </div>
    );
  }

  const selected = db.folders.find((f) => f.id === selFolder);

  return (
    <div className="space-y-4">
      <VaultPrivacyNoticeModal open={vaultNoticeOpen} onGotIt={acknowledgeVaultNotice} />
      {tab === 'documents' && <PageTour pageKey="guide_documents" />}
      {tab === 'people' && <PageTour pageKey="guide_people_access" />}
      <div className="flex items-center justify-between gap-1.5">
        <h1 className="text-lg font-bold">{tab === 'documents' ? 'Documents & Vault Data Room' : 'People & Access'}</h1>
        <VaultKillSwitch />
      </div>
      <div className="flex gap-1.5 border-b border-gray-100 pb-2">
        <button onClick={() => setTab('documents')}
          className={`rounded-full px-3 py-1 text-xs font-medium ${tab === 'documents' ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
          Documents & Vault Data Room
        </button>
        <button onClick={() => setTab('people')}
          className={`rounded-full px-3 py-1 text-xs font-medium ${tab === 'people' ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
          People & Access
        </button>
      </div>
      {tab === 'people' ? <PeopleAccessPanel /> : (
      <div className="grid gap-4 md:grid-cols-3">
        <div data-tour-id="documents-folders">
        <Card title="Folders">
          {roots.map((f) => <FolderNode key={f.id} f={f} depth={0} />)}
          <div className="mt-3 border-t border-gray-100 pt-3 text-xs">
            <div className="font-medium text-gray-500">New folder</div>
            <div className="mt-1 flex flex-col gap-1.5">
              <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Name"
                className="rounded border border-gray-300 px-2 py-1 text-sm" />
              <select value={newFolderParent} onChange={(e) => setNewFolderParent(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">— root —</option>
                {db.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select value={newFolderKind} onChange={(e) => setNewFolderKind(e.target.value as FolderKind)}
                className="rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="data_room">Data room</option>
                <option value="materials">Materials</option>
              </select>
              <button onClick={createNewFolder} disabled={!newFolderName.trim()}
                className="self-start rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                Create folder
              </button>
            </div>
            {folderErr && <div className="mt-1 text-[#B00000]">{folderErr}</div>}
          </div>
        </Card>
        </div>

        <div data-tour-id="documents-panel" className="space-y-4 md:col-span-2">
          <Card title={`Documents in “${selected?.name ?? ''}”`}>
            {documentOrderingAvailable && docsIn(selFolder).length > 1 && (
              <p className="mb-2 text-[11px] text-gray-400">Drag ⠿ to reorder, or drop a document onto a folder on the left to move it.</p>
            )}
            {docsIn(selFolder).length === 0 ? <p className="text-sm text-gray-400">Empty.</p> : (
              <ul className="divide-y divide-gray-100">
                {docsIn(selFolder).map((d) => {
                  const grants = visibleGrants.filter((g) => g.document_id === d.id || g.folder_id === d.folder_id);
                  const views = db.views.filter((v) => v.document_id === d.id);
                  const size = d.storage_path ? fmtBytes(storageSizes[d.storage_path]) : undefined;
                  const canDrag = documentOrderingAvailable && renamingDocId !== d.id;
                  return (
                    <li key={d.id}
                      draggable={canDrag}
                      onDragStart={canDrag ? () => setDragDocId(d.id) : undefined}
                      onDragEnd={canDrag ? () => { setDragDocId(null); setDragOverDocId(null); setDragOverFolderId(null); } : undefined}
                      onDragOver={dragDocId ? (e) => { e.preventDefault(); setDragOverDocId(d.id); } : undefined}
                      onDrop={dragDocId ? (e) => { e.preventDefault(); handleDropOnDoc(d.id); } : undefined}
                      className={`py-2 text-sm ${dragDocId === d.id ? 'opacity-40' : ''} ${
                        dragOverDocId === d.id && dragDocId !== d.id ? 'border-t-2 border-cyan-400' : ''}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        {documentOrderingAvailable && (
                          <span className={`select-none text-gray-300 ${canDrag ? 'cursor-grab' : ''}`} title="Drag to reorder, or drop onto a folder to move">⠿</span>
                        )}
                        {renamingDocId === d.id ? (
                          <span className="flex items-center gap-1">
                            <input value={renameText} onChange={(e) => setRenameText(e.target.value)} autoFocus
                              className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
                            <button onClick={saveRenameDoc} className="text-xs text-cyan-700 hover:underline">save</button>
                          </span>
                        ) : (
                          <span className="font-medium">{d.name}</span>
                        )}
                        {d.version && (
                          documentVersionsAvailable ? (
                            <button onClick={() => setVersionModalDocId(d.id)}
                              className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-cyan-700 hover:bg-gray-200"
                              title="View version history">
                              {d.version}
                            </button>
                          ) : <span className="text-xs text-gray-400">{d.version}</span>
                        )}
                        {/* Prompt 375 §E — an honest label per real state, not
                            a lesser-vs-better spin: "verified locally" is the
                            NORMAL case for a private document (never sent
                            anywhere), and the tooltip says exactly that —
                            this is a privacy feature, not a limitation. */}
                        {d.malware_scan_status === 'flagged' && (
                          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#B00000]" title="Flagged by malware scan — not servable to anyone but you">
                            ⚠ suspicious
                          </span>
                        )}
                        {d.malware_scan_status === 'pending' && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700" title="VirusTotal is temporarily unavailable — this will retry automatically.">
                            scan pending
                          </span>
                        )}
                        {d.malware_scan_status === 'not_scanned' && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title="Not yet verified.">
                            not yet verified
                          </span>
                        )}
                        {d.malware_scan_status === 'local_only' && (
                          <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-700" title="Your documents are never sent to external services — only a fingerprint (hash) is checked.">
                            🔒 verified locally
                          </span>
                        )}
                        {d.malware_scan_status === 'clean' && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700" title="This exact file is already known to VirusTotal with no malicious detections.">
                            ✓ verified externally
                          </span>
                        )}
                        {d.is_view_only
                          ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-800">view-only ✓</span>
                          : <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-800">not view-only — blocked from sharing</span>}
                        <select value={d.visibility} onChange={(e) => updateDocumentVisibility(d.id, e.target.value as DocVisibility)}
                          title={VISIBILITY_META[d.visibility].title}
                          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                          {VISIBILITY_OPTIONS.map((v) => <option key={v} value={v}>{VISIBILITY_META[v].icon} {VISIBILITY_META[v].label}</option>)}
                        </select>
                        <span className="text-xs text-gray-400">
                          {d.storage_path ? 'file' : 'link'}{size && ` · ${size}`}
                          {d.created_at && ` · uploaded ${d.created_at.slice(0, 10)}`}
                        </span>
                        <div className="ml-auto flex gap-1">
                          <button
                            onClick={() => d.storage_path ? openStored(d.storage_path!) : window.open(d.external_url, '_blank')}
                            className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                            Open
                          </button>
                          {d.storage_path && (
                            <button onClick={() => downloadStored(d.storage_path!, d.name)}
                              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                              Download
                            </button>
                          )}
                          <button onClick={() => startRenameDoc(d)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                            Rename
                          </button>
                          {authEnabled && d.storage_path && (
                            <>
                              <label className={`cursor-pointer rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 ${replacingDocId === d.id ? 'opacity-50' : ''}`}
                                title={documentVersionsAvailable
                                  ? 'Upload a new version — the previous file is kept in the version history'
                                  : "Upload a new file, keeping this document's name, folder and access grants"}>
                                {replacingDocId === d.id ? 'Uploading…' : documentVersionsAvailable ? 'Nova versão' : 'Replace'}
                                <input type="file" className="hidden" disabled={replacingDocId === d.id}
                                  onChange={(e) => { const f = e.target.files?.[0]; if (f) newVersion(d.id, f); e.target.value = ''; }} />
                              </label>
                              {documentVersionsAvailable && (
                                <button onClick={() => { setLinkVersionDocId(linkVersionDocId === d.id ? null : d.id); setLinkVersionUrl(''); setLinkVersionErr(''); }}
                                  disabled={replacingDocId === d.id}
                                  className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                  title="New version from a link or Google Drive">
                                  ou link
                                </button>
                              )}
                            </>
                          )}
                          {documentDetailsAvailable && (
                            <button onClick={() => startDetails(d)} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">
                              Details
                            </button>
                          )}
                          <button onClick={() => confirmDeleteDoc(d)} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-[#B00000] hover:bg-red-50">
                            Delete
                          </button>
                        </div>
                      </div>
                      <div data-tour-id="documents-views" className="mt-1 text-xs text-gray-500">
                        {grants.length} active grant(s) · {views.length} view(s)
                        {views.length > 0 && ` · last ${views[views.length - 1].viewed_at.slice(0, 16).replace('T', ' ')}`}
                      </div>
                      {detailsOpenId === d.id ? (
                        <div className="mt-2 flex flex-col gap-1">
                          <textarea value={detailsText} onChange={(e) => setDetailsText(e.target.value)} rows={2}
                            placeholder="What this contains, version, who it was prepared for…"
                            className="w-full rounded border border-gray-300 p-2 text-xs" />
                          <button onClick={() => saveDetails(d.id)} className="self-start rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white">
                            Save details
                          </button>
                        </div>
                      ) : d.details && documentDetailsAvailable ? (
                        <p className="mt-1 text-xs italic text-gray-400">{d.details}</p>
                      ) : null}
                      {linkVersionDocId === d.id && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
                          <input value={linkVersionUrl} onChange={(e) => setLinkVersionUrl(e.target.value)}
                            placeholder="Paste a link or Google Drive share URL…" autoFocus
                            className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
                          <button onClick={() => newVersionFromLink(d.id)} disabled={!linkVersionUrl.trim() || replacingDocId === d.id}
                            className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                            {replacingDocId === d.id ? 'Fetching…' : 'Fetch & version'}
                          </button>
                          <button onClick={() => { setLinkVersionDocId(null); setLinkVersionErr(''); }} className="text-xs text-gray-400 hover:underline">
                            Cancel
                          </button>
                          {linkVersionErr && <p className="w-full text-[11px] text-[#B00000]">{linkVersionErr}</p>}
                          <p className="w-full text-[10px] text-gray-400">
                            Fetched and stored as a real file, going through the same allowlist + malware scan as a direct upload — the link itself is never kept as a live reference.
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {versionModalDocId && typeof document !== 'undefined' && (() => {
              const d = db.documents.find((doc) => doc.id === versionModalDocId);
              if (!d) return null;
              const versions = db.documentVersions.filter((v) => v.document_id === d.id).sort((a, b) => b.version - a.version);
              // Prompt 301 §1 / CLAUDE.md — a fixed, full-viewport overlay must
              // portal to document.body: an ancestor with backdrop-blur/
              // transform/etc silently becomes fixed's containing block
              // otherwise (confirmed root-cause of a prior bug on this exact
              // pattern, see WorkspaceHeader's backdrop-blur incident).
              return createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setVersionModalDocId(null)}>
                  <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                    <div className="mb-3 flex items-start justify-between">
                      <h3 className="text-base font-bold text-gray-900">Version history — {d.name}</h3>
                      <button onClick={() => setVersionModalDocId(null)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
                    </div>
                    {versions.length === 0 ? <p className="text-sm text-gray-400">No prior versions.</p> : (
                      <ul className="space-y-2">
                        {versions.map((v) => {
                          const isCurrent = v.storage_path === d.storage_path;
                          return (
                            <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 p-2 text-sm">
                              <span className="font-semibold text-gray-900">v{v.version}</span>
                              {isCurrent && <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">current</span>}
                              {v.malware_scan_status === 'flagged' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-[#B00000]">⚠ flagged</span>}
                              <span className="text-xs text-gray-400">{v.uploaded_at.slice(0, 10)}{v.size != null ? ` · ${fmtBytes(v.size)}` : ''}</span>
                              <span className="ml-auto flex gap-2 text-xs">
                                <button onClick={() => openStored(v.storage_path)} className="text-cyan-700 hover:underline">Open</button>
                                <button onClick={() => downloadStored(v.storage_path, `${d.name} (v${v.version})`)} className="text-cyan-700 hover:underline">Download</button>
                                {!isCurrent && <button onClick={() => restoreVersion(d.id, v.storage_path, v.size)} className="text-cyan-700 hover:underline">Restore</button>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>,
                document.body,
              );
            })()}
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500">Access level for new documents</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {VISIBILITY_OPTIONS.map((v) => (
                  <button key={v} type="button" title={VISIBILITY_META[v].title} onClick={() => setDocVisibility(v)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${docVisibility === v ? 'bg-[#0E7490] text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                    {VISIBILITY_META[v].icon} {VISIBILITY_META[v].label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-400">Applies to whatever you add below — link or file upload. You can change it per document afterwards.</p>
            </div>
            <div className="mt-3 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-500">Add document (link)</div>
              <div className="mt-1 flex flex-wrap gap-2">
                <input value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="Name"
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="View-only URL"
                  className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <button disabled={!docName || !docUrl}
                  onClick={() => {
                    setDocErr('');
                    try {
                      addDocument({
                        folder_id: selFolder, name: docName, external_url: docUrl,
                        is_view_only: !docUrl.includes('/edit'), visibility: docVisibility,
                        watermark: false, downloadable: false,
                      });
                      setDocName(''); setDocUrl('');
                    } catch (e) { setDocErr((e as Error).message); }
                  }}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
              </div>
              {docErr && <div className="mt-1 text-xs text-[#B00000]">{docErr}</div>}
              {(() => {
                if (!docUrl) return null;
                const normalized = normalizeDocumentUrl(docUrl);
                if (normalized.includes('/edit')) {
                  return <div className="mt-1 text-xs text-[#B00000]">✗ Editable link — will be rejected. Get the view/share version.</div>;
                }
                if (normalized !== docUrl) {
                  return <div className="mt-1 text-xs text-green-700">✓ Google link detected — will be saved as a view-only link automatically.</div>;
                }
                return null;
              })()}
            </div>

            {authEnabled && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="text-xs font-medium text-gray-500">Or upload a file</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <input ref={fileInputRef} type="file" multiple disabled={uploading}
                    onChange={(e) => { const files = Array.from(e.target.files ?? []); if (files.length) uploadFiles(files); }}
                    className="text-sm" />
                  {uploadProgress && (
                    <span className="text-xs text-gray-400">
                      {uploadProgress.done}/{uploadProgress.total} uploaded{uploading ? '…' : ''}
                    </span>
                  )}
                </div>
                {uploadErr && <div className="mt-1 whitespace-pre-wrap text-xs text-[#B00000]">{uploadErr}</div>}
              </div>
            )}
          </Card>

          {/* Prompt 437 §D — passive advice only: never a modal, toast, or
              blocking gate, and never anything that reaches an investor
              (CLAUDE.md root rule — see vault-access-advice.ts's own
              header). Sits at the top of the sharing section so it's seen
              before Grant access, same "reachable with zero scroll"
              reasoning P120 Block B.1 already applied there — but never
              pushes Grant access down when there's nothing to say. */}
          {(vaultAdvice.inConversationWithoutAccess.length > 0 || vaultAdvice.hasNoNdaProtectedDocuments) && (
            <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {vaultAdvice.inConversationWithoutAccess.length > 0 && (
                <p>
                  You&apos;re in active conversation with {joinNames(vaultAdvice.inConversationWithoutAccess.map((e) => e.name))} — they still
                  have no data room access. Investors who are already talking to you usually expect a deeper level of information;
                  consider sharing the folders that answer their questions.
                </p>
              )}
              {vaultAdvice.hasNoNdaProtectedDocuments && (
                <p>
                  None of your shared documents require an NDA. Before sharing your most sensitive material (financial model, cap
                  table, contracts, IP), consider marking it 🔒 shared + NDA required — the same tri-state control you already use to
                  share.
                </p>
              )}
            </div>
          )}

          <div data-tour-id="documents-grants">
          <Card title="Access grants — the owner consents, access follows">
            {resendMsg && <p className="mb-2 text-xs text-gray-500">{resendMsg}</p>}

            {/* P120 Block B.1 — Grant access is the first thing in this card,
                full stop, regardless of how many grants already exist below.
                With 100 grants across 3 people this used to sit ~100 rows
                down; it must be reachable with zero scroll. */}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-gray-500">Grant access</div>
                {/* Prompt 154 gap 4 */}
                <button type="button"
                  onClick={() => { const next = !adHocInviteMode; resetGrantFlow(); setAdHocInviteMode(next); }}
                  className="text-[11px] font-medium text-[#0E7490] hover:underline">
                  {adHocInviteMode ? '← Back to entity search' : "Don't know who yet? Invite by email →"}
                </button>
              </div>

              {!adHocInviteMode && <>
              <div className="mt-2">
                <label className="mb-1 block text-[11px] font-medium text-gray-400">1. Which investor entity?</label>
                {grantEntityId && grantEntity ? (
                  <div className="flex items-center justify-between rounded border border-gray-300 px-2 py-1.5 text-sm">
                    <span className="font-medium text-gray-800">{grantEntity.name}</span>
                    <button type="button"
                      onClick={() => { setGrantEntityId(''); setGrantEntityQuery(''); setGrantScope(''); setGrantSpecificIds([]); setGrantShowInvite(false); setSelection({}); }}
                      className="text-[11px] font-medium text-[#0E7490] hover:underline">
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <input value={grantEntityQuery}
                        onChange={(e) => { setGrantEntityQuery(e.target.value); if (e.target.value) setShowFullGrantList(false); }}
                        placeholder="Search by name or email…"
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
                      {/* Prompt 278 §2 — the escape hatch: scroll and
                          recognize the name instead of typing it. */}
                      {!showFullGrantList && (
                        <button type="button" onClick={() => setShowFullGrantList(true)}
                          className="shrink-0 whitespace-nowrap text-[11px] font-medium text-[#0E7490] hover:underline">
                          See full list →
                        </button>
                      )}
                    </div>
                    {!grantEntityQuery_ && !showFullGrantList ? (
                      <p className="mt-1 px-1 text-xs text-gray-400">Type to search, or see the full list →</p>
                    ) : (
                    <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto rounded border border-gray-100 bg-gray-50 p-1">
                      {visibleGrantEntities.map((e) => (
                        <li key={e.id}>
                          {/* Prompt 222 §2 — chip de estado: passed/dormant/
                              invested continuam a ser sugeridos (avisar,
                              nunca esconder), mas deixam de o ser em
                              silêncio. Estados normais não geram chip. */}
                          <button type="button"
                            onClick={() => { setGrantEntityId(e.id); setGrantEntityQuery(''); setGrantScope(''); setGrantSpecificIds([]); setGrantShowInvite(false); setSelection({}); }}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-white">
                            <span className="flex-1">{e.name}</span>
                            {(() => {
                              const chip = entityStatusChip(e.status);
                              return chip ? (
                                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                  chip.tone === 'warn' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                                  {chip.label}
                                </span>
                              ) : null;
                            })()}
                          </button>
                        </li>
                      ))}
                      {visibleGrantEntities.length === 0 && catalogMatches.length === 0 && (
                        <li className="px-2 py-1.5 text-xs text-gray-400">No entity matches &quot;{grantEntityQuery}&quot;.</li>
                      )}
                      {/* Prompt 121 §2.6 — catalog matches are informational only,
                          not directly selectable: see the note on catalogMatches
                          above for why this doesn't wire straight to a "create
                          entity" action. */}
                      {catalogMatches.length > 0 && (
                        <li className="border-t border-gray-200 px-2 py-1.5 text-[11px] font-medium text-gray-400">
                          From your catalog — not yet in your pipeline
                        </li>
                      )}
                      {catalogMatches.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                          <span className="text-sm text-gray-500">{c.name}</span>
                          <a href="/pipeline" className="shrink-0 text-[11px] font-medium text-[#0E7490] hover:underline">Unlock on Pipeline →</a>
                        </li>
                      ))}
                    </ul>
                    )}
                  </>
                )}
              </div>

              {/* Prompt 222 §2 — a nota só para 'passed' (dormant fica pelo
                  chip, por decisão do revisor: menos grave). A data vem da
                  última interação classificada como pass; sem nenhuma, a
                  frase cai na versão sem data em vez de desaparecer. */}
              {grantEntityId && grantEntity?.status === 'passed' && (() => {
                const lastPassAt = db.interactions
                  .filter((i) => i.entity_id === grantEntityId && i.classification === 'pass')
                  .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1)?.occurred_at;
                const note = passedNote(grantEntity.name, lastPassAt);
                return note ? (
                  <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">{note}</p>
                ) : null;
              })()}

              {grantEntityId && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-gray-400">2. Who gets access?</label>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => { setGrantScope('everyone'); setGrantShowInvite(false); }}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${grantScope === 'everyone' ? 'border-[#0E7490] bg-cyan-50 text-[#0E7490]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      Everyone confirmed at this entity {entityAffiliatedPeople.length > 0 && `(${entityAffiliatedPeople.length})`}
                    </button>
                    <button onClick={() => setGrantScope('specific')}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${grantScope === 'specific' ? 'border-[#0E7490] bg-cyan-50 text-[#0E7490]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      Specific people
                    </button>
                  </div>
                  {grantScope === 'everyone' && entityAffiliatedPeople.length === 0 && (
                    <p className="mt-1 text-xs text-amber-700">No confirmed people at this entity yet — add someone via “Specific people” → “+ Invite someone new”.</p>
                  )}
                  {grantScope === 'everyone' && entityAffiliatedPeople.length > 0 && (
                    <p className="mt-1 text-xs text-gray-400">
                      Resolved live at grant time: {entityAffiliatedPeople.map((p) => p.full_name).join(', ')}. Re-run this if the team changes — it isn&apos;t re-checked automatically after granting.
                    </p>
                  )}
                  {/* Prompt 222 §2 — o caso que o 217 apanhou: "Everyone"
                      resolvia do_not_contact para dentro do grant sem o
                      founder ver o nome. Avisa e nomeia; não bloqueia (um
                      grant é dar acesso a quem já está em diálogo, não
                      abordar a frio — o hard stop do rules.ts é sobre
                      CONTACTAR). */}
                  {grantScope === 'everyone' && everyoneDncWarning(entityAffiliatedPeople) && (
                    <p className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800">
                      {everyoneDncWarning(entityAffiliatedPeople)}
                    </p>
                  )}

                  {grantScope === 'specific' && (
                    <div className="mt-2 space-y-2">
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-2">
                        {entityAffiliatedPeople.length === 0 && <p className="text-xs text-gray-400">No known people at this entity yet.</p>}
                        {entityAffiliatedPeople.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm">
                            <input type="checkbox" checked={grantSpecificIds.includes(p.id)}
                              onChange={(e) => setGrantSpecificIds((prev) => e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id))} />
                            {p.full_name}
                            {/* §2 — cor de aviso, não neutro: continua
                                selecionável, mas nunca em silêncio. */}
                            {p.do_not_contact && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                                title="Marked do-not-contact for outreach. Granting access isn't outreach — but they will get in.">
                                do-not-contact
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                      {!grantShowInvite ? (
                        <button onClick={() => setGrantShowInvite(true)} className="text-xs font-medium text-[#0E7490] hover:underline">
                          + Invite someone new
                        </button>
                      ) : (
                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                          <div className="flex flex-wrap gap-2">
                            <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Their name"
                              className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Their email" type="email"
                              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
                          </div>
                          {inviteEmail && grantEntity && (() => {
                            const domain = grantEntity.email_domain || (grantEntity.website ? grantEntity.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0] : undefined);
                            const emailDomain = inviteEmail.split('@')[1]?.toLowerCase();
                            if (domain && emailDomain && !domain.toLowerCase().includes(emailDomain) && !emailDomain.includes(domain.toLowerCase())) {
                              return <p className="mt-1 text-xs text-amber-700">This email doesn’t look like it belongs to {grantEntity.name} — continue if that’s expected (associates often use a personal or another firm’s email).</p>;
                            }
                            return null;
                          })()}
                          <p className="mt-1 text-[11px] text-gray-400">
                            Creates a low-confidence contact record and grants access — nothing is visible to them until they sign in and confirm “Is this you?”.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {grantEntityId && grantScope && (grantScope === 'everyone' ? entityAffiliatedPeople.length > 0 : (grantSpecificIds.length > 0 || (grantShowInvite && inviteEmail && inviteName))) && (
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-gray-400">3. What do they see?</label>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-2">
                    {roots.map((f) => <GrantTreeNode key={f.id} f={f} depth={0} />)}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1"><TriStateBox state="shared" onClick={() => {}} /> shared</span>
                    <span className="flex items-center gap-1"><TriStateBox state="shared_nda" onClick={() => {}} /> shared + NDA required</span>
                    <span className="flex items-center gap-1"><TriStateBox state="none" onClick={() => {}} /> not shared</span>
                  </div>
                  <input type="date" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)}
                    className="mt-2 rounded border border-gray-300 px-2 py-1.5 text-sm" title="Expiry (optional)" />
                  {(() => {
                    // Prompt 204(b) — aviso INFORMATIVO, nao bloqueante.
                    // Depois do 204(a) estes documentos ja nao saem por
                    // acidente (o gate impede-o); isto existe para o founder
                    // perceber porque e que o investidor nao os vai ver.
                    // Obrigar a confirmar quando nao ha risco nenhum treina
                    // as pessoas a clicar sem ler.
                    const selectedFolderIds = Object.entries(selection)
                      .filter(([k, st]) => st !== 'none' && k.startsWith('folder:'))
                      .map(([k]) => k.split(':')[1]);
                    const blocked = dueDiligenceUnderFolders(
                      db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id })),
                      db.documents.map((d) => ({ id: d.id, name: d.name, folder_id: d.folder_id, visibility: d.visibility })),
                      selectedFolderIds,
                    );
                    if (blocked.length === 0) return null;
                    return (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                        <span className="font-semibold">
                          {blocked.length} due-diligence {blocked.length === 1 ? 'document' : 'documents'} in here will NOT be shared by this grant:
                        </span>
                        <ul className="mt-1 list-disc pl-4">
                          {blocked.map((d) => <li key={d.id}>{d.name}</li>)}
                        </ul>
                        <p className="mt-1">
                          To share one of them, grant it on the document itself — a folder grant never opens a due-diligence document.
                        </p>
                      </div>
                    );
                  })()}
                  <div>
                    <button onClick={submitGrantTree} className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
                      4. Confirm — grant access
                    </button>
                    <button onClick={resetGrantFlow} className="mt-2 ml-2 text-sm text-gray-400 hover:underline">Cancel</button>
                  </div>
                </div>
              )}
              </>}

              {adHocInviteMode && (
                <div className="mt-2 space-y-2">
                  <label className="mb-1 block text-[11px] font-medium text-gray-400">Invite by email — not in your CRM yet</label>
                  <div className="flex flex-wrap gap-2">
                    <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Their name"
                      className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Their email" type="email"
                      className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Creates a grant with no entity/person record attached — it lands in People &amp; Access as an unassociated
                    grant until they sign in and confirm “Is this you?”, same as any other invite.
                  </p>

                  {inviteEmail.trim() && inviteName.trim() && (
                    <div className="mt-3">
                      <label className="mb-1 block text-[11px] font-medium text-gray-400">What do they see?</label>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-2">
                        {roots.map((f) => <GrantTreeNode key={f.id} f={f} depth={0} />)}
                      </div>
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                        <span className="flex items-center gap-1"><TriStateBox state="shared" onClick={() => {}} /> shared</span>
                        <span className="flex items-center gap-1"><TriStateBox state="shared_nda" onClick={() => {}} /> shared + NDA required</span>
                        <span className="flex items-center gap-1"><TriStateBox state="none" onClick={() => {}} /> not shared</span>
                      </div>
                      <input type="date" value={grantExpiry} onChange={(e) => setGrantExpiry(e.target.value)}
                        className="mt-2 rounded border border-gray-300 px-2 py-1.5 text-sm" title="Expiry (optional)" />
                      <div>
                        <button onClick={() => void submitAdHocEmailGrant()} className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
                          Confirm — grant access
                        </button>
                        <button onClick={resetGrantFlow} className="mt-2 ml-2 text-sm text-gray-400 hover:underline">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="mt-3 text-[11px] text-gray-400">
                Granting fires the “grant activated” automation for an already-known person: an access email drafts (or sends,
                in full-auto) and every view is logged back to the entity. An invited new person&apos;s grant stays hidden — no
                document or metadata — until they sign in via magic link and confirm “Is this you?”. Folder-level clicks
                cascade to everything inside it — click an individual document afterward to override just that one.
              </p>
            </div>

            {/* Item 1 (Lote E) step 5 — pending access_requests waiting on
                THIS founder, above the existing grants list so it's seen
                before scrolling, same "reachable with zero scroll" reasoning
                P120 Block B.1 already applied to Grant access itself. */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="mb-2 text-xs font-medium text-gray-500">
                Pending requests{pendingAccessRequests.length > 0 && ` — ${pendingAccessRequests.length}`}
              </div>
              {pendingAccessRequests.length === 0 ? (
                <p className="text-sm text-gray-400">No one is waiting on a response right now.</p>
              ) : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {pendingAccessRequests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <div className="font-medium text-gray-800">{r.requesterName ?? r.requesterEmail ?? 'Unknown investor'}</div>
                        <div className="text-xs text-gray-400">
                          {[...r.folderNames, ...r.documentNames].join(', ')
                            || (r.pendingItemCount ? `${r.pendingItemCount} item${r.pendingItemCount === 1 ? '' : 's'} waiting` : 'access')}
                          {' · requested '}{new Date(r.requestedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                      {/* Prompt 518 §1 — was a blind Grant/Decline pair. It
                          granted every folder/document on the request at once
                          with no way to choose, and 409'd on any request whose
                          flat arrays were empty — which is EVERY request made
                          through the newer items-based flow, since those keep
                          what was asked in access_request_items instead. The
                          409 had nowhere to render (resendMsg only shows in
                          the manual "Grant access" card far above), so the
                          button looked dead. That is exactly Nuno's "Grant não
                          executa nenhuma ação". Now it opens the real review
                          screen, which shows who asked, for what, and answers
                          item by item. */}
                      <Link href={`/documents/requests/${r.id}`}
                        className="shrink-0 rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">
                        Review request →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* P120 Block B.2/B.3 — grants grouped by person (3 people, not
                100 rows). Collapsed by default; expanding a person shows
                their individual grants with the existing per-grant
                Resend/Revoke. Revoke all = the same revokeGrant(g.id) call
                looped over that person's grants — no new route/RPC. */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="mb-2 text-xs font-medium text-gray-500">Granted so far{grantGroups.length > 0 && ` — ${grantGroups.length} ${grantGroups.length === 1 ? 'person' : 'people'}`}</div>
              {grantGroups.length === 0 ? <p className="text-sm text-gray-400">No grants yet. Grant access as conversations advance to diligence.</p> : (
                <ul className="divide-y divide-gray-100 text-sm">
                  {grantGroups.map((group) => {
                    const label = group.personId
                      ? <PersonLink id={group.personId}>{db.people.find((p) => p.id === group.personId)?.full_name ?? group.invitedName}</PersonLink>
                      : (group.invitedName ?? group.granteeEmail ?? group.invitedEmail);
                    const labelText = group.personId
                      ? (db.people.find((p) => p.id === group.personId)?.full_name ?? group.invitedName ?? 'this person')
                      : (group.invitedName ?? group.granteeEmail ?? group.invitedEmail ?? 'this person');
                    const docCount = group.grants.filter((g) => g.document_id).length;
                    const folderCount = group.grants.filter((g) => g.folder_id).length;
                    const anyActive = group.grants.some((g) => grantStatus(g, new Date()) === 'active');
                    const pendingInvite = group.grants.find((g) => grantStatus(g, new Date()) === 'pending_confirmation' && g.invited_email);
                    const expiries = group.grants.map((g) => g.expires_at).filter((e): e is string => !!e).sort();
                    const nearestExpiry = expiries[0];
                    const ndaRequired = group.grants.filter((g) => g.nda_required);
                    const ndaPending = ndaRequired.some((g) => !g.nda_accepted_at);
                    const expanded = expandedGrantGroups.has(group.key);
                    return (
                      <li key={group.key} className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => toggleGrantGroup(group.key)}
                            className="text-xs text-gray-400 hover:text-gray-700" title={expanded ? 'Collapse' : 'Expand'}>
                            {expanded ? '▾' : '▸'}
                          </button>
                          <span className="font-medium">{label}</span>
                          {anyActive ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">active</span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">awaiting confirmation</span>
                          )}
                          <span className="text-xs text-gray-500">
                            {docCount > 0 && `${docCount} document${docCount === 1 ? '' : 's'}`}
                            {docCount > 0 && folderCount > 0 && ', '}
                            {folderCount > 0 && `${folderCount} folder${folderCount === 1 ? '' : 's'}`}
                          </span>
                          {nearestExpiry && <span className="text-xs text-gray-400">until {nearestExpiry.slice(0, 10)}</span>}
                          {ndaRequired.length > 0 && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${ndaPending ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                              NDA {ndaPending ? 'pending' : 'accepted'}
                            </span>
                          )}
                          <div className="ml-auto flex gap-2">
                            {pendingInvite && (
                              <>
                                <button onClick={() => sendGuestInviteEmail(pendingInvite.invited_email!)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
                                  Resend
                                </button>
                                <button onClick={() => copyGuestLink(pendingInvite.invited_email!)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
                                  {copiedGuestLinkFor === pendingInvite.invited_email ? 'Copied!' : 'Copy guest link'}
                                </button>
                                {guestLinkFallback && guestLinkFallback.email === pendingInvite.invited_email && (
                                  <input readOnly value={guestLinkFallback.link} onFocus={(e) => e.currentTarget.select()}
                                    aria-label="Guest link — copy this yourself"
                                    className="mt-1 w-full rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-gray-700" />
                                )}
                              </>
                            )}
                            <button onClick={() => revokeAllInGroup(group, labelText)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-[#B00000] hover:bg-red-50">
                              Revoke all
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <ul className="mt-2 divide-y divide-gray-50 border-l-2 border-gray-100 pl-3">
                            {group.grants.map((g) => {
                              const status = grantStatus(g, new Date());
                              return (
                                <li key={g.id} className="flex flex-wrap items-center gap-2 py-1.5 text-xs">
                                  {status === 'pending_confirmation' ? (
                                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">awaiting confirmation</span>
                                  ) : (
                                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">active</span>
                                  )}
                                  <span className="text-gray-500">
                                    → {g.document_id ? db.documents.find((d) => d.id === g.document_id)?.name : db.folders.find((f) => f.id === g.folder_id)?.name}
                                  </span>
                                  {g.expires_at && <span className="text-gray-400">until {g.expires_at.slice(0, 10)}</span>}
                                  {g.nda_required && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${g.nda_accepted_at ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                                    NDA {g.nda_accepted_at ? 'accepted' : 'pending'}</span>}
                                  <div className="ml-auto flex gap-2">
                                    {status === 'pending_confirmation' && g.invited_email && (
                                      <button onClick={() => sendGuestInviteEmail(g.invited_email!)} className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
                                        Resend invite
                                      </button>
                                    )}
                                    <button onClick={() => revokeGrant(g.id)} className="rounded border border-red-200 px-2 py-0.5 text-xs text-[#B00000] hover:bg-red-50">Revoke</button>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
          </div>

          {/* Prompt 278 §3 — tied to the Folders tree's own current
              selection (selFolder), not a standalone picker: empty/hidden
              with nothing selected, per the prompt's own spec. */}
          {selFolder && <WhoHasAccessPanel folderId={selFolder} />}

          {ndaSystemAvailable && pendingNdaInvestors.length > 0 && (
            <Card title="Awaiting NDA">
              <ul className="space-y-2 text-sm">
                {pendingNdaInvestors.map((inv) => (
                  <li key={inv.personId ?? inv.email} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{inv.label}</span>
                    <span className="text-xs text-gray-400">
                      {inv.documentName ? `"${inv.documentName}" locked` : `${inv.count} item${inv.count === 1 ? '' : 's'} locked`} until the signed NDA is on file
                    </span>
                    <label className="ml-auto cursor-pointer rounded-lg border border-cyan-200 px-2.5 py-1 text-xs text-cyan-800 hover:bg-cyan-50">
                      Upload signed NDA
                      <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadNda(f, { personId: inv.personId, email: inv.email, documentId: inv.documentId }); }} />
                    </label>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-400">
                An AI cross-check compares the uploaded file against the investor&apos;s name and this org — a mismatch or
                unclear result is flagged for you to verify, but never blocks access on its own.
              </p>
            </Card>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
