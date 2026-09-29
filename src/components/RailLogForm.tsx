'use client';
// Prompt 397 §B.3 / 400 §B.1 — "Log" mode of the entity page's conversation
// panel: record an interaction without leaving the page. Validation is NOT
// reimplemented — src/app/log/page.tsx was read in full before writing this,
// and the save() below calls the exact same store.logInteraction with the
// exact same preflight/lintMessage gates for outbound, so a message this
// form refuses is refused for the same reason /log would refuse it.
// Prompt 400 §B.1 brought this to full parity with /log's own surface —
// Draft with AI (same draftWithAi machine, same Watson accounting),
// amount asked, a next-action suggestion offered right after Save, and
// Gmail send — so /log itself is only a legacy deep-link now (§B.2), not a
// feature this panel is missing. The one deliberate, spec-approved
// exception: no web-form assist panel (§B.1.1's own text: "fica onde está
// por agora" — /log stays reachable for that one flow).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { Tooltip, PREFLIGHT_EXPLAIN } from '@/components/ui';
import { lintMessage, preflight, preflightSummary } from '@/lib/rules';
import { nextContactPerson, recommendChannel, PASS_REASON_CATEGORIES, suggestNextAction, type NextActionSuggestion } from '@/lib/relationship';
import { buildComposerContext, pickIntent, INTENT_LABEL, type ComposerIntent } from '@/lib/composer';
import { topicsAlreadyOnTheTable } from '@/lib/deal-terms';
import { evaluateProvenanceGate, type ComposerClaim } from '@/lib/company-canon-logic';
import { channelOutcomes, channelOutcomesSummary } from '@/lib/channel-learning';
import { AI_COMPOSER_LOCKED_COPY } from '@/lib/plans';
import { authEnabled, browserClient } from '@/lib/supabase';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { FirstContactGuideCard } from '@/components/dossier/FirstContactGuideCard';
import { PitchAndAskFields } from '@/components/dossier/PitchAndAskFields';
import { FormAssistModal } from '@/components/FormAssistModal';
import { QuickCreatePerson } from '@/components/QuickCreatePerson';
import { promotableCatalogTeam as computePromotableCatalogTeam, shouldShowFirstContactGuide, type CatalogTeamMember } from '@/lib/first-contact-selector';
import type { Channel, Classification, DealTermKind, DealTermSide, DocumentItem, Entity, Folder, OverrideRule, PassReasonCategory } from '@/lib/types';

// Prompt 894 §B — "no + Log, além de 'Amount asked', um pequeno 'Terms
// mentioned in this message'". Excludes 'ask' (that's exactly what the
// Amount-asked field above already covers, and the ask_amount_eur ->
// deal_terms trigger already creates that row — a second control for the
// same kind would double it) and orders the rest by how often a founder
// would plausibly log one from a single message.
const TERM_KINDS: { v: DealTermKind; l: string }[] = [
  { v: 'offer', l: 'Offer' }, { v: 'commitment', l: 'Commitment' }, { v: 'valuation', l: 'Valuation' },
  { v: 'instrument', l: 'Instrument' }, { v: 'lead_role', l: 'Lead/follower' },
  { v: 'ticket_range', l: 'Ticket range' }, { v: 'timing', l: 'Timing' }, { v: 'other', l: 'Other' },
];

// Mirrors src/app/log/page.tsx's own CHANNELS/CLASSIFICATIONS — display
// labels only, not business logic, so a small duplicate is the same
// tradeoff already made by every other channel-label list in this codebase
// (EditInteractionDetails.tsx, InteractionLogTimeline.tsx, …).
const CHANNELS: { v: Channel; l: string }[] = [
  { v: 'linkedin_dm', l: 'LinkedIn DM' }, { v: 'linkedin_note', l: 'LinkedIn note' },
  { v: 'email', l: 'Email' }, { v: 'web_form', l: 'Web form' }, { v: 'call', l: 'Call' },
  { v: 'meeting', l: 'Meeting' }, { v: 'event', l: 'Event' }, { v: 'intro', l: 'Intro' },
];
const CLASSIFICATIONS: Classification[] = ['awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear'];

