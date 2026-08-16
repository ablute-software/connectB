'use client';
// Investor portal. Real mode (Supabase configured): grants/documents come
// from /api/portal/* (service-role — investors aren't org_members, so RLS
// can't grant them table access; signed URLs are minted server-side).
// Demo mode: unchanged, reads the local store directly.
//
// SECURITY FIX (audited 2026-07-27): this page used to let the visitor type
// ANY email and immediately fetch that email's grants — no proof of
// ownership. The flow now matches what the copy always promised: type an
// email, get a real magic link, and only once that link is clicked (a real
// Supabase session exists) does the page ask the server for access — and
// the server only ever trusts the session's own email (see
// /api/portal/access, /api/portal/view). Demo mode is untouched: there's no
// real auth to bypass there, it's local-browser data only.
//
// Data Room V2 (F5): NDA gating is per-item now, not a blanket page gate —
// unlocked items always show; a small note counts whatever's still pending
// a signed NDA. There's no self-click "I accept" anymore — a real signed
// NDA the founder uploads (and AI cross-checks) is what unlocks access now,
// so there's nothing for the investor to click through here.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { authEnabled, browserClient } from '@/lib/supabase';
import { descendantFolderIds, resolveDocumentAccess, unlockedGrants } from '@/lib/data-room';
import { HelpSupportWidget } from '@/components/HelpSupportWidget';
import { InvestorSignInForm } from '@/components/auth/InvestorSignInForm';
import { InvestorWorkspaceShell, type Tab } from '@/components/investor-workspace/InvestorWorkspaceShell';
import { InteractionLogDrawer } from '@/components/investor-workspace/InteractionLogDrawer';
import { RoundUpdatesFeed } from '@/components/investor-workspace/RoundUpdatesFeed';
import { QAPanel } from '@/components/investor-workspace/QAPanel';
import { SoftCommitButton } from '@/components/investor-workspace/SoftCommitButton';
import { deriveValuation } from '@/lib/dilution';
import { INSTRUMENT_LABELS } from '@/lib/investor-taxonomy';
import { SectionReviewToggle } from '@/components/investor-workspace/SectionReviewToggle';

interface PortalDoc {
  id: string; name: string; version?: string; watermark: boolean;
  downloadable: boolean; folder_id?: string; url: string | null;
}
interface PendingConfirmation { grantId: string; invitedName: string | null; orgName: string | null }
// Prompt 54 Bloco 1 — Zona 1 snapshot. Every field is nullable on purpose:
// this mirrors exactly what /api/portal/access's buildSnapshot() reads off
// `orgs`/`org_traction_metrics`, and a genuinely-unset value must render as
// "not shared yet," never a fabricated zero.
interface PortalSnapshot {
  name: string | null; one_liner: string | null; description: string | null;
  stage: string | null; stage_other: string | null; sectors: string[] | null;
  hq_city: string | null; country: string | null;
  round_raising: boolean | null;
  round_target_eur: number | null; round_secured_eur: number | null; round_min_ticket_eur: number | null;
  round_instruments: string[] | null; round_instrument_other: string | null;
  round_valuation_eur: number | null;
  // Prompt 115 Block E — absent entirely (not just null) until migration
  // 0111 lands; the display below falls back to labeling as pre-money.
  round_valuation_basis?: 'pre_money' | 'post_money' | null;
  round_runway_months: number | null; round_runway_post_months: number | null;
  round_target_close_date: string | null; round_use_of_funds: string | null; round_flexible: boolean | null;
  tractionMetrics: { id: string; label: string; value: string }[];
  // Prompt 56 Bloco 3 — round_secured_eur plus confirmed soft commits,
  // computed server-side; the progress bar reads this, never the raw
  // manually-entered field alone.
  securedShown?: number | null; softCommittedEur?: number;
}
interface PortalData {
  orgName: string | null; senderEmail?: string | null; pendingNdaCount: number;
  folders: { id: string; name: string }[]; documents: PortalDoc[];
  // Prompt 55 — the 6 fixed diligence-journey sections, each always
  // present (possibly with an empty documents array) so the client can
  // render "In preparation" rather than treat a missing key as an error.
  sections?: { key: string; label: string; documents: PortalDoc[] }[];
  pendingConfirmation?: PendingConfirmation[];
  // Prompt 48 — @ablute.pt QA fallback in /api/portal/access, no real
  // access_grants behind it. Shown as a banner, not folded into the normal
  // "signed in as" line, so it can never be mistaken for a real investor.
  qaAccess?: boolean;
  snapshot?: PortalSnapshot | null;
  orgId?: string;
  currentTicketSignal?: { range_label: string; range_min_eur: number | null; range_max_eur: number | null } | null;
}

// Prompt 54 Bloco 2 — fixed ranges per the spec, plus a free "Other" input.
const TICKET_RANGES: { label: string; min: number | null; max: number | null }[] = [
  { label: '€10k–25k', min: 10000, max: 25000 },
  { label: '€25k–50k', min: 25000, max: 50000 },
  { label: '€50k–100k', min: 50000, max: 100000 },
  { label: '€100k+', min: 100000, max: null },
];

function TicketSelector({ orgId, current, qaAccess }: {
  orgId: string; current: PortalData['currentTicketSignal']; qaAccess?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(current?.range_label ?? null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherValue, setOtherValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function choose(label: string, min: number | null, max: number | null) {
    setSelected(label); setOtherOpen(false); setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/portal/ticket-signal', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, range_min_eur: min, range_max_eur: max, range_label: label }),
      });
      const body = await res.json();
      if (body.ok) setSaved(true);
    } finally { setSaving(false); }
  }

  function submitOther() {
    const v = otherValue.trim();
    if (!v) return;
    choose(v, null, null);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">What ticket range are you considering?</h2>
      <p className="mt-0.5 text-xs text-gray-400">Editable any time — helps the founder understand who&apos;s looking and with what budget.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {TICKET_RANGES.map((r) => (
          <button key={r.label} onClick={() => choose(r.label, r.min, r.max)} disabled={saving}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected === r.label ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490] font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {r.label}
          </button>
        ))}
        <button onClick={() => setOtherOpen((v) => !v)} disabled={saving}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${selected && !TICKET_RANGES.some((r) => r.label === selected) ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490] font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          Other
        </button>
      </div>
      {otherOpen && (
        <div className="mt-2 flex gap-2">
          <input value={otherValue} onChange={(e) => setOtherValue(e.target.value)} placeholder="e.g. €150k–200k"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          <button onClick={submitOther} disabled={!otherValue.trim() || saving} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Save</button>
        </div>
      )}
      {saved && <p className="mt-2 text-xs text-green-700">{qaAccess ? 'Selection updated (QA session — not saved for real).' : 'Saved.'}</p>}
    </div>
  );
}

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', later: 'Later',
};
function fmtEur(n: number | null | undefined) {
  return n != null ? `€${n.toLocaleString('en-US')}` : null;
}