export function RailLogForm({
  entity, defaultPersonId, prefillNonce, defaultDraft, draftNonce, defaultChannel, channelNonce, onSaved,
}: {
  entity: Entity;
  // Prompt 397 §A.4/§B.3.3 — the Sherlock Insight banner's "Log the first
  // interaction"/"Reply now" buttons prefill the target person here.
  // prefillNonce bumps on every click, even to the same person, since a
  // click is a fresh request to prefill, not just a value that happens to
  // match what's already selected.
  defaultPersonId?: string;
  prefillNonce?: number;
  // Prompt 400 §B.2 — the document-request review page's "Log this request
  // as an interaction" link (Prompt 372 Block D) used to pre-fill /log's
  // direction/date/content directly via query params; carried through the
  // same way now (Prompt 893 §A: ?tab=conversation&mode=log&direction=in&
  // date=&content= on the entity page). Separate from defaultPersonId/
  // prefillNonce on purpose: this
  // doesn't drive the §D.1 "Pre-filled from Sherlock's insight" shimmer,
  // which is specifically about the Insight banner's own suggestions.
  defaultDraft?: { direction?: 'out' | 'in'; date?: string; content?: string };
  draftNonce?: number;
  // Prompt 884 — the Today redesign's "Add meeting summary" button: the
  // channel must default to 'meeting', not the form's own usual
  // 'linkedin_dm' default. Same narrow-reapply-only-on-nonce-bump shape as
  // defaultDraft/draftNonce above, kept separate rather than folded into
  // defaultDraft since it's a distinct entry point (the Meetings card, not
  // the document-request review page) with its own trigger.
  defaultChannel?: Channel;
  channelNonce?: number;
  onSaved: () => void;
}) {
  const { db, logInteraction, addDocument, addGrant, addCompanyFact, addTask, updateEntity, ensureOrgPersonFromCatalog, addDealTerm } = useStore();
  const people = db.people.filter((p) => p.entity_id === entity.id).sort((a, b) => a.seniority_rank - b.seniority_rank);

  const [personId, setPersonId] = useState('');
  const [prefilledPersonId, setPrefilledPersonId] = useState<string | null>(null);
  const [noSpecificPerson, setNoSpecificPerson] = useState(false);
  // Prompt 896 §A — the entity's catalog-affiliated team, for the "From
  // their team — adds as contact" optgroup. A live read (same chain
  // EntityPeoplePanel.tsx already queries), not copied into `db`: the
  // catalog can gain people after this form first mounts.
  const [catalogTeam, setCatalogTeam] = useState<CatalogTeamMember[]>([]);
  const [promotingCatalogPerson, setPromotingCatalogPerson] = useState<string | null>(null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  // Prompt 893 §B — '' is a real, distinct state now: "Channel to confirm"
  // (recommendChannel's own null case) leaves the select empty rather than
  // silently defaulting to LinkedIn DM (the exact bug the spec names —
  // this used to be a hardcoded 'linkedin_dm' regardless of what was
  // actually verified for the person). Watson is disabled while empty (see
  // the composer block below); save() never persists '' (falls back to
  // 'email' defensively — see its own comment).
  const [channel, setChannel] = useState<Channel | ''>('linkedin_dm');
  const [showFormAssist, setShowFormAssist] = useState(false);
  const [whatDate, setWhatDate] = useState('');
  const [content, setContent] = useState('');
  const [classification, setClassification] = useState<Classification | ''>('');
  const [passCat, setPassCat] = useState<PassReasonCategory>('other');
  const [passReason, setPassReason] = useState('');
  const [reopenAck, setReopenAck] = useState(false);
  const [justification, setJustification] = useState('');
  const [showOverride, setShowOverride] = useState(false);
  const [toast, setToast] = useState('');
  // Prompt 400 §B.1.3 — amount asked, mirrors /log's own optional
  // ask_amount_eur field exactly; outbound only, same as there.
  const [askAmount, setAskAmount] = useState('');
  // Prompt 894 §B — "Terms mentioned in this message": a second, independent
  // optional term, kind+side+value chosen by the founder, recorded via
  // addDealTerm right after logInteraction succeeds (never folded into
  // LogInput/ask_amount_eur's own DB-trigger path — this is a different
  // kind of term, and unlike ask_amount_eur it can be 'theirs' as easily as
  // 'ours', so it needs its own side control). Not gated to direction==='out'
  // — a term can just as easily be exposed in an inbound reply.
  const [termKind, setTermKind] = useState<DealTermKind | ''>('');
  const [termSide, setTermSide] = useState<DealTermSide>('theirs');
  const [termAmount, setTermAmount] = useState('');
  const [termText, setTermText] = useState('');
  // Prompt 400 §B.1.1 — Draft with AI, the exact same machine as /log
  // (draftWithAi below is a near-verbatim port): same state shape, same
  // /api/compose call, same §11b provenance gate, same Watson accounting.
  const [intent, setIntent] = useState<ComposerIntent>('first_touch');
  const [composing, setComposing] = useState(false);
  const [composerNote, setComposerNote] = useState('');
  const [composerMeta, setComposerMeta] = useState<{ rationale: string; confidence: number } | null>(null);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [pendingQuestions, setPendingQuestions] = useState<ComposerClaim[]>([]);
  const [pendingAnswer, setPendingAnswer] = useState('');
  const [aiComposerLocked, setAiComposerLocked] = useState(false);
  const [watson, setWatson] = useState<{ quota: number; used: number; remaining: number; resetAt: string } | null>(null);
  // §B.1.1 follow-on: an AI email draft can carry a subject line
  // (data.draft.subject) — without this field it would silently vanish,
  // which is the kind of loss "same machine" is meant to rule out. Folded
  // into content at save time exactly like /log's own fullContent.
  const [subject, setSubject] = useState('');
  // Stamps who the current draft was written for (typed or AI-drafted) so
  // switching person without clearing the textarea is caught as stale —
  // same purpose as /log's draftedFor, simplified to just personId since
  // this form's entity never changes underneath it (only /log's can).
  const [draftedForPersonId, setDraftedForPersonId] = useState<string | null>(null);
  // Prompt 400 §B.1.4 — offered right after a successful Save, not as a
  // pre-save field: keeps the main form focused, and "what's next" is a
  // post-save question anyway (/log's own manual next-action field is the
  // one piece of §B.1.4 NOT ported — see the file header comment).
  const [pendingSuggestion, setPendingSuggestion] = useState<NextActionSuggestion | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState(false);
  const [suggestionTitle, setSuggestionTitle] = useState('');
  const [suggestionDue, setSuggestionDue] = useState('');
  // §B.2 gap closed — Gmail send. /log's canSendViaGmail path wasn't in
  // §B.1's own list of 4 gaps to close, but leaving it out would mean the
  // redirect (§B.2) drops a capability, which its own text forbids. Same
  // state/endpoint/gate as /log.
  const [gmail, setGmail] = useState<{ configured: boolean; connected: boolean; email?: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  // Prompt 397 §C — attachments picked in THIS draft, not yet saved. Each is
  // exactly one document OR folder (mirrors AccessGrant/InteractionDocument).
  // Sharing (options 2/3 below) creates the access grant immediately, at the
  // moment of picking — not deferred to Save — same "additive, revoke is a
  // separate action elsewhere" precedent the documents page's own grant flow
  // already follows; removing the chip here only removes the attachment
  // link, never the grant it may have already created.
  const [attachments, setAttachments] = useState<{ documentId?: string; folderId?: string; label: string; origin: string }[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [attachSubmenu, setAttachSubmenu] = useState<'document' | 'folder' | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachErr, setAttachErr] = useState('');
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prompt 397 §C.1.2 — same dropdown pattern as RelationshipSummaryCard's
  // own menus: absolute, closes on Escape or a click outside.
  useEffect(() => {
    if (!attachMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) { setAttachMenuOpen(false); setAttachSubmenu(null); }
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { setAttachMenuOpen(false); setAttachSubmenu(null); } }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [attachMenuOpen]);

  // §C.2 — reuses the documents page's own addGrant exactly (same shape:
  // person_id + document_id XOR folder_id, nda_required false here — the
  // Log panel doesn't offer an NDA step); §C.2.2 dedups against any
  // still-active grant already covering this exact (person, target).
  function ensureGrant(target: { documentId?: string; folderId?: string }) {
    if (!personId) return;
    const already = db.grants.some((g) => !g.revoked_at && g.person_id === personId
      && (target.documentId ? g.document_id === target.documentId : g.folder_id === target.folderId));
    if (already) return;
    addGrant({ person_id: personId, document_id: target.documentId, folder_id: target.folderId, nda_required: false });
  }

  function attachExistingDocument(doc: DocumentItem) {
    ensureGrant({ documentId: doc.id });
    setAttachments((prev) => [...prev, { documentId: doc.id, label: doc.name, origin: 'Vault · view-only' }]);
    setAttachMenuOpen(false); setAttachSubmenu(null);
  }

  function attachExistingFolder(folder: Folder) {
    ensureGrant({ folderId: folder.id });
    setAttachments((prev) => [...prev, { folderId: folder.id, label: folder.name, origin: 'folder · full access' }]);
    setAttachMenuOpen(false); setAttachSubmenu(null);
  }

  // §C.2.3 — upload alone creates no grant (a decision, not a rule fork:
  // /log's own "Material shared" field never granted access either — it
  // only ever linked a document that was ALREADY shared through the Vault's
  // own grant flow). Sharing the freshly uploaded document is a second,
  // explicit step: reopen Attach → Share a Vault document, now that it
  // exists. Reuses documents/page.tsx's exact upload path (uploadAndVerifyFile
  // + addDocument, is_view_only/visibility/watermark/downloadable all the
  // same), read in full before writing this, never a second upload route.
  async function attachFromComputer(file: File) {
    setAttaching(true); setAttachErr('');
    try {
      const folderId = db.folders.find((f) => f.name === 'Investor deck')?.id ?? db.folders[0]?.id;
      if (!folderId) throw new Error('No Vault folder exists yet — add one on the Documents page first.');
      const verified = await uploadAndVerifyFile(db.org.id, file);
      const docId = addDocument({
        folder_id: folderId, name: file.name, storage_path: verified.storagePath,
        is_view_only: true, visibility: 'on_grant', watermark: false, downloadable: false,
        malware_scan_status: verified.malwareScanStatus as DocumentItem['malware_scan_status'],
      });
      setAttachments((prev) => [...prev, { documentId: docId, label: file.name, origin: 'from this computer' }]);
      setAttachMenuOpen(false); setAttachSubmenu(null);
    } catch (e) {
      setAttachErr((e as Error).message);
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  // §B.1.1 — near-verbatim port of /log's own refreshMe/draftWithAi/
  // answerPendingQuestion. Same endpoints, same gates, same Watson
  // accounting; only goToEntity()'s router.push is gone (this form never
  // leaves the entity page) and there's no web-form-assist branch (out of
  // scope here — see the file header comment).
  function refreshMe() {
    return fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => {
        setAiComposerLocked(!!me.authEnabled && !!me.entitlements && !me.entitlements.aiComposer);
        setWatson(me.watson ?? null);
      })
      .catch(() => {});
  }

  useEffect(() => {
    refreshMe();
    fetch('/api/oauth/google/status').then((r) => r.json()).then(setGmail).catch(() => setGmail({ configured: false, connected: false }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prompt 896 §A — same catalog_deliveries -> catalog_id ->
  // catalog_person_affiliations -> catalog_people chain EntityPeoplePanel.tsx
  // already reads, for the second optgroup below. Demo mode (no live
  // catalog_deliveries) simply leaves this empty — same fallback shape as
  // every other authEnabled-gated read in this file.
  useEffect(() => {
    if (!authEnabled) { setCatalogTeam([]); return; }
    let cancelled = false;
    (async () => {
      const sb = browserClient();
      const { data: delivery } = await sb.from('catalog_deliveries').select('catalog_id').eq('entity_id', entity.id).maybeSingle();
      if (cancelled || !delivery) { if (!cancelled) setCatalogTeam([]); return; }
      const { data: rows } = await sb.from('catalog_person_affiliations')
        .select('title, seniority_rank, catalog_people ( id, full_name )')
        .eq('entity_id', delivery.catalog_id as string).eq('current', true);
      if (cancelled) return;
      const members = (rows ?? [])
        .map((r) => {
          const cp = (Array.isArray(r.catalog_people) ? r.catalog_people[0] : r.catalog_people) as { id: string; full_name: string } | null;
          if (!cp) return null;
          return { catalogPersonId: cp.id, fullName: cp.full_name, title: r.title as string | null, seniorityRank: r.seniority_rank as number } as CatalogTeamMember;
        })
        .filter((m): m is CatalogTeamMember => !!m);
      setCatalogTeam(members);
    })();
    return () => { cancelled = true; };
  }, [entity.id]);

  const promotableCatalogTeam = useMemo(
    () => computePromotableCatalogTeam(catalogTeam, people),
    [catalogTeam, people],
  );

  async function handlePersonSelect(value: string) {
    if (value === '__none__') { setPersonId(''); setNoSpecificPerson(true); return; }
    if (value === '__add__') { setAddingPerson(true); return; }
    if (value.startsWith('catalog:')) {
      const catalogPersonId = value.slice('catalog:'.length);
      setPromotingCatalogPerson(catalogPersonId);
      try {
        const result = await ensureOrgPersonFromCatalog({ entityId: entity.id, catalogPersonId });
        setPersonId(result.person.id);
        setNoSpecificPerson(false);
        setToast(`Added ${result.person.full_name} as your contact.`);
        window.setTimeout(() => setToast(''), 2500);
      } finally {
        setPromotingCatalogPerson(null);
      }
      return;
    }
    setPersonId(value);
    setNoSpecificPerson(false);
  }

  // Same trigger as /log's own intent effect: a fresh intent guess whenever
  // the target person changes (entity is fixed on this form, unlike /log).
  useEffect(() => {
    setIntent(pickIntent(db, entity.id));
    setAiGenerated(false); setComposerMeta(null); setComposerNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, noSpecificPerson]);

  // Stamps who the content was written for, same purpose as /log's
  // draftedFor — lets a person switch without clearing the textarea be
  // caught as a stale draft below.
  useEffect(() => {
    if (content.trim().length === 0) { setDraftedForPersonId(null); return; }
    setDraftedForPersonId(noSpecificPerson ? '__none__' : personId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);
  const staleDraft = draftedForPersonId !== null && content.trim().length > 0
    && draftedForPersonId !== (noSpecificPerson ? '__none__' : personId);

  async function draftWithAi() {
    if (!person && !noSpecificPerson) return;
    // Prompt 893 §B — Watson stays disabled until a real channel is
    // chosen (see the button's own `disabled` below); this is the
    // corresponding guard on the function itself, not just the button.
    if (!channel) return;
    setComposing(true); setComposerNote(''); setComposerMeta(null); setPendingQuestions([]);
    try {
      const context = buildComposerContext(db, entity.id, personId, channel);
      const res = await fetch('/api/compose', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context, channel, intent }),
      });
      const data = await res.json();
      if (data.configured === false) { setComposerNote(data.message); return; }
      if (data.error) { setComposerNote(`AI draft failed: ${data.error}`); return; }

      // §11b HARD gate — same as /log: a draft with any unconfirmed/
      // unflagged claim is never shown.
      if (data.draft.claims?.length) {
        const confirmedIds = new Set(db.companyFacts.filter((f) => f.status === 'confirmed').map((f) => f.id));
        const gate = evaluateProvenanceGate(data.draft, confirmedIds);
        if (!gate.grounded) {
          const unresolved = [
            ...gate.pendingQuestions,
            ...gate.ungroundedClaims.map((c) => ({
              ...c,
              needsConfirmation: c.needsConfirmation ?? {
                question: `The draft states "${c.text}" — is that accurate?`,
                options: ['Yes — add to the canon', 'No — leave it out'],
              },
            })),
          ];
          setPendingQuestions(unresolved);
          setComposerNote('This draft made a claim that needs your confirmation first — the draft itself is not shown yet.');
          return;
        }
      }

      setContent(data.draft.body);
      if (channel === 'email') setSubject(data.draft.subject ?? '');
      setComposerMeta({ rationale: data.draft.rationale, confidence: data.draft.confidence });
      setAiGenerated(true);
      void refreshMe(); // a credit was just spent — keep the Watson card current
    } catch (e) {
      setComposerNote(`AI draft failed: ${(e as Error).message}`);
    } finally {
      setComposing(false);
    }
  }

  function answerPendingQuestion(answer: string) {
    if (!pendingQuestions[0]) return;
    const now = new Date().toISOString();
    addCompanyFact({ category: 'other', statement: answer, status: 'confirmed', source: 'user', confirmed_at: now });
    const rest = pendingQuestions.slice(1);
    setPendingQuestions(rest);
    setPendingAnswer('');
    if (rest.length === 0) { setComposerNote(''); draftWithAi(); } // all answered — regenerate
  }

  // §B.1.4 — accept/edit/ignore the post-save suggestion, same shape as
  // /log's own (source: 'suggested' vs 'manual' on the created task).
  function acceptSuggestion() {
    if (!pendingSuggestion) return;
    addTask({
      title: pendingSuggestion.title, due_at: pendingSuggestion.dueAt, action_type: pendingSuggestion.actionType,
      kind: 'follow_up', entity_id: entity.id, person_id: personId || undefined, source: 'suggested',
    });
    setPendingSuggestion(null);
    onSaved();
  }

  function saveEditedSuggestion() {
    if (!suggestionTitle.trim()) return;
    addTask({
      title: suggestionTitle.trim(), due_at: suggestionDue ? `${suggestionDue}T12:00:00Z` : undefined,
      action_type: pendingSuggestion?.actionType ?? 'other',
      kind: 'follow_up', entity_id: entity.id, person_id: personId || undefined, source: 'manual',
    });
    setPendingSuggestion(null);
    onSaved();
  }

  function ignoreSuggestion() {
    setPendingSuggestion(null);
    onSaved();
  }

  useEffect(() => {
    if (defaultPersonId) {
      setPersonId(defaultPersonId);
      setNoSpecificPerson(false);
      setDirection('out');
      // Prompt 397 §D.1 — the simple criterion: the shimmer shows while
      // personId still equals what the banner suggested, and disappears the
      // moment the founder picks someone else or "No specific person".
      // Content prefill (defaultDraft, below) is a separate channel and
      // deliberately does NOT drive this shimmer — it's specifically about
      // the Insight banner's own suggestions.
      setPrefilledPersonId(defaultPersonId);
    } else if (!personId) {
      const fallback = nextContactPerson(db, entity.id);
      if (fallback) setPersonId(fallback.id);
    }
    // Deliberately narrow: only re-applies on a fresh prefill request
    // (nonce bump) or first mount — must NOT stomp a founder's own manual
    // person choice on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillNonce]);

  // Prompt 400 §B.2 — the document-request review page's own prefill
  // (direction/date/content), same narrow-reapply-only-on-nonce-bump shape
  // as the person prefill above.
  useEffect(() => {
    if (!defaultDraft) return;
    if (defaultDraft.direction) setDirection(defaultDraft.direction);
    if (defaultDraft.date) setWhatDate(defaultDraft.date);
    if (defaultDraft.content) setContent(defaultDraft.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftNonce]);

  // Prompt 884 — same narrow shape as the two effects above: only
  // re-applies on a fresh nonce bump, never stomps a channel the founder
  // already picked themselves.
  useEffect(() => {
    if (defaultChannel) setChannel(defaultChannel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelNonce]);

  const person = people.find((p) => p.id === personId);

  // Prompt 893 §B — "the selected person has never been contacted". Scoped
  // to OUTBOUND only: logging a historical INBOUND reply for a person with
  // no prior outbound (a cold inbound, e.g. an unsolicited submission) is
  // not "my first contact with them" in the sense this guide is about.
  const neverContactedSelection = direction === 'out' && (
    person ? !db.interactions.some((i) => i.entity_id === entity.id && i.person_id === person.id)
      : noSpecificPerson ? !db.interactions.some((i) => i.entity_id === entity.id && i.direction === 'out')
        : false
  );

  // Prompt 896 §B — the guide used to only exist once a person (or "No
  // specific person") was already chosen, which meant a founder with zero
  // contacts and zero interactions had no way to ever see it: the very
  // thing meant to tell them what to do next was hidden behind the choice
  // it's supposed to help them make. Before any selection, fall back to
  // "has this entity ever had an outbound at all" — the same first-contact
  // scope neverContactedSelection already uses for the no-specific-person
  // case, just not yet keyed to a specific selection.
  const noOutboundEver = !db.interactions.some((i) => i.entity_id === entity.id && i.direction === 'out');
  const showGuideCard = shouldShowFirstContactGuide({
    direction, hasSelection: !!person || noSpecificPerson, neverContactedSelection, noOutboundEver,
  });

  // Prompt 893 §B — initializes the channel select from the shared
  // recommendation the moment this becomes a genuine first-contact
  // scenario, replacing the old hardcoded 'linkedin_dm' default. An
  // explicit external prefill (defaultChannel, Prompt 884's own effect
  // above) always wins — checked by reading the prop directly rather than
  // depending on it, so a defaultChannel that arrives AFTER this effect
  // already ran doesn't get silently overwritten on some later re-render
  // this effect doesn't re-fire for anyway (deps are personId/
  // noSpecificPerson only, on purpose — this must not fight the founder's
  // own manual channel pick on every render).
  useEffect(() => {
    if (defaultChannel) return;
    if (!neverContactedSelection) return;
    setChannel(recommendChannel(person, entity).value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId, noSpecificPerson]);

  const channelRec = useMemo(() => recommendChannel(person, entity), [person, entity]);
  // Fase 1 (measure only) — org-wide, no entityType/seniority slice yet;
  // see channel-learning.ts's own header for why Fase 2's tie-break logic
  // is deliberately not built here.
  const outcomesSummary = useMemo(() => channelOutcomesSummary(channelOutcomes(db)), [db]);
  // Prompt 894 §D — see the "Already on the table" hint above; computed
  // from db.dealTerms only, never touching composer.ts/ComposerContext.
  const alreadyOnTheTable = useMemo(() => topicsAlreadyOnTheTable(db.dealTerms, entity.id), [db.dealTerms, entity.id]);

  // Prompt 578 §B.3 — grows with the content instead of a fixed 5 rows (a
  // 20-line AI/prefilled draft used to show only 6 of its own lines, with no
  // cue more was hiding below). Caps at ~24 so one huge paste can't push the
  // Save button off-screen — the textarea's own default overflow scrolling
  // takes over past that point, same as before this change.
  const textareaRows = Math.min(24, Math.max(5, content.split('\n').length + 1));

  const checks = useMemo(() =>
    person && direction === 'out' ? preflight(db, person, channel || null) : [],
    [db, person, channel, direction]);
  const summary = preflightSummary(checks);
  const lint = useMemo(() =>
    person && direction === 'out' && content && channel ? lintMessage(content, person, entity, channel) : [],
    [content, person, entity, channel, direction]);
  const lintErrors = lint.filter((f) => f.severity === 'error');

  const passMissing = direction === 'in' && classification === 'pass' && passReason.trim().length === 0;
  const classificationMissing = direction === 'in' && classification === '';
  const reopenTrigger = entity.status === 'dormant' ? entity.reopen_trigger : undefined;
  const reopenBlocked = direction === 'out' && !!reopenTrigger && !reopenAck;
  // Prompt 893 §B — an unresolved "Channel to confirm" blocks Save for an
  // OUTBOUND log, same discipline as requiring a person: the founder must
  // pick a real channel before this can be sent, never silently fall back
  // to whatever the select happened to default to.
  const channelMissing = direction === 'out' && channel === '';
  const formReady = content.trim().length > 0 && (direction === 'in' || !!person || noSpecificPerson)
    && !passMissing && !classificationMissing && !reopenBlocked && !channelMissing;
  const disabledReason = content.trim().length === 0 ? 'Write the message content.'
    : direction === 'out' && !person && !noSpecificPerson ? 'Select a person, or choose "No specific person" if this was sent to a general channel.'
    : channelMissing ? 'Choose a channel first — nothing verified yet.'
    : classificationMissing ? 'Choose what they said — it decides the stage.'
    : passMissing ? 'A pass reason is required.'
    : reopenBlocked ? 'Confirm the reopening checkbox above.'
    : null;

  const blockedHard = direction === 'out' && (summary.blocked || lintErrors.length > 0);
  const needsOverride = direction === 'out' && !summary.green && !summary.blocked;
  const needsManualSendConfirmation = direction === 'out' && (channel === 'email' || channel === 'linkedin_dm' || channel === 'linkedin_note');
  const primarySaveLabel = needsManualSendConfirmation ? 'I confirm this was sent' : 'Save interaction';
  const wasPrefilled = !!prefilledPersonId && !noSpecificPerson && personId === prefilledPersonId;

  function save(withOverrides: boolean, sentFrom?: string) {
    if (!formReady) return;
    const overrides = withOverrides
      ? summary.failed.filter((f) => f.overridable).map((f) => ({ rule: f.key as OverrideRule, justification }))
      : [];
    // §B.1.1 — same fullContent fold as /log: an AI-drafted (or manually
    // typed) email subject is never dropped on the floor.
    const fullContent = channel === 'email' && subject ? `Subject: ${subject}\n\n${content}` : content;
    // Prompt 893 §B — channelMissing already blocks formReady for an
    // OUTBOUND save with no channel chosen, so this only ever falls back
    // for an INBOUND log where the select was left at '' (never surfaced
    // to the founder as a choice for 'in' — see the guide card, outbound
    // only) — 'email' is the same generic fallback Channel already used
    // for a "no specific person" institutional reply elsewhere.
    const effectiveChannel: Channel = channel || 'email';
    const interaction = logInteraction({
      entity_id: entity.id, person_id: personId || undefined, direction, channel: effectiveChannel, content: fullContent,
      occurred_at: whatDate ? new Date(whatDate).toISOString() : undefined,
      sent_from: direction === 'out' && channel === 'email' ? (sentFrom ?? db.org.sender_email) : undefined,
      classification: direction === 'in' ? (classification as Classification) : direction === 'out' ? 'awaiting' : undefined,
      // §B.1.3
      ask_amount_eur: direction === 'out' && askAmount.trim() !== '' ? Number(askAmount) : undefined,
      pass_reason_category: classification === 'pass' ? passCat : undefined,
      pass_reason: classification === 'pass' ? passReason : undefined,
      overrides,
      ai_generated: aiGenerated || undefined,
      attachments: attachments.length ? attachments.map((a) => ({ documentId: a.documentId, folderId: a.folderId })) : undefined,
    });
    setToast(direction === 'out' ? `Saved. Contact lock set for 14 days.${overrides.length ? ' Override logged.' : ''}` : 'Reply saved.');
    // Prompt 894 §B — "Terms mentioned in this message": fired straight
    // after logInteraction, tagged with the interaction id it just
    // returned. Fire-and-forget like every other post-save side effect on
    // this form (addTask, etc.) — a failed term write here would not undo
    // the interaction that was already saved.
    if (termKind && !entity.negotiation_locked_at && (termAmount.trim() !== '' || termText.trim() !== '')) {
      void addDealTerm({
        entityId: entity.id, kind: termKind, side: termSide, formality: 'mentioned',
        amountEur: termAmount.trim() !== '' ? Number(termAmount) : undefined,
        text: termText.trim() || undefined,
        personId: personId || undefined, interactionId: interaction.id,
      });
    }
    setContent(''); setClassification(''); setPassReason(''); setJustification(''); setShowOverride(false); setReopenAck(false);
    setAttachments([]);
    setPrefilledPersonId(null);
    setAskAmount(''); setSubject(''); setAiGenerated(false); setComposerMeta(null); setComposerNote(''); setDraftedForPersonId(null);
    setTermKind(''); setTermAmount(''); setTermText(''); setTermSide('theirs');

    // §B.1.4 — same gate as /log: only offered when the founder didn't
    // already handle "what's next" some other way (a pass, for instance,
    // naturally yields no suggestion — suggestNextAction returns null).
    // Prompt 564 §B — the context the suggestion needs, resolved here rather
    // than inside suggestNextAction so that function stays pure. Only
    // `web_form` reads it today; passing it unconditionally means a future
    // channel that needs a person does not have to re-wire this call site.
    const suggestion = suggestNextAction(
      direction, effectiveChannel, direction === 'in' ? (classification as Classification) : undefined, interaction.occurred_at,
      { entityName: entity?.name, followUpPersonName: entity ? (nextContactPerson(db, entity.id)?.full_name ?? null) : null },
    );
    if (suggestion) {
      setPendingSuggestion(suggestion);
      setSuggestionTitle(suggestion.title);
      setSuggestionDue(suggestion.dueAt.slice(0, 10));
      setToast('');
      return; // wait for Accept/Edit/Ignore below instead of returning to History
    }
    window.setTimeout(() => { setToast(''); onSaved(); }, 700);
  }

  async function sendViaGmail() {
    if (!person?.email_verified || !formReady || lintErrors.length > 0) return;
    setSending(true); setSendErr('');
    try {
      const res = await fetch('/api/compose/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: person.email_verified, subject, body: content }),
      });
      const data = await res.json();
      if (data.ok === false) { setSendErr(data.error); return; }
      save(false, data.sentFrom);
    } catch (e) {
      setSendErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const canSendViaGmail = direction === 'out' && channel === 'email' && gmail?.connected && !!person?.email_verified;

  return (
    <div className="space-y-3">
      {/* Prompt 893 §B — "no topo do +Log": a step-by-step guide shown only
          while this is a genuine first contact for the current selection.
          Purely informational — the actual Person/Channel controls below
          are unchanged and still the real inputs. */}
      {showGuideCard && (
        <FirstContactGuideCard
          person={person} noSpecificPerson={noSpecificPerson}
          personDone={!!person || noSpecificPerson} channel={channelRec} channelDone={!!channel}
          messageDone={content.trim().length > 0} outcomesSummary={outcomesSummary}
          showFormAssist={entity.submission_channel_type === 'form' && !!entity.submission_channel}
          onPrepareFormAnswers={() => setShowFormAssist(true)}
        />
      )}
      <div>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Person</label>
        {/* Prompt 896 §A — three groups: the org's own contacts; the
            entity's catalog-affiliated team (picking one promotes it via
            ensureOrgPersonFromCatalog, the same helper EntityPeoplePanel's
            own "Add as contact" already uses — one materialization path,
            not two); "No specific person". When both the org and the
            catalog have nobody at all, the only way out used to be leaving
            this tab entirely for People & Team's own "Add as contact" — the
            exact deadlock this prompt exists to close — so that case
            collapses to a single option that opens QuickCreatePerson
            in-line instead. */}
        <select value={noSpecificPerson ? '__none__' : personId} disabled={!!promotingCatalogPerson}
          onChange={(e) => void handlePersonSelect(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Select person…</option>
          {people.length === 0 && promotableCatalogTeam.length === 0 ? (
            <option value="__add__">Nobody on file — add someone</option>
          ) : (
            <>
              {people.length > 0 && (
                <optgroup label="Your contacts">
                  {people.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.do_not_contact}>
                      {p.seniority_rank} · {p.full_name}{p.do_not_contact ? ' — DO NOT CONTACT' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {promotableCatalogTeam.length > 0 && (
                <optgroup label="From their team — adds as contact">
                  {promotableCatalogTeam.map((m) => (
                    <option key={m.catalogPersonId} value={`catalog:${m.catalogPersonId}`}>
                      {m.seniorityRank} · {m.fullName}{m.title ? ` · ${m.title}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          )}
          <option value="__none__">No specific person — general/website channel</option>
        </select>
        {promotingCatalogPerson && <p className="mt-1 text-[11px] text-gray-400">Adding as contact…</p>}
        {addingPerson && (
          <div className="mt-2">
            <QuickCreatePerson entityId={entity.id}
              onCreated={(pid) => { setPersonId(pid); setNoSpecificPerson(false); setAddingPerson(false); }}
              onCancel={() => setAddingPerson(false)} />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-300">
          {(['out', 'in'] as const).map((d) => (
            <button key={d} onClick={() => setDirection(d)}
              className={`px-2.5 py-1.5 text-xs font-medium ${direction === d ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'}`}>
              {d === 'out' ? '→ Out' : '← In'}
            </button>
          ))}
        </div>
        <select value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')}
          className={`flex-1 rounded border px-2 py-1.5 text-xs ${channel === '' ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
          {/* Prompt 893 §B — only ever selected when recommendChannel found
              nothing verified; picking it back manually is still possible
              (the founder decided something the recommender couldn't see). */}
          <option value="">Channel to confirm — choose one</option>
          {CHANNELS.map((c) => <option key={c.v} value={c.v}>{c.l}</option>)}
        </select>
      </div>
      <input type="date" value={whatDate} onChange={(e) => setWhatDate(e.target.value)}
        title="When this happened — defaults to now if left blank"
        className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs" />

      {/* Prompt 893 §B/§D — "How we pitch this firm" / "What we ask for
          first", editable, right above Let Watson Draft: "Watson uses
          these two when drafting." Same position for both the guided
          first-contact case and any later outbound log — these two fields
          are always what Watson reads, not only during first contact. */}
      {direction === 'out' && (person || noSpecificPerson) && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
          <PitchAndAskFields entity={entity} onSave={(patch) => updateEntity(entity.id, patch)} />
          <p className="mt-1.5 text-[10.5px] text-gray-400">Watson uses these two when drafting.</p>
        </div>
      )}

      {/* Prompt 894 §D — "Watson... para não pedir de novo o que já foi
          oferecido." Deliberately a plain, deterministic (non-AI) founder-
          facing hint, NEVER passed into buildComposerContext/`/api/compose`
          — see TermsOnTheTable.tsx's header comment for the full
          founder-privacy audit on why that boundary matters here. This is
          the whole of §D's Watson wiring: awareness for the human writing
          the message, not a model input. */}
      {direction === 'out' && (person || noSpecificPerson) && alreadyOnTheTable.length > 0 && (
        <p className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-[11px] text-gray-500">
          Already on the table (don&apos;t ask again): {alreadyOnTheTable.map((k) => TERM_KINDS.find((t) => t.v === k)?.l ?? k).join(', ')}.
        </p>
      )}

      {/* §B.1.1 — same order as /log's own "2 · What" card: intent +
          Draft with AI, then composerNote / pendingQuestions / composerMeta
          / staleDraft, then (email only) subject, then the textarea. */}
      {direction === 'out' && (person || noSpecificPerson) && (
        aiComposerLocked ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
            <span className="text-[11px] text-gray-500">✨ {AI_COMPOSER_LOCKED_COPY}.</span>
            <a href="/plans" className="text-[11px] font-medium text-[#0E7490] hover:underline">View plans</a>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-cyan-100 bg-[#E8F4F8]/50 px-2.5 py-2">
            <select value={intent} onChange={(e) => setIntent(e.target.value as ComposerIntent)}
              className="rounded border border-gray-300 px-1.5 py-1 text-[11px]">
              {(Object.keys(INTENT_LABEL) as ComposerIntent[]).map((i) => <option key={i} value={i}>{INTENT_LABEL[i]}</option>)}
            </select>
            <Tooltip text={!channel
              ? 'Choose a channel above first — Watson tailors the draft to it (length, tone, whether an ask belongs in message one).'
              : person
                ? "Generates a draft using this person's hook and the entity's context — never sent automatically."
                : "Generates a draft addressed to the firm generally, using the entity's context — never sent automatically."}>
              <button disabled={composing || !channel} onClick={draftWithAi}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40">
                {composing ? 'Drafting…' : '✨ Let Watson Draft'}
              </button>
            </Tooltip>
            {/* Prompt 706 — "drafts left" retired: `watson.remaining` now
                reads the shared AI-credits wallet, spent by many actions
                besides this one, not a dedicated per-draft pool. */}
            {watson && <span className="text-[10.5px] text-gray-400">{watson.remaining} AI credit{watson.remaining === 1 ? '' : 's'} left this month</span>}
          </div>
        )
      )}
      {composerNote && <div className="rounded bg-gray-50 border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600">{composerNote}</div>}
      {pendingQuestions[0] && (
        <div className="rounded-lg border border-purple-300 bg-purple-50 p-2.5">
          <p className="text-[12.5px] font-medium text-purple-900">{pendingQuestions[0].needsConfirmation!.question}</p>
          <p className="mt-0.5 text-[10.5px] text-purple-700">Your answer is added to the Company canon so future drafts already know it.</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pendingQuestions[0].needsConfirmation!.options.map((opt) => (
              <button key={opt} onClick={() => answerPendingQuestion(opt)}
                className="rounded-lg border border-purple-300 bg-white px-2 py-1 text-[11px] font-medium text-purple-800 hover:bg-purple-100">
                {opt}
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input value={pendingAnswer} onChange={(e) => setPendingAnswer(e.target.value)} placeholder="Or type the real answer…"
              className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
            <button disabled={!pendingAnswer.trim()} onClick={() => answerPendingQuestion(pendingAnswer.trim())}
              className="rounded-lg bg-[#0E7490] px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40">Confirm</button>
          </div>
        </div>
      )}
      {composerMeta && (
        <div className="rounded bg-[#E8F4F8]/60 border border-cyan-100 px-2.5 py-1.5 text-[11px] text-cyan-900">
          <span className="font-semibold">AI rationale:</span> {composerMeta.rationale} · confidence {Math.round(composerMeta.confidence * 100)}%
        </div>
      )}
      {staleDraft && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-400 bg-amber-50 px-2.5 py-2">
          <span className="flex-1 text-[12px] font-medium text-amber-900">This draft was written for someone else — update it or clear it.</span>
          <button onClick={() => setContent('')}
            className="rounded border border-amber-500 bg-white px-1.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100">
            Clear
          </button>
        </div>
      )}
      {direction === 'out' && channel === 'email' && (
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      )}

      <div>
        <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">What happened</label>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={textareaRows}
          placeholder={direction === 'out' ? 'Paste the message verbatim…' : 'Paste the reply verbatim…'}
          className="mt-1 w-full rounded border border-gray-300 p-2 text-sm" />
      </div>

      {direction === 'out' && (
        <div>
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Amount asked (optional)</label>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-sm text-gray-400">€</span>
            {/* Prompt 878 §2 — `step="1000"` used to sit here. The field was
                already coded as optional (save() below only sets
                ask_amount_eur when askAmount is non-empty, and formReady
                never reads it), but `step` makes `type="number"` reject any
                value that isn't an exact multiple of the step as :invalid —
                a real amount like 82500 would trip it. Dropped so any
                number is accepted, matching the "(optional)" label with no
                implicit constraint left to contradict it. */}
            <input type="number" min="0" value={askAmount} onChange={(e) => setAskAmount(e.target.value)}
              placeholder="e.g. 1300000" className="w-32 rounded border border-gray-300 px-2 py-1 text-sm" />
          </div>
        </div>
      )}

      {/* Prompt 894 §B — "Terms mentioned in this message" (optional):
          records an offer/commitment/valuation/etc. straight from this same
          save, tagged with the interaction it came from — works for either
          direction (an inbound reply is exactly where a firm usually
          exposes an offer, but a founder can just as easily state a
          valuation outbound). Deliberately NOT wired into ComposerContext/
          Draft-with-AI above — see TermsOnTheTable.tsx's header comment for
          the founder-privacy audit on why. Hidden once negotiation is
          locked — §C: "termos novos só depois de Reopen negotiation". */}
      {!entity.negotiation_locked_at && (
        <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-2.5">
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Terms mentioned in this message (optional)</label>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <select value={termKind} onChange={(e) => setTermKind(e.target.value as DealTermKind | '')}
              className="rounded border border-gray-300 px-1.5 py-1 text-[11px]">
              <option value="">No term to add…</option>
              {TERM_KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}
            </select>
            {termKind && (
              <>
                <div className="flex overflow-hidden rounded border border-gray-300">
                  {(['theirs', 'ours'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setTermSide(s)}
                      className={`px-1.5 py-1 text-[11px] font-medium ${termSide === s ? 'bg-[#0E7490] text-white' : 'bg-white text-gray-600'}`}>
                      {s === 'ours' ? 'Us' : 'Them'}
                    </button>
                  ))}
                </div>
                <input type="number" min="0" autoComplete="off" value={termAmount} onChange={(e) => setTermAmount(e.target.value)}
                  placeholder="€ amount" className="w-28 rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
                <input autoComplete="off" value={termText} onChange={(e) => setTermText(e.target.value)}
                  placeholder="or free text (e.g. 'lead the round')" className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-[11px]" />
              </>
            )}
          </div>
        </div>
      )}

      {direction === 'out' && lint.length > 0 && (
        <ul className="space-y-1">
          {lint.map((f, i) => (
            <li key={i} className={`text-[11px] ${f.severity === 'error' ? 'font-medium text-[#B00000]' : f.severity === 'warning' ? 'text-amber-700' : 'text-gray-500'}`}>
              {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.message}
            </li>
          ))}
        </ul>
      )}

      {direction === 'out' && person && checks.length > 0 && (
        <div className="rounded-lg bg-gray-50 px-2.5 py-2">
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-1.5 text-[11px]">
                <span className={c.ok ? 'text-green-600' : 'text-[#B00000]'}>{c.ok ? '✓' : '✗'}</span>
                <Tooltip text={PREFLIGHT_EXPLAIN[c.key] ?? c.label} side="right">
                  <span className={c.ok ? 'text-gray-500' : 'font-medium text-gray-700'}>{c.label}</span>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      )}

      {direction === 'in' && (
        <div>
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Classification</label>
          <select value={classification} onChange={(e) => setClassification(e.target.value as Classification)}
            className={`mt-1 w-full rounded border px-2 py-1.5 text-sm ${classification === '' ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`}>
            <option value="" disabled>Choose what they said…</option>
            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          {classification === '' && (
            <p className="mt-1 text-[11px] text-amber-700">Required — decides the stage.</p>
          )}
          {classification === 'pass' && (
            <div className="mt-1.5 space-y-1.5 rounded border border-red-100 bg-red-50 p-2">
              <select value={passCat} onChange={(e) => setPassCat(e.target.value as PassReasonCategory)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs">
                {PASS_REASON_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </select>
              <textarea value={passReason} onChange={(e) => setPassReason(e.target.value)} rows={2}
                placeholder="Pass reason — required, verbatim if possible."
                className="w-full rounded border border-gray-300 p-2 text-xs" />
            </div>
          )}
        </div>
      )}

      {reopenTrigger && direction === 'out' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Your note when freezing</p>
          <p className="text-xs text-amber-900">&ldquo;{reopenTrigger}&rdquo;</p>
          <label className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-800">
            <input type="checkbox" checked={reopenAck} onChange={(e) => setReopenAck(e.target.checked)} className="mt-0.5" />
            <span>The draft cites the earlier pass and what changed.</span>
          </label>
        </div>
      )}
      {/* Prompt 578 §D.2 — separate from the reopenTrigger block above (that
          one only renders when a freeze note was written; most dormant
          entities have none, and got neither a warning nor a reopen before
          this change). Unconditional on the note existing: logInteraction
          now reopens any dormant entity on an outbound log, so this always
          shows alongside it. */}
      {entity.status === 'dormant' && direction === 'out' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] font-medium text-amber-800">
          Logging this will reopen the relationship.
        </div>
      )}

      <div>
        <div className="flex items-center gap-1">
          <label className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Attachments</label>
          <AttachHint />
        </div>
        {attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-[11px] text-gray-700">
                <span aria-hidden>{a.documentId ? '📄' : '📁'}</span>
                <span className="max-w-[130px] truncate">{a.label}</span>
                <span className="whitespace-nowrap text-gray-400">· {a.origin}</span>
                <button type="button" onClick={() => removeAttachment(i)} title="Remove"
                  className="text-gray-400 hover:text-[#B00000]">✕</button>
              </span>
            ))}
          </div>
        )}
        <div ref={attachMenuRef} className="relative mt-1.5 inline-block">
          <button type="button" onClick={() => setAttachMenuOpen((o) => !o)} disabled={attaching}
            className="rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:border-[#0E7490] hover:text-[#0E7490] disabled:opacity-50">
            {attaching ? 'Uploading…' : '📎 Attach'}
          </button>
          {attachMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
              {attachSubmenu === null && (
                <>
                  <button type="button" disabled={!authEnabled} onClick={() => fileInputRef.current?.click()}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Attach from this computer</div>
                    <div className="text-[11px] text-gray-400">
                      {authEnabled ? 'uploads the file into your Vault first' : 'needs a live Supabase connection — unavailable in demo mode'}
                    </div>
                  </button>
                  <button type="button" disabled={!personId} onClick={() => setAttachSubmenu('document')}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Share a Vault document</div>
                    <div className="text-[11px] text-gray-400">one file, view-only</div>
                  </button>
                  <button type="button" disabled={!personId} onClick={() => setAttachSubmenu('folder')}
                    className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <div className="text-xs font-medium text-gray-800">Grant access to a Vault folder</div>
                    <div className="text-[11px] text-gray-400">the whole folder, revocable</div>
                  </button>
                  {!personId && (
                    <p className="border-t border-gray-100 px-2 pt-1.5 text-[11px] text-amber-700">Select a person first to share Vault access.</p>
                  )}
                  <p className="mt-1 flex items-start gap-1 border-t border-gray-100 px-2 pt-1.5 text-[10.5px] leading-snug text-gray-400">
                    <span aria-hidden>🛡</span>
                    <span>New shares are recorded in the Vault as access grants — &ldquo;Access grants — the owner consents, access follows&rdquo; → Granted so far.</span>
                  </p>
                </>
              )}
              {attachSubmenu === 'document' && (
                <div>
                  <button type="button" onClick={() => setAttachSubmenu(null)} className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-[#0E7490]">← Back</button>
                  <ul className="max-h-52 overflow-y-auto">
                    {db.documents.length === 0 && <li className="px-2 py-1.5 text-xs text-gray-400">No documents in the Vault yet.</li>}
                    {db.documents.map((d) => (
                      <li key={d.id}>
                        <button type="button" onClick={() => attachExistingDocument(d)}
                          className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">
                          {d.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {attachSubmenu === 'folder' && (
                <div>
                  <button type="button" onClick={() => setAttachSubmenu(null)} className="px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-[#0E7490]">← Back</button>
                  <ul className="max-h-52 overflow-y-auto">
                    {db.folders.length === 0 && <li className="px-2 py-1.5 text-xs text-gray-400">No folders in the Vault yet.</li>}
                    {db.folders.map((f) => (
                      <li key={f.id}>
                        <button type="button" onClick={() => attachExistingFolder(f)}
                          className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50">
                          {f.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <input ref={fileInputRef} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFromComputer(f); }} />
        {attachErr && <p className="mt-1 text-[11px] text-[#B00000]">{attachErr}</p>}
      </div>

      {toast && <div className="rounded border border-green-200 bg-green-50 px-2.5 py-1.5 text-xs text-green-800">{toast}</div>}
      {sendErr && <div className="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-[#B00000]">{sendErr}</div>}

      {pendingSuggestion ? (
        // §B.1.4 — the interaction is already saved; this is the engine's
        // suggested next step (same suggestNextAction /log calls), offered
        // instead of a pre-save field. Accept as-is, edit it, or ignore —
        // all three return to History once resolved.
        <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8]/60 p-2.5">
          <p className="text-[12.5px] font-medium text-cyan-900">Suggested next: {pendingSuggestion.title}</p>
          {editingSuggestion && (
            <div className="mt-1.5 space-y-1.5">
              <input value={suggestionTitle} onChange={(e) => setSuggestionTitle(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
              <input type="date" value={suggestionDue} onChange={(e) => setSuggestionDue(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {editingSuggestion ? (
              <button onClick={saveEditedSuggestion} disabled={!suggestionTitle.trim()}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40">
                Save edited next action
              </button>
            ) : (
              <>
                <button onClick={acceptSuggestion} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-[11px] font-medium text-white">Accept</button>
                <button onClick={() => setEditingSuggestion(true)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">Edit</button>
              </>
            )}
            <button onClick={ignoreSuggestion} className="text-[11px] text-gray-400 hover:underline">Ignore — no next action</button>
          </div>
        </div>
      ) : blockedHard ? (
        <div className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-[#B00000]">
          Blocked: {summary.blocked ? 'a non-overridable pre-flight check failed.' : 'fix the linter errors above.'}
        </div>
      ) : needsOverride && !showOverride ? (
        <Tooltip text="Proceed despite the failed checks — requires a written justification, logged to the audit trail.">
          <button disabled={!formReady || lintErrors.length > 0} onClick={() => setShowOverride(true)}
            className="w-full rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-700 disabled:opacity-40">
            Override & save… ({summary.failed.length} check{summary.failed.length > 1 ? 's' : ''} failed)
          </button>
        </Tooltip>
      ) : needsOverride && showOverride ? (
        <div className="space-y-1.5">
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            placeholder="Justification (required — written to the overrides audit log)"
            className="w-full rounded border border-amber-300 p-2 text-xs" />
          <div className="flex gap-1.5">
            <button disabled={justification.trim().length < 5 || lintErrors.length > 0} onClick={() => save(true)}
              className="flex-1 rounded-lg border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-700 disabled:opacity-40">
              Confirm override & save
            </button>
            <button onClick={() => setShowOverride(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Tooltip text={needsManualSendConfirmation
              ? 'Confirms you sent this yourself outside the app, then logs it and applies its follow-on effects (contact lock, suggested next step).'
              : 'Logs this interaction and applies its follow-on effects (contact lock, suggested next step).'}>
              <button disabled={!formReady || (direction === 'out' && lintErrors.length > 0)} onClick={() => save(false)}
                className="rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
                {primarySaveLabel}
              </button>
            </Tooltip>
            {canSendViaGmail && (
              <Tooltip text="Sends the email through your connected Gmail account, then logs it automatically.">
                <button disabled={sending || !formReady || lintErrors.length > 0} onClick={sendViaGmail}
                  className="rounded-lg border border-[#0E7490] px-3 py-2 text-sm font-medium text-[#0E7490] disabled:opacity-40">
                  {sending ? 'Sending…' : `Send from ${gmail?.email} & log`}
                </button>
              </Tooltip>
            )}
            {/* Prompt 397 §D.1 — only while personId still matches what the
                Sherlock Insight banner suggested (see the prefill effect). */}
            {wasPrefilled && <span className="prefill-sweep text-[11px]">Pre-filled from Sherlock&apos;s insight</span>}
          </div>
          {!formReady && disabledReason && <p className="mt-1 text-[11px] text-gray-400">{disabledReason}</p>}
        </div>
      )}
      {/* Prompt 893 §B — "Prepare form answers" moved here (out of the old
          Approach tab, removed by this same prompt) so it lives next to the
          channel it's actually about, in both dossier surfaces. */}
      {showFormAssist && <FormAssistModal db={db} entityId={entity.id} onClose={() => setShowFormAssist(false)} />}
    </div>
  );
}

// Prompt 397 §C.4 — hover (and focus, for keyboard), never always-visible:
// deliberately NOT TermHint (ui.tsx), which toggles on click — a different,
// shared component whose own behavior stays untouched for its other callers.
function AttachHint() {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" tabIndex={0} aria-label="How sharing works" onFocus={() => setShow(true)} onBlur={() => setShow(false)}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-bold leading-none text-gray-400 opacity-70 hover:opacity-100">
        i
      </button>
      {show && (
        <span role="tooltip"
          className="pointer-events-none absolute z-50 bottom-full left-1/2 mb-1.5 w-max max-w-[230px] -translate-x-1/2 rounded-lg bg-gray-900 px-2 py-1 text-center text-[11px] font-medium leading-snug text-white shadow-lg">
          New shares are recorded in the Vault as access grants — &ldquo;Access grants — the owner consents, access follows&rdquo; → Granted so far.
        </span>
      )}
    </span>
  );
}