function SnapshotCard({ s }: { s: PortalSnapshot }) {
  const stageLabel = s.stage === 'other' ? (s.stage_other || 'Other') : STAGE_LABELS[s.stage ?? ''] ?? s.stage;
  const location = [s.hq_city, s.country].filter(Boolean).join(', ');
  const instruments = (s.round_instruments ?? []).map((v) => INSTRUMENT_LABELS[v] ?? v)
    .concat(s.round_instruments?.includes('other') && s.round_instrument_other ? [] : []).join(', ');
  // Round card only renders once there's genuinely something to show — never
  // a 0/0 progress bar or empty headline numbers when the founder hasn't
  // filled the round in yet (round_raising===false is a real "not raising"
  // answer, distinct from "hasn't answered/filled it").
  const securedShown = s.securedShown ?? s.round_secured_eur;
  const hasRoundData = s.round_raising !== false && (
    s.round_target_eur != null || securedShown != null || s.round_valuation_eur != null
    || s.round_min_ticket_eur != null || instruments || s.round_use_of_funds || s.round_target_close_date
  );
  const progressPct = s.round_target_eur && securedShown != null
    ? Math.min(100, Math.round((securedShown / s.round_target_eur) * 100)) : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h1 className="text-lg font-bold text-gray-900">{s.name}</h1>
      {s.one_liner && <p className="mt-0.5 text-sm text-gray-600">{s.one_liner}</p>}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {stageLabel && <span>{stageLabel}</span>}
        {(s.sectors ?? []).length > 0 && <span>{(s.sectors ?? []).join(', ')}</span>}
        {location && <span>{location}</span>}
      </div>

      {hasRoundData ? (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {progressPct != null && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{fmtEur(securedShown)} committed</span>
                <span>{fmtEur(s.round_target_eur)} target</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-[#0E7490]" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            {s.round_valuation_eur != null && (
              <div>
                <dt className="text-xs text-gray-400">Valuation ({(s.round_valuation_basis ?? 'pre_money') === 'post_money' ? 'post-money' : 'pre-money'})</dt>
                <dd>
                  {fmtEur(s.round_valuation_eur)}
                  {s.round_target_eur != null && (() => {
                    const d = deriveValuation(s.round_valuation_basis ?? 'pre_money', s.round_valuation_eur!, s.round_target_eur!);
                    return <span className="ml-1 text-xs text-gray-400">(pre {fmtEur(d.preMoneyEur)} · post {fmtEur(d.postMoneyEur)})</span>;
                  })()}
                </dd>
              </div>
            )}
            {s.round_min_ticket_eur != null && <div><dt className="text-xs text-gray-400">Min ticket</dt><dd>{fmtEur(s.round_min_ticket_eur)}</dd></div>}
            {instruments && <div><dt className="text-xs text-gray-400">Instrument</dt><dd>{instruments}</dd></div>}
            {s.round_runway_months != null && <div><dt className="text-xs text-gray-400">Runway now</dt><dd>{s.round_runway_months} mo</dd></div>}
            {s.round_runway_post_months != null && <div><dt className="text-xs text-gray-400">Runway post-round</dt><dd>{s.round_runway_post_months} mo</dd></div>}
            {s.round_target_close_date && <div><dt className="text-xs text-gray-400">Target close</dt><dd>{s.round_target_close_date}</dd></div>}
          </dl>
          {s.round_use_of_funds && (
            <div className="mt-3">
              <dt className="text-xs text-gray-400">Use of funds</dt>
              <ul className="mt-1 list-disc pl-4 text-sm text-gray-700">
                {s.round_use_of_funds.split('\n').map((line) => line.trim()).filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-400">Round details not shared yet.</p>
      )}

      {s.tractionMetrics.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-100 pt-4">
          {s.tractionMetrics.map((m) => (
            <div key={m.id}><div className="text-xs text-gray-400">{m.label}</div><div className="text-sm font-semibold text-gray-900">{m.value}</div></div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PortalPage() {
  const { db, recordDocumentView } = useStore();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [real, setReal] = useState<PortalData | null>(null);
  // Prompt 121 §2.3 — which startup's data room is open, if any. null means
  // "show the Pipeline list"; set to an orgId means "show that org's card",
  // and triggers loadAccess(orgId) below to refetch `real` for THAT org
  // specifically instead of whatever the default single-org fetch returned.
  const [openOrgId, setOpenOrgId] = useState<string | null>(null);
  // P133 (item 10) — the same Interaction log drawer PipelinePanel opens
  // from a card, reachable here too from the startup's own data-room view.
  const [interactionLogOpen, setInteractionLogOpen] = useState(false);

  function loadAccess(orgId?: string) {
    setLoading(true);
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : '';
    return fetch(`/api/portal/access${qs}`).then((r) => r.json()).then((d: PortalData) => {
      setReal(d);
      setLoading(false);
      return d;
    });
  }

  // Real-mode session state. undefined = still checking, null = signed out.
  const [sessionEmail, setSessionEmail] = useState<string | null | undefined>(undefined);

  // Demo-mode-only sign-in toggle (no real auth exists in demo mode).
  const [demoSignedIn, setDemoSignedIn] = useState(false);

  // Prompt 33 part 2 / 47 — "Is this you?", shown before anything else on
  // first login for a founder-invited grant. dismissedGrantIds handles
  // "This access isn't for me": the grant is deliberately left
  // pending_confirmation forever (no document exposure either way), not
  // declined via any new endpoint — there's nothing to revert.
  const [confirmName, setConfirmName] = useState('');
  const [confirmRole, setConfirmRole] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState('');
  const [dismissedGrantIds, setDismissedGrantIds] = useState<string[]>([]);

  // Prompt 50 — captured once via a lazy initializer, not re-read live
  // inside the effect below: React 18 dev Strict Mode runs that effect
  // twice, and the effect's own replaceState call (clearing `linkFailed`
  // from the URL) would make the SECOND invocation read a URL that's
  // already clean, silently falling through to the "check your email"
  // branch and overwriting the code-entry UI the first invocation had just
  // set up. A lazy initializer runs before any effect (and before any
  // replaceState), so both Strict Mode invocations see the same value.
  //
  // Bug fix (2026-08-05) — the actual sign-in FORM (magic link, code,
  // password, and the code-entry pre-fill this used to drive) now lives
  // entirely in InvestorSignInForm, shared with /login?as=investor. This
  // page just still owns the URL itself (clearing `linkFailed` after
  // reading it) and the session check, since those aren't the form's job.
  const [linkFailed] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('linkFailed') === '1');

  // P134-B — the dossier's "Equity calculator" header shortcut deep-links to
  // /portal?tab=evaluation&orgId=…; read once via the same lazy-initializer
  // + plain URLSearchParams technique linkFailed already uses above, rather
  // than next/navigation's useSearchParams (which would force this
  // statically-rendered page behind a Suspense boundary for one query read).
  const [initialTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'pipeline';
    const t = new URLSearchParams(window.location.search).get('tab');
    return (t === 'evaluation' ? 'evaluation' : 'pipeline') as Tab;
  });
  const [initialEvaluationOrgId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('orgId') : null);

  useEffect(() => {
    if (!authEnabled) return;
    browserClient().auth.getUser().then(({ data }) => {
      setSessionEmail(data.user?.email?.toLowerCase() ?? null);
    });
    if (linkFailed) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [linkFailed]);

  useEffect(() => {
    if (!authEnabled || !sessionEmail) return;
    loadAccess().then((d) => {
      const firstPending = d.pendingConfirmation?.[0];
      if (firstPending?.invitedName) setConfirmName(firstPending.invitedName);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEmail]);

  const activePendingConfirmation = (real?.pendingConfirmation ?? []).filter((p) => !dismissedGrantIds.includes(p.grantId));

  async function confirmIdentity(grantId: string) {
    setConfirmErr(''); setConfirmBusy(true);
    try {
      const res = await fetch('/api/portal/confirm-identity', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grantId, name: confirmName, role: confirmRole || undefined }),
      });
      const result = await res.json();
      if (!result.ok) { setConfirmErr(result.error ?? 'Could not confirm.'); return; }
      // Reload from the server rather than patching local state — the
      // confirmed grant may now unlock real documents this response never
      // carried while it was pending_confirmation.
      await loadAccess();
      setConfirmRole('');
    } finally { setConfirmBusy(false); }
  }

  // Prompt 121 §2.3 — a Pipeline card opens ITS OWN startup's data room, not
  // a single fixed one. onBackToPipeline deliberately doesn't refetch —
  // `real` only ever backs the startup-card view, never the Pipeline list
  // itself, so there's nothing stale to clear until the next org is opened.
  function openStartupOrg(orgId: string) {
    setOpenOrgId(orgId);
    void loadAccess(orgId);
  }
  function backToPipeline() {
    setOpenOrgId(null);
  }

  // ---- demo-mode data (unchanged behaviour, mirrors the real route's
  // per-item NDA gate so the demo preview matches production exactly) ----
  const person = db.people.find((p) => p.email_verified?.toLowerCase() === email.toLowerCase());
  const demoAllGrants = db.grants.filter((g) =>
    !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date())
    && ((person && g.person_id === person.id) || g.grantee_email?.toLowerCase() === email.toLowerCase()));
  // Same resolution as the real /api/portal/access route: a document's own
  // grant overrides the folder it lives in, in either direction — a naive
  // "any unlocked grant covers it" check would let a looser folder-level
  // grant silently bypass a stricter per-document override (caught live).
  // Prompt 204 §A — o candidato deixa de ser "esta exactamente na pasta
  // concedida" e passa a ser "esta na subarvore da pasta concedida", igual ao
  // que a rota real faz.
  const demoFolderTree = db.folders.map((f) => ({ id: f.id, parent_id: f.parent_id }));
  const demoGrantedSubtree = new Set(descendantFolderIds(
    demoFolderTree, demoAllGrants.filter((g) => g.folder_id).map((g) => g.folder_id as string),
  ));
  const demoCandidateDocs = db.documents.filter((d) =>
    demoAllGrants.some((g) => g.document_id === d.id) || (d.folder_id ? demoGrantedSubtree.has(d.folder_id) : false));
  const demoDocAccess = resolveDocumentAccess(demoAllGrants, demoCandidateDocs.map((d) => ({ id: d.id, folder_id: d.folder_id, visibility: d.visibility })), demoFolderTree);
  const demoDocs = demoCandidateDocs.filter((d) => demoDocAccess.visibleIds.includes(d.id));
  const demoFolderGrants = demoAllGrants.filter((g) => g.folder_id);
  const demoUnlockedFolderGrants = unlockedGrants(demoFolderGrants);
  const demoFolders = db.folders.filter((f) => demoUnlockedFolderGrants.some((g) => g.folder_id === f.id));
  const demoPendingNdaCount = (demoFolderGrants.length - demoUnlockedFolderGrants.length) + demoDocAccess.pendingCount;

  function openDoc(doc: PortalDoc | { id: string; external_url?: string }) {
    if (authEnabled) {
      fetch('/api/portal/view', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ documentId: doc.id }),
      });
    } else {
      recordDocumentView(doc.id, email);
    }
    window.open(('url' in doc ? doc.url : doc.external_url) ?? '#', '_blank');
  }

  const signedIn = authEnabled ? !!sessionEmail : demoSignedIn;
  const orgName = authEnabled ? real?.orgName : db.org.name;
  const senderEmail = authEnabled ? real?.senderEmail : db.org.sender_email;
  const pendingNdaCount = authEnabled ? real?.pendingNdaCount ?? 0 : demoPendingNdaCount;
  const folders = authEnabled ? real?.folders ?? [] : demoFolders;
  const documents = authEnabled ? real?.documents ?? [] : demoDocs;
  const hasAccess = authEnabled
    ? ((real?.documents.length ?? 0) + (real?.folders.length ?? 0) + (real?.pendingNdaCount ?? 0)) > 0
    : demoAllGrants.length > 0;

  // Investor Workspace shell (prompt 57) — once there's real access to
  // show, the page switches from the plain header+card layout (used for
  // every pre-auth/pending/no-access state above) to the sidebar shell.
  // Demo mode keeps the old flat layout unchanged (no sidebar concept
  // there yet) — only the real-auth + real-access path gets it.
  if (authEnabled && signedIn && hasAccess && !loading && activePendingConfirmation.length === 0) {
    const startupCard = (
      <div className="space-y-4">
        {authEnabled && real?.orgId && <RoundUpdatesFeed orgId={real.orgId} />}
        {authEnabled && real?.snapshot && <SnapshotCard s={real.snapshot} />}
        {authEnabled && real?.orgId && (
          <TicketSelector orgId={real.orgId} current={real.currentTicketSignal} qaAccess={real.qaAccess} />
        )}
        {authEnabled && real?.orgId && <SoftCommitButton orgId={real.orgId} />}
        {authEnabled && real?.orgId && (
          <button onClick={() => setInteractionLogOpen(true)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:border-[#0E7490]">
            🗂 Interaction log
          </button>
        )}
        {authEnabled && real?.orgId && <QAPanel orgId={real.orgId} />}
        {authEnabled && real?.orgId && interactionLogOpen && (
          <InteractionLogDrawer orgId={real.orgId} orgName={real.snapshot?.name ?? orgName ?? 'Startup'}
            onClose={() => setInteractionLogOpen(false)} />
        )}
        {pendingNdaCount > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Awaiting NDA — {pendingNdaCount} more item{pendingNdaCount === 1 ? '' : 's'} will appear here once your signed NDA is on file.
          </div>
        )}
        {authEnabled && real?.sections ? (
          // Prompt 55 — data room as a diligence journey: 6 fixed sections
          // in a fixed order, never a flat folder list. A section with no
          // documents shows "In preparation" instead of just vanishing —
          // an investor should never wonder if a section was skipped.
          real.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-900">{s.label}</h2>
                {real.orgId && <SectionReviewToggle orgId={real.orgId} sectionKey={s.key} />}
              </div>
              {s.documents.length === 0 ? (
                <p className="mt-1 text-xs text-gray-400">In preparation.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {s.documents.map((d) => (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3">
                      <span className="text-lg">▤</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium">{d.name}</div>
                        <div className="text-xs text-gray-400">{d.version} {d.watermark && '· watermarked'} {!d.downloadable && '· view only, no download'}</div>
                      </div>
                      <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">Open</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        ) : (
          <>
            {folders.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold">{f.name}</h2>
                <p className="text-xs text-gray-400">Folder access — documents appear here as they are added.</p>
              </div>
            ))}
            {documents.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <span className="text-xl">▤</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-gray-400">{d.version} {d.watermark && '· watermarked'} {!d.downloadable && '· view only, no download'}</div>
                </div>
                <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Open</button>
              </div>
            ))}
          </>
        )}
        <p className="text-center text-[10px] text-gray-400">Every access is logged. ablute_ · Seed Round 2026</p>
        <ClaimProfileSection />
      </div>
    );
    const sessionLabel = (
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium text-gray-700">{sessionEmail}</div>
        <div className="text-[10px] uppercase tracking-wide text-[#0E7490]">investor</div>
      </div>
    );
    return (
      <InvestorWorkspaceShell
        entityName={real?.snapshot?.name ?? orgName ?? null} startupCard={startupCard} sessionLabel={sessionLabel}
        openStartup={openOrgId != null} onOpenStartup={openStartupOrg} onBackToPipeline={backToPipeline}
        initialTab={initialTab} initialEvaluationOrgId={initialEvaluationOrgId}
        qaAccess={real?.qaAccess}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <span className="text-xl font-bold text-[#0E7490]" style={{ fontFamily: 'Comfortaa, sans-serif' }}>ablute<span className="text-[#22D3EE]">_</span></span>
            <span className="ml-2 text-sm text-gray-400">Investor data room</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[10px] font-bold text-[#B00000]">CONFIDENTIAL — SUBJECT TO NDA</span>
            <HelpSupportWidget source="investor_portal" className="text-xs text-gray-400 hover:text-gray-600" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl p-6">
        {!authEnabled && !signedIn ? (
          // Demo mode — no real auth backend, so there's nothing to prove.
          <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-gray-500">Enter the email your access was granted to.</p>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@fund.com"
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <button onClick={() => setDemoSignedIn(true)} disabled={!email.includes('@')}
              className="mt-3 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              Send magic link (demo: signs in directly)
            </button>
          </div>
        ) : authEnabled && sessionEmail === undefined ? (
          <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>
        ) : authEnabled && !sessionEmail ? (
          // Bug fix (2026-08-05) — this used to be a second, entirely
          // separate sign-in form (magic link only, no password, and no
          // link to the page that had one) that every real investor path
          // (the magic-link redirect, /login's own default `next`) lands
          // on and bookmarks — so investors never saw password sign-in at
          // all, no matter how many times they set one. Now renders the
          // same InvestorSignInForm as /login?as=investor. See that
          // component's own header for the full root-cause writeup.
          <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-gray-500">Enter the email your access was granted to.</p>
            <div className="mt-4 text-left">
              <InvestorSignInForm next="/portal" linkFailed={linkFailed} />
            </div>
            <Link href="/forgot-password" className="mt-3 block w-full text-center text-xs text-gray-400 hover:underline">
              Forgot your password?
            </Link>
          </div>
        ) : loading ? (
          <div className="mt-16 text-center text-sm text-gray-400">Loading…</div>
        ) : authEnabled && activePendingConfirmation.length > 0 ? (
          // Prompt 33 part 2 / 47 — shown before ANY document/folder, even
          // if this same email also has other already-active grants. No
          // document content or metadata reaches this page while pending —
          // /api/portal/access already excludes it server-side; this screen
          // only ever received {grantId, invitedName, orgName}.
          (() => {
            const pending = activePendingConfirmation[0];
            return (
              <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
                <h1 className="text-lg font-semibold">Is this you?</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {pending.orgName ?? 'A startup'} gave you access to documents as <b>{pending.invitedName ?? 'you'}</b>.
                </p>
                <div className="mt-4 text-left">
                  <label className="mb-1 block text-xs font-medium text-gray-500">Your name</label>
                  <input value={confirmName} onChange={(e) => setConfirmName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <label className="mb-1 mt-3 block text-xs font-medium text-gray-500">Your role (optional)</label>
                  <input value={confirmRole} onChange={(e) => setConfirmRole(e.target.value)} placeholder="e.g. Principal"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <button onClick={() => confirmIdentity(pending.grantId)} disabled={!confirmName.trim() || confirmBusy}
                  className="mt-4 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                  {confirmBusy ? 'Confirming…' : 'Confirm'}
                </button>
                <button onClick={() => setDismissedGrantIds((prev) => [...prev, pending.grantId])}
                  className="mt-2 w-full text-xs text-gray-400 hover:underline">
                  This access isn’t for me
                </button>
                {confirmErr && <p className="mt-2 text-xs text-[#B00000]">{confirmErr}</p>}
              </div>
            );
          })()
        ) : !hasAccess ? (
          // Deliberately generic — identical wording whether this email has
          // no grant, an expired grant, or was never invited. Never reveals
          // which emails do or don't have access.
          <div className="mt-16 text-center text-sm text-gray-500">
            No active access for this account. If you believe this is an error, contact {senderEmail ?? 'the founder'}.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Prompt 54 Bloco 0 — the "QA access" banner is gone on
                purpose: the whole point of @ablute.pt QA sessions is to see
                EXACTLY what a real investor sees, pixel for pixel. The
                non-contamination guarantee (no document_views row, no
                ticket-signal row visible to the founder, nothing in any
                dashboard) still holds — it's just enforced server-side now
                (is_ablute_developer() checks in each write route) instead
                of being disclosed here. See DECISIONS.md for the full
                audit of every write path this covers. */}
            {authEnabled && real?.snapshot && <SnapshotCard s={real.snapshot} />}
            {authEnabled && real?.orgId && (
              <TicketSelector orgId={real.orgId} current={real.currentTicketSignal} qaAccess={real.qaAccess} />
            )}
            <p className="text-sm text-gray-500">Signed in as <b>{authEnabled ? sessionEmail : email}</b>{orgName ? <> · <b>{orgName}</b></> : ''}. You can see only the items granted to you.</p>
            {pendingNdaCount > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                Awaiting NDA — {pendingNdaCount} more item{pendingNdaCount === 1 ? '' : 's'} will appear here once your signed NDA is on file.
              </div>
            )}
            {folders.map((f) => (
              <div key={f.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <h2 className="text-sm font-semibold">{f.name}</h2>
                <p className="text-xs text-gray-400">Folder access — documents appear here as they are added.</p>
              </div>
            ))}
            {documents.map((d) => (
              <div key={d.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <span className="text-xl">▤</span>
                <div className="flex-1">
                  <div className="text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-gray-400">{d.version} {d.watermark && '· watermarked'} {!d.downloadable && '· view only, no download'}</div>
                </div>
                <button onClick={() => openDoc(d)} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Open</button>
              </div>
            ))}
            <p className="text-center text-[10px] text-gray-400">Every access is logged. ablute_ · Seed Round 2026</p>
            <ClaimProfileSection />
          </div>
        )}
      </main>
    </div>
  );
}

// IRM_SPEC §5 — investor self-claim. Inert until LinkedIn OAuth is actually
// configured (a claim needs a verified identity to score a match against);
// GDPR/RGPD requests don't wait on this — see /privacy-request.
function ClaimProfileSection() {
  const enabled = process.env.NEXT_PUBLIC_LINKEDIN_OAUTH_ENABLED === 'true';
  return (
    <div className="mt-2 rounded-lg border border-dashed border-gray-200 bg-white p-4 text-center">
      <h2 className="text-sm font-semibold text-gray-700">Is this you?</h2>
      {enabled ? (
        <button className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Sign in with LinkedIn to claim your profile</button>
      ) : (
        <p className="mt-1 text-xs text-gray-400">
          LinkedIn sign-in is coming soon. In the meantime, you can{' '}
          <a href="/privacy-request" className="text-[#0E7490] hover:underline">request a correction or removal</a> of your info directly.
        </p>
      )}
    </div>
  );
}
