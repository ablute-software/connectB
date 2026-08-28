'use client';
// Supabase-backed data store. Mounted by src/lib/store.tsx when
// NEXT_PUBLIC_SUPABASE_URL is configured. Implements the exact same StoreApi
// contract as store-demo.tsx (locks, follow-up tasks, overrides, runs
// semantics) — every action mirrors the demo reducer logic, but also persists
// the change to Postgres. Reads/writes are org-scoped; RLS (is_org_member) is
// the actual isolation boundary, the org_id filters here are defense in depth.
import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { browserClient } from './supabase';
import { StoreCtx, type StoreApi, type LogInput } from './store-context';
import type {
  AccessGrant, Automation, AutomationRun, CatalogEntity, Channel, Classification, CompanyFact, CompanyPerson, Db, DocumentItem,
  DocumentVersion, DocumentView, Entity, EntityReopenSnapshot, EntityStatus, FitScore, Folder, FolderKind, Interaction, InvestorSubmission, MessageTemplate,
  Nda, Org, Pack, PackUnlock, PassReasonCategory, Person, PersonAffiliation, ReawakeningProposal, RelationshipStage,
  RelationshipState, RuleOverride, TaskItem, AiReview, TractionMetric, RoadmapMilestone, FundingRound, RoadmapCategory, RoadmapEvent,
  RejectionCode, InteractionEdit, InteractionDocument, OrgAxisClassification, SherlockNextSnooze } from './types';
import { LOCK_DAYS, outboundsAwaitingFollowUp, fillTemplate } from './rules';
import { isEditableLink, normalizeDocumentUrl } from './data-room';
import { buildReawakenApproval, priorPassInfo } from './reawakening';
import { findReactivations, reactivationTaskTitle, type PendingReactivation } from './rejection-code-match';
import { applyFilterVerdicts, reactivationToFilterCase, verdictsFromWire, type FilterVerdict, type RawFilterVerdict } from './reawakening-ai-filter';
import type { NeglectOutcome } from './neglect-evaluation';
import { STAGE_LABEL, getStage } from './relationship';
import { fitBucketFromScore } from './catalog-fit-bucket';
import { revisitTasksToClose } from './exit-effects';
import { matchEntityToCatalog } from './entity-catalog-prefill';

type SB = ReturnType<typeof browserClient>;

const EMPTY_ORG: Org = { id: '', name: '', plan: 'idea', daily_cap: 5, weekly_cap: 20 };
const EMPTY_DB: Db = {
  org: EMPTY_ORG, entities: [], people: [], personAffiliations: [], interactions: [], tasks: [], relationshipState: [], overrides: [],
  folders: [], documents: [], grants: [], views: [], templates: [], automations: [],
  runs: [], aiReviews: [], catalog: [], packs: [], unlocks: [], submissions: [], companyFacts: [], companyPeople: [], ndas: [],
  documentVersions: [], reawakeningProposals: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [],
  roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
  interactionDocuments: [], sherlockNextSnoozes: [], entityReopenSnapshots: [],
};

function uuid() { return crypto.randomUUID(); }

// Every domain type in src/lib/types.ts mirrors its Postgres column names
// (see that file's header) and uses `?:` — never `| null` — for optional
// fields, so one shallow null→undefined pass turns any row into its domain shape.
function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const k in row) out[k] = row[k] === null ? undefined : row[k];
  return out as T;
}

function persist(p: PromiseLike<{ error: { message: string } | null }>, label: string) {
  Promise.resolve(p).then(({ error }) => {
    if (error) console.error(`[supabase-store] ${label} failed:`, error.message);
  });
}

// A field-level patch that intends to CLEAR a column passes `undefined` for
// it, but JSON.stringify drops undefined keys — so a naive `.update(patch)`
// would silently leave the column unchanged. Map undefined→null so a clear
// actually persists (matters for undo, which reverts a filled field back to
// empty, and for un-linking a person_id).
function nullify(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in patch) out[k] = patch[k] === undefined ? null : patch[k];
  return out;
}

// org_traction_metrics_dealdigger_limit (0095) raises a raw Postgres
// exception — translate its known code to the copy P102 asked for; any
// other error passes through unchanged rather than being swallowed.
function friendlyTractionError(message: string): string {
  return message.includes('MATCHDEAL_DEALDIGGER_TRACTION_LIMIT')
    ? 'Only 2 metrics can be featured on DealDigger — unfeature one first.'
    : message;
}

async function loadAll(sb: SB, orgId: string): Promise<Db> {
  const [
    orgRes, entitiesRes, peopleRes, interactionsRes, tasksRes, overridesRes,
    foldersRes, documentsRes, grantsRes, viewsRes, templatesRes, automationsRes,
    runsRes, aiReviewsRes, catalogRes, packsRes, packItemsRes, unlocksRes,
    deliveriesRes, submissionsRes, relationshipStateRes, personAffiliationsRes, companyFactsRes, ndasRes,
    documentVersionsRes, reawakeningProposalsRes, companyPeopleRes, tractionMetricsRes, roadmapMilestonesRes,
    fundingRoundsRes, roadmapCategoriesRes, roadmapEventsRes, rejectionCodesRes, interactionEditsRes, orgAxisClassificationsRes,
    interactionDocumentsRes, sherlockNextSnoozesRes, entityReopenSnapshotsRes,
  ] = await Promise.all([
    sb.from('orgs').select('*').eq('id', orgId).single(),
    sb.from('entities').select('*').eq('org_id', orgId),
    sb.from('people').select('*').eq('org_id', orgId),
    sb.from('interactions').select('*').eq('org_id', orgId),
    sb.from('tasks').select('*').eq('org_id', orgId),
    sb.from('rule_overrides').select('*').eq('org_id', orgId),
    sb.from('folders').select('*').eq('org_id', orgId),
    sb.from('documents').select('*').eq('org_id', orgId),
    sb.from('access_grants').select('*').eq('org_id', orgId),
    sb.from('document_views').select('*').eq('org_id', orgId),
    sb.from('message_templates').select('*').eq('org_id', orgId),
    sb.from('automations').select('*').eq('org_id', orgId),
    sb.from('automation_runs').select('*').eq('org_id', orgId),
    sb.from('ai_reviews').select('*').eq('org_id', orgId),
    sb.from('catalog_entities').select('*'),
    sb.from('packs').select('*'),
    sb.from('pack_items').select('*'),
    sb.from('pack_unlocks').select('*').eq('org_id', orgId),
    sb.from('catalog_deliveries').select('*').eq('org_id', orgId),
    sb.from('investor_submissions').select('*').eq('org_id', orgId),
    sb.from('relationship_state').select('*').eq('org_id', orgId),
    sb.from('person_affiliations').select('*').eq('org_id', orgId),
    // §11 Company Canon — company_facts may not exist yet (migration 0020
    // not applied). A missing-table error resolves here (never throws), so
    // it just falls back to [] below like every other table's error path.
    sb.from('company_facts').select('*').eq('org_id', orgId),
    // Data Room V2 F5 — ndas may not exist yet (migration 0023). Same
    // missing-table-safe pattern as company_facts above.
    sb.from('ndas').select('*').eq('org_id', orgId),
    // E7 file versions (0029) + F reawakening proposals (0030) — may not exist
    // yet. PostgREST returns {data:null,error} for a missing table, so these
    // resolve here (never throw) and fall back to [] below, exactly like the
    // capability-gated tables above.
    sb.from('document_versions').select('*').eq('org_id', orgId),
    sb.from('reawakening_proposals').select('*').eq('org_id', orgId),
    // Company tab redesign (0037) — company_people may not exist yet. Same
    // missing-table-safe pattern as company_facts/ndas above.
    sb.from('company_people').select('*').eq('org_id', orgId).order('sort_order', { ascending: true }),
    // Investor Workspace Fase 1 (0054) — org_traction_metrics may not exist
    // yet. Same missing-table-safe pattern as company_facts/ndas above.
    sb.from('org_traction_metrics').select('*').eq('org_id', orgId).order('sort_order', { ascending: true }),
    // Prompt 167 — company_roadmap_milestones may not exist yet (0161). Same
    // missing-table-safe pattern as company_facts/ndas above. Ordered by
    // year first; the (year, quarter) display sort (year-milestone before
    // that year's quarters) is computed in RoadmapCard.tsx, not here — it
    // depends on period_kind too, not just a column order.
    sb.from('company_roadmap_milestones').select('*').eq('org_id', orgId).order('period_year', { ascending: true }),
    sb.from('funding_rounds').select('*').eq('org_id', orgId).order('closed_year', { ascending: true }),
    sb.from('roadmap_categories').select('*').eq('org_id', orgId).order('created_at', { ascending: true }),
    // Prompt 359 — roadmap_events (0237). Same missing-table-safe pattern
    // as company_facts/ndas above. Ordered by date — the canvas's own axis.
    sb.from('roadmap_events').select('*').eq('org_id', orgId).order('date', { ascending: true }),
    // Prompt 251/253 Bloco A — rejection_codes (0184). Same missing-table-
    // safe pattern as company_facts/ndas above.
    sb.from('rejection_codes').select('*').eq('org_id', orgId),
    // Prompt 252 — interaction_edits (0185). Same missing-table-safe
    // pattern as company_facts/ndas above.
    sb.from('interaction_edits').select('*').eq('org_id', orgId),
    // Prompt 251/253 Bloco B — org_axis_classifications (0184), read-only
    // here still (no writer as of Bloco B).
    sb.from('org_axis_classifications').select('*').eq('org_id', orgId),
    // Prompt 397 §C.3 — interaction_documents (0254). Same missing-table-
    // safe pattern as company_facts/ndas above.
    sb.from('interaction_documents').select('*').eq('org_id', orgId),
    // Prompt 415 §1 — sherlock_next_snoozes (0261). Same missing-table-safe
    // pattern as company_facts/ndas above.
    sb.from('sherlock_next_snoozes').select('*').eq('org_id', orgId),
    // Prompt 416 §A — entity_reopen_snapshots (0262). Same missing-table-
    // safe pattern as company_facts/ndas above.
    sb.from('entity_reopen_snapshots').select('*').eq('org_id', orgId),
  ]);

  if (orgRes.error) throw orgRes.error;
  const org = fromRow<Org>(orgRes.data as Record<string, unknown>);

  const catalogIdsByPack = new Map<string, string[]>();
  for (const pi of (packItemsRes.data ?? []) as { pack_id: string; catalog_id: string }[]) {
    const arr = catalogIdsByPack.get(pi.pack_id) ?? [];
    arr.push(pi.catalog_id);
    catalogIdsByPack.set(pi.pack_id, arr);
  }
  const packs: Pack[] = ((packsRes.data ?? []) as Record<string, any>[]).map((p) => ({
    id: p.id as string, name: p.name as string, description: (p.description as string) ?? '',
    price_eur: p.price_eur as number, catalog_ids: catalogIdsByPack.get(p.id as string) ?? [],
  }));

  const deliveredByPack = new Map<string, string[]>();
  for (const d of (deliveriesRes.data ?? []) as { via_pack: string | null; catalog_id: string }[]) {
    if (!d.via_pack) continue;
    const arr = deliveredByPack.get(d.via_pack) ?? [];
    arr.push(d.catalog_id);
    deliveredByPack.set(d.via_pack, arr);
  }
  const unlocks: PackUnlock[] = ((unlocksRes.data ?? []) as Record<string, any>[]).map((u) => ({
    id: u.id as string, pack_id: u.pack_id as string, unlocked_at: u.unlocked_at as string,
    delivered_catalog_ids: deliveredByPack.get(u.pack_id as string) ?? [],
  }));

  const submissions: InvestorSubmission[] = ((submissionsRes.data ?? []) as Record<string, any>[]).map((s) => ({
    id: s.id as string, payload: s.payload as InvestorSubmission['payload'], submitted_by: org.name,
    status: s.status as InvestorSubmission['status'], reviewer_notes: s.reviewer_notes ?? undefined,
    created_at: s.created_at as string, reviewed_at: s.reviewed_at ?? undefined,
  }));

  return {
    org,
    entities: ((entitiesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Entity>(r)),
    people: ((peopleRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Person>(r)),
    personAffiliations: ((personAffiliationsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<PersonAffiliation>(r)),
    interactions: ((interactionsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Interaction>(r)),
    tasks: ((tasksRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<TaskItem>(r)),
    relationshipState: ((relationshipStateRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RelationshipState>(r)),
    overrides: ((overridesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RuleOverride>(r)),
    folders: ((foldersRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Folder>(r)),
    documents: ((documentsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<DocumentItem>(r)),
    grants: ((grantsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<AccessGrant>(r)),
    views: ((viewsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<DocumentView>(r)),
    templates: ((templatesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<MessageTemplate>(r)),
    automations: ((automationsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Automation>(r)),
    runs: ((runsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<AutomationRun>(r)),
    aiReviews: ((aiReviewsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<AiReview>(r)),
    catalog: ((catalogRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<CatalogEntity>(r)),
    packs,
    unlocks,
    submissions,
    companyFacts: ((companyFactsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<CompanyFact>(r)),
    companyPeople: ((companyPeopleRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<CompanyPerson>(r)),
    ndas: ((ndasRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<Nda>(r)),
    documentVersions: ((documentVersionsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<DocumentVersion>(r)),
    reawakeningProposals: ((reawakeningProposalsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<ReawakeningProposal>(r)),
    tractionMetrics: ((tractionMetricsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<TractionMetric>(r)),
    roadmapMilestones: ((roadmapMilestonesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RoadmapMilestone>(r)),
    fundingRounds: ((fundingRoundsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<FundingRound>(r)),
    roadmapCategories: ((roadmapCategoriesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RoadmapCategory>(r)),
    roadmapEvents: ((roadmapEventsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RoadmapEvent>(r)),
    rejectionCodes: ((rejectionCodesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<RejectionCode>(r)),
    interactionEdits: ((interactionEditsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<InteractionEdit>(r)),
    orgAxisClassifications: ((orgAxisClassificationsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<OrgAxisClassification>(r)),
    interactionDocuments: ((interactionDocumentsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<InteractionDocument>(r)),
    sherlockNextSnoozes: ((sherlockNextSnoozesRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<SherlockNextSnooze>(r)),
    entityReopenSnapshots: ((entityReopenSnapshotsRes.data ?? []) as Record<string, unknown>[]).map((r) => fromRow<EntityReopenSnapshot>(r)),
  };
}

// Prompt 416 §A.2 — resolves the entity's catalog counterpart (the exact
// catalog_deliveries record when one exists; entity-catalog-prefill.ts's
// own fuzzy domain/name match otherwise — e.g. a manually-added entity that
// happens to match a real catalog investor), then reads what that
// counterpart's investment/claim state looks like RIGHT NOW. investor_
// investments' read policy is open to any authenticated user (migration
// 0201), so the count is a plain client-side query; investor_entity_claims
// is claimant-scoped RLS, so catalog_entity_claimed_at() (migration 0262)
// is the one safe derived fact that RPC can hand back. Returns null (never
// throws) on any failure — this is a secondary signal for a later engine,
// not something a status change should ever be blocked by.
async function captureReopenSnapshot(
  sb: SB, orgId: string, entity: Entity, reason: 'passed' | 'dormant', catalog: CatalogEntity[],
): Promise<EntityReopenSnapshot | null> {
  let catalogMatch: CatalogEntity | null = null;
  const { data: delivery } = await sb.from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).eq('entity_id', entity.id).maybeSingle();
  if (delivery?.catalog_id) {
    const { data: catRow } = await sb.from('catalog_entities').select('*').eq('id', delivery.catalog_id as string).maybeSingle();
    if (catRow) catalogMatch = fromRow<CatalogEntity>(catRow as Record<string, unknown>);
  }
  if (!catalogMatch) catalogMatch = matchEntityToCatalog(entity, catalog);

  let investmentCount = 0;
  let claimedAt: string | null = null;
  if (catalogMatch) {
    const [countRes, claimedRes] = await Promise.all([
      sb.from('investor_investments').select('id', { count: 'exact', head: true }).eq('investor_entity_id', catalogMatch.id),
      sb.rpc('catalog_entity_claimed_at', { p_catalog_entity_id: catalogMatch.id }),
    ]);
    investmentCount = countRes.count ?? 0;
    claimedAt = (claimedRes.data as string | null) ?? null;
  }

  const { data, error } = await sb.from('entity_reopen_snapshots').insert({
    org_id: orgId, entity_id: entity.id, reason,
    sectors_at_time: catalogMatch?.sectors ?? entity.sectors,
    stage_min_at_time: catalogMatch?.stage_min ?? entity.stage_min ?? null,
    stage_max_at_time: catalogMatch?.stage_max ?? entity.stage_max ?? null,
    investor_claimed_at_time: !!claimedAt,
    investment_count_at_time: investmentCount,
  }).select('*').single();
  if (error || !data) {
    console.error('[supabase-store] captureReopenSnapshot failed:', error?.message);
    return null;
  }
  return fromRow<EntityReopenSnapshot>(data as Record<string, unknown>);
}

export function SupabaseStoreProvider({ children }: { children: React.ReactNode }) {
  const sbRef = useRef<SB | null>(null);
  if (!sbRef.current) sbRef.current = browserClient();
  const sb = sbRef.current;

  const dbRef = useRef<Db>(EMPTY_DB);
  const orgIdRef = useRef<string | null>(null);
  // Prompt 252 — the signed-in user's id, for interaction_edits.edited_by.
  // Set once alongside orgIdRef below, same lifecycle.
  const userIdRef = useRef<string | null>(null);
  // Prompt 126 F — true until the initial load below resolves (success or
  // not — a signed-out user or org-less account is "done loading", not
  // "still loading"). See store-context.tsx's StoreApi.loading for why.
  const loadingRef = useRef(true);
  const [version, bump] = useReducer((x: number) => x + 1, 0);

  function commit(next: Db) {
    dbRef.current = next;
    bump();
  }

  function finishInitialLoad(next: Db) {
    dbRef.current = next;
    loadingRef.current = false;
    bump();
  }

  async function refetch() {
    const oid = orgIdRef.current;
    if (!oid) return;
    try { commit(await loadAll(sb, oid)); } catch (err) { console.error('[supabase-store] refetch failed', err); }
  }

  // F — the ONLY reawakening trigger: a canon fact was just confirmed. Fires
  // the server-side batched evaluation (mechanical prefilter → one AI call);
  // fire-and-forget so it never blocks the confirm. If proposals were created,
  // refetch so the Pipeline queue reflects them without a manual refresh. The
  // route no-ops (0 proposals, 0 AI calls) when the shortlist is empty or the
  // feature isn't configured, so calling this unconditionally is safe.
  function triggerReawakening(factId: string, supersedesStatement?: string) {
    if (!orgIdRef.current) return;
    fetch('/api/reawakening/evaluate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ factId, supersedesStatement }),
    }).then((r) => r.json()).then((b) => {
      if (b && b.ok && (b.proposals ?? 0) > 0) refetch();
    }).catch(() => { /* never blocks the confirm */ });
  }

  // Prompt 251/253 Bloco B — the on-write hook (see the identical comment
  // in store-demo.tsx for the full reasoning). Takes the state just
  // committed by the caller, appends any newly-cleared reactivations, and
  // persists those two inserts — the write that triggered this (updateOrg/
  // updateEntity/addRejectionCode) already persisted itself.
  //
  // Prompt 268 (Bloco D) — org opt-in only (reawakening_ai_filter_enabled,
  // default false for every org): off, this function never awaits
  // anything — same synchronous, same-tick commit as before this prompt,
  // byte-for-byte. On, it awaits one batched call to
  // /api/reawakening/rejection-filter BEFORE building newProposals/
  // newTasks, so a 'hold' verdict genuinely keeps a suggestion from ever
  // reaching the founder, not a filter bolted on after the fact. Demo mode
  // (store-demo.tsx) never sees this branch at all — no seed org sets the
  // flag, and there is no server route to call there anyway.
  async function applyReactivations(next: Db, entityIds?: string[]) {
    const reactivations = findReactivations(next, entityIds);
    if (reactivations.length === 0) return;

    let survivors: { reactivation: PendingReactivation; taskTitleOverride?: string }[] =
      reactivations.map((r) => ({ reactivation: r }));

    if (next.org.reawakening_ai_filter_enabled) {
      let verdicts = new Map<string, FilterVerdict>();
      try {
        const res = await fetch('/api/reawakening/rejection-filter', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            orgId: next.org.id,
            cases: reactivations.map((r) => reactivationToFilterCase(r, priorPassInfo(next.interactions.filter((i) => i.entity_id === r.entity.id)))),
          }),
        });
        const body = await res.json() as { verdicts?: RawFilterVerdict[] };
        verdicts = verdictsFromWire(body.verdicts ?? []);
      } catch {
        // Fail-open (§4): verdicts stays empty — every still-clashing
        // reactivation below proceeds exactly as if the filter were off.
      }
      // A concurrent write may have committed newer state while this
      // awaited (addRejectionCode/updateOrg/updateEntity elsewhere in the
      // same tab) — re-derive the candidate list from dbRef.current rather
      // than reusing the pre-await `reactivations` snapshot. Two things can
      // have gone stale during the round-trip: (a) the entity/org data
      // itself may have changed again, so a code that cleared a moment ago
      // might not clear anymore — inserting from the stale snapshot would
      // create a WRONG proposal that the (rejection_code_id) unique index
      // then makes permanent, since only one proposal is ever allowed per
      // code; (b) another concurrent call may have already turned this same
      // code into a real proposal — findReactivations' own alreadyProposed
      // dedup, now reading the freshest committed rows, excludes it here so
      // a stale duplicate never enters the batch insert below (which would
      // otherwise fail atomically and silently drop other, unrelated,
      // genuinely-new proposals bundled in the same statement). The sync
      // branch above never needs any of this: it never yields control, so
      // `next`/`reactivations` are still current by construction.
      next = dbRef.current;
      const stillClear = new Set(findReactivations(next, entityIds).map((r) => r.code.id));
      survivors = applyFilterVerdicts(reactivations.filter((r) => stillClear.has(r.code.id)), verdicts);
      if (survivors.length === 0) return;
    }

    const now = new Date().toISOString();
    const newProposals = survivors.map(({ reactivation: r }) => {
      const { reason, category } = priorPassInfo(next.interactions.filter((i) => i.entity_id === r.entity.id));
      return {
        // Prompt 271 §3 — trigger_kind: 'rejection_code' identifies this
        // origin explicitly (migration 0192). Included unconditionally,
        // same "let a not-yet-applied column degrade via persist()'s
        // existing error log" precedent already used for tasks.notes
        // (Prompt 269) — no client-side capability probe for this one
        // column, consistent with that call.
        id: uuid(), rejection_code_id: r.code.id, trigger_kind: 'rejection_code' as const, entity_id: r.entity.id,
        reopens: true, rationale: r.rationale,
        prior_pass_reason: reason, prior_pass_category: category,
        status: 'pending' as const, created_at: now,
      };
    });
    const newTasks = survivors.map(({ reactivation: r, taskTitleOverride }) => ({
      id: uuid(), title: taskTitleOverride ?? reactivationTaskTitle(r.entity.name, r.code), entity_id: r.entity.id,
      kind: 'follow_up' as const, action_type: 'other' as const, done: false, source: 'suggested' as const,
    }));
    commit({
      ...next,
      reawakeningProposals: [...next.reawakeningProposals, ...newProposals],
      tasks: [...next.tasks, ...newTasks],
    });
    const o = orgIdRef.current;
    if (o) {
      persist(sb.from('reawakening_proposals').insert(newProposals.map((p) => ({ ...p, org_id: o }))), 'applyReactivations:proposals');
      persist(sb.from('tasks').insert(newTasks.map((t) => ({ ...t, org_id: o }))), 'applyReactivations:tasks');
    }
  }

  // Prompt 179 §B — extracted to catalog-fit-bucket.ts so the server-side
  // monthly delivery cron job can reuse the exact same bucketing.

  // Prompt 138 D2 — queue-only, never invokes the worker. Fire-and-forget:
  // enrichment_jobs is admin-only under RLS, so this has to go through a
  // service-role route rather than a direct insert from here.
  function triggerEnrichmentEnqueue(catalogIds: string[]) {
    if (!catalogIds.length) return;
    fetch('/api/pipeline/enqueue-enrichment', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ catalogIds }),
    }).catch(() => { /* never blocks the unlock */ });
  }

  // Prompt 313 §A — same fire-and-forget shape as triggerEnrichmentEnqueue
  // above: extract-document/route.ts does the real work server-side (auth,
  // fail-closed checks, Anthropic call), this just kicks it off without
  // ever blocking the upload/version-add that triggered it. Only worth
  // calling for a file that just came back 'clean' AND looks like a PDF —
  // the server re-checks both anyway, this is purely to skip a useless
  // request for every non-PDF upload (images, decks-as-pptx, etc.).
  function triggerDocumentExtraction(documentId: string, name: string, malwareScanStatus?: string) {
    // Prompt 375 — 'local_only' is the NORMAL outcome for a freshly
    // uploaded private document now (hash-only scanning, never submitted
    // externally) — gating this on 'clean' alone would silently stop
    // auto-extraction from ever firing for a new upload again.
    if ((malwareScanStatus !== 'clean' && malwareScanStatus !== 'local_only') || !/\.pdf$/i.test(name)) return;
    fetch('/api/data-room/extract-document', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentId }),
    }).catch(() => { /* never blocks the upload */ });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (cancelled) return;
      if (!user) { finishInitialLoad(EMPTY_DB); return; }
      userIdRef.current = user.id;
      // Prompt 123 Block A — Developer Viewer overrides which org this
      // store loads. /api/me is the only place that re-verifies BOTH the
      // cookie and current developer status together (see its own
      // comment) — checked first, before the normal org_members lookup a
      // developer session usually has no row for anyway. This only ever
      // changes what gets READ: every write path below still goes through
      // the same RLS-gated calls, which reject a developer (not an
      // is_org_member of the viewed org) automatically — no viewer-aware
      // branching needed in any write function itself.
      let oid: string | null = null;
      try {
        const me = await fetch('/api/me').then((r) => r.json());
        oid = me?.viewer?.orgId ?? null;
      } catch { /* fall through to the normal lookup below */ }
      if (!oid) {
        const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
        oid = (member as { org_id: string } | null)?.org_id ?? null;
      }
      orgIdRef.current = oid;
      if (!oid) { finishInitialLoad(EMPTY_DB); return; }
      try {
        const loaded = await loadAll(sb, oid);
        if (!cancelled) finishInitialLoad(loaded);
      } catch (err) {
        console.error('[supabase-store] initial load failed', err);
        // A failed initial load falls through to the same empty state as a
        // genuinely-empty org rather than spinning forever — this codebase
        // doesn't have a general cross-page error-banner mechanism, and
        // building one is out of scope for what this fix is actually about
        // (loading vs. empty, not a new error-surfacing architecture).
        if (!cancelled) finishInitialLoad(EMPTY_DB);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<StoreApi>(() => ({
    db: dbRef.current,
    loading: loadingRef.current,

    logInteraction(input: LogInput) {
      const prev = dbRef.current;
      // Spread after id, but occurred_at needs its own fallback below: /log
      // passes occurred_at: undefined explicitly when the founder leaves
      // "when this happened" blank, and an explicit `undefined` in a spread
      // overwrites a default that comes before it. Every relationship.ts
      // sort assumes occurred_at is always a real timestamp.
      const interaction: Interaction = {
        id: uuid(), ...input, occurred_at: input.occurred_at ?? new Date().toISOString(),
        // Prompt 397 §C.3 — the first document attachment backfills the
        // legacy singular column for back-compat (SharedDocChip etc. still
        // read it); interactions itself has no `attachments` column — see
        // the strip below, right before the insert.
        document_id: input.document_id ?? input.attachments?.find((a) => a.documentId)?.documentId,
      };
      const attachmentRows: InteractionDocument[] = (input.attachments ?? []).map((a) => ({
        id: uuid(), interaction_id: interaction.id,
        document_id: a.documentId, folder_id: a.folderId, created_at: interaction.occurred_at,
      }));
      const overrideRows: RuleOverride[] = (input.overrides ?? []).map((o) => ({
        id: uuid(), rule: o.rule, justification: o.justification,
        entity_id: input.entity_id, person_id: input.person_id,
        interaction_id: interaction.id, created_at: interaction.occurred_at,
      }));

      let entities = prev.entities;
      let tasks = prev.tasks;
      let entityPatch: Partial<Entity> | null = null;
      const newTaskRows: TaskItem[] = [];

      if (input.direction === 'out') {
        const lockUntil = new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString();
        const entity = prev.entities.find((e) => e.id === input.entity_id);
        const newStatus: EntityStatus | undefined = entity && entity.status === 'not_contacted' ? 'contacted' : undefined;
        entityPatch = { contact_lock_until: lockUntil, ...(newStatus ? { status: newStatus } : {}) };
        entities = entities.map((e) => e.id === input.entity_id ? { ...e, ...entityPatch } : e);
        // Prompt 65 Bloco 4 — no more blind buildFollowUpTask here; see the
        // matching comment in store-demo.tsx. The lock above is unchanged
        // (independent of task creation); the follow-up TASK now comes
        // from the engine's visible, confirmable suggestion instead.
      } else if (input.classification && ['interested', 'meeting_request', 'question'].includes(input.classification)) {
        const entity = prev.entities.find((e) => e.id === input.entity_id);
        if (entity && ['not_contacted', 'contacted'].includes(entity.status)) {
          entityPatch = { status: 'in_conversation' };
          entities = entities.map((e) => e.id === input.entity_id ? { ...e, ...entityPatch } : e);
        }
      }

      // The founder's own explicit next step (Log Interaction's "Next
      // action" fields) becomes a real, visible Agenda task, tagged
      // 'manual' — they typed it themselves, no suggestion involved.
      if (input.next_action) {
        newTaskRows.push({
          id: uuid(), kind: 'follow_up', action_type: input.next_action_type ?? 'other', done: false,
          due_at: input.next_action_due ? `${input.next_action_due}T12:00:00Z` : undefined,
          title: input.next_action, entity_id: input.entity_id, person_id: input.person_id, source: 'manual',
        });
      }
      tasks = [...tasks, ...newTaskRows];

      commit({
        ...prev, entities, tasks,
        interactions: [...prev.interactions, interaction],
        overrides: [...prev.overrides, ...overrideRows],
        interactionDocuments: [...prev.interactionDocuments, ...attachmentRows],
      });

      const o = orgIdRef.current;
      if (o) {
        // `interaction` is built from LogInput, which carries fields that
        // only exist to drive local task/override/attachment construction
        // above (overrides, next_action_type, attachments) and were never
        // columns on `interactions` — inserting them verbatim makes
        // PostgREST reject the whole row with a schema-cache error, silently
        // (the local optimistic commit above already "succeeded" from the
        // UI's POV).
        const { overrides: _overrides, next_action_type: _nextActionType, attachments: _attachments, ...interactionRow } =
          interaction as Interaction & { overrides?: unknown; next_action_type?: unknown; attachments?: unknown };
        persist(sb.from('interactions').insert({ ...interactionRow, org_id: o }), 'logInteraction:interaction');
        if (overrideRows.length) persist(sb.from('rule_overrides').insert(overrideRows.map((r) => ({ ...r, org_id: o }))), 'logInteraction:overrides');
        if (newTaskRows.length) persist(sb.from('tasks').insert(newTaskRows.map((t) => ({ ...t, org_id: o }))), 'logInteraction:task');
        if (entityPatch) persist(sb.from('entities').update(entityPatch).eq('id', input.entity_id), 'logInteraction:entity');
        if (attachmentRows.length) persist(sb.from('interaction_documents').insert(attachmentRows.map((r) => ({ ...r, org_id: o }))), 'logInteraction:attachments');
      }
      return interaction;
    },

    classifyInteraction(id: string, c: Classification, cat?: PassReasonCategory, reason?: string, classifiedBy?: 'ai' | 'mechanical', needsReview?: boolean) {
      const prev = dbRef.current;
      const it = prev.interactions.find((i) => i.id === id);
      let entityPatch: Partial<Entity> | null = null;
      let newBounceCount: number | null = null;

      const entities = (() => {
        if (!it) return prev.entities;
        if (c === 'pass') { entityPatch = { status: 'passed' }; return prev.entities.map((e) => e.id === it.entity_id ? { ...e, ...entityPatch } : e); }
        if (['interested', 'meeting_request', 'question'].includes(c)) {
          const entity = prev.entities.find((e) => e.id === it.entity_id);
          if (entity && ['not_contacted', 'contacted'].includes(entity.status)) {
            entityPatch = { status: 'in_conversation' };
            return prev.entities.map((e) => e.id === it.entity_id ? { ...e, ...entityPatch } : e);
          }
        }
        return prev.entities;
      })();

      const people = (() => {
        if (!it || c !== 'bounce' || !it.person_id) return prev.people;
        return prev.people.map((p) => {
          if (p.id !== it.person_id) return p;
          newBounceCount = p.bounce_count + 1;
          return { ...p, bounce_count: newBounceCount };
        });
      })();

      commit({
        ...prev, entities, people,
        interactions: prev.interactions.map((i) => i.id === id ? { ...i, classification: c, pass_reason_category: cat, pass_reason: reason, classified_by: classifiedBy, needs_review: needsReview ?? i.needs_review } : i),
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('interactions').update({ classification: c, pass_reason_category: cat ?? null, pass_reason: reason ?? null, classified_by: classifiedBy ?? null, ...(needsReview === undefined ? {} : { needs_review: needsReview }) }).eq('id', id), 'classifyInteraction:interaction');
        if (entityPatch && it) persist(sb.from('entities').update(entityPatch).eq('id', it.entity_id), 'classifyInteraction:entity');
        if (newBounceCount !== null && it?.person_id) persist(sb.from('people').update({ bounce_count: newBounceCount }).eq('id', it.person_id), 'classifyInteraction:person');
      }
    },

    clearNeedsReview(interactionId: string) {
      const prev = dbRef.current;
      commit({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === interactionId ? { ...i, needs_review: false } : i),
      });
      if (orgIdRef.current) persist(sb.from('interactions').update({ needs_review: false }).eq('id', interactionId), 'clearNeedsReview');
    },

    updateInteractionContent(id: string, content: string) {
      const prev = dbRef.current;
      commit({ ...prev, interactions: prev.interactions.map((i) => i.id === id ? { ...i, content } : i) });
      if (orgIdRef.current) persist(sb.from('interactions').update({ content }).eq('id', id), 'updateInteractionContent');
    },

    updateInteraction(id: string, patch: Partial<Interaction>) {
      const prev = dbRef.current;
      commit({ ...prev, interactions: prev.interactions.map((i) => i.id === id ? { ...i, ...patch } : i) });
      if (orgIdRef.current) persist(sb.from('interactions').update(nullify(patch)).eq('id', id), 'updateInteraction');
    },

    editInteraction(id: string, patch: { occurred_at?: string; channel?: Channel; content?: string }) {
      const prev = dbRef.current;
      const current = prev.interactions.find((i) => i.id === id);
      if (!current) return;
      const now = new Date().toISOString();
      const editedBy = userIdRef.current;
      const changedFields = (Object.keys(patch) as (keyof typeof patch)[])
        .filter((field) => patch[field] !== undefined && patch[field] !== current[field]);
      if (changedFields.length === 0) return;
      const edits: InteractionEdit[] = changedFields.map((field) => ({
        id: uuid(), interaction_id: id, field,
        old_value: current[field] ?? null, new_value: patch[field] ?? null,
        edited_by: editedBy, edited_at: now,
      }));
      commit({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === id ? { ...i, ...patch } : i),
        interactionEdits: [...prev.interactionEdits, ...edits],
      });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('interactions').update(nullify(patch)).eq('id', id), 'editInteraction:update');
        persist(sb.from('interaction_edits').insert(edits.map((e) => ({ ...e, org_id: o }))), 'editInteraction:audit');
      }
    },

    addInteraction(input) {
      const prev = dbRef.current;
      const interaction: Interaction = { id: uuid(), ...input };
      commit({ ...prev, interactions: [...prev.interactions, interaction] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('interactions').insert({ ...interaction, org_id: o }), 'addInteraction');
      return interaction;
    },

    removeInteraction(id: string) {
      const prev = dbRef.current;
      commit({ ...prev, interactions: prev.interactions.filter((i) => i.id !== id) });
      if (orgIdRef.current) persist(sb.from('interactions').delete().eq('id', id), 'removeInteraction');
    },

    removePerson(id: string) {
      const prev = dbRef.current;
      commit({
        ...prev,
        people: prev.people.filter((p) => p.id !== id),
        personAffiliations: prev.personAffiliations.filter((a) => a.person_id !== id),
      });
      // person_affiliations cascade on the DB (0001), interactions.person_id
      // is on-delete-set-null — the undo path unlinks interactions first, so
      // this only ever removes a person nothing still references.
      if (orgIdRef.current) persist(sb.from('people').delete().eq('id', id), 'removePerson');
    },

    revertToNeedsReview(interactionId: string) {
      const prev = dbRef.current;
      commit({
        ...prev,
        interactions: prev.interactions.map((i) => i.id === interactionId ? { ...i, needs_review: true, classified_by: undefined } : i),
      });
      if (orgIdRef.current) persist(sb.from('interactions').update({ needs_review: true, classified_by: null }).eq('id', interactionId), 'revertToNeedsReview');
    },

    applyMetadataCard(entityId: string, interactionId: string, parsed: { emailDomain?: string; website?: string }, noteText: string, classifiedBy: 'ai' | 'mechanical') {
      const prev = dbRef.current;
      const entity = prev.entities.find((e) => e.id === entityId);
      if (!entity) return;
      const dateStr = new Date().toISOString().slice(0, 10);
      const noteBlock = `Ficha de contacto (importada) — ${dateStr}\n${noteText}`;
      const notes = entity.notes ? `${entity.notes}\n\n${noteBlock}` : noteBlock;
      const email_domain = entity.email_domain ?? parsed.emailDomain;
      const website = entity.website ?? parsed.website;

      commit({
        ...prev,
        entities: prev.entities.map((e) => e.id === entityId ? { ...e, email_domain, website, notes } : e),
        interactions: prev.interactions.map((i) => i.id === interactionId ? { ...i, needs_review: false, classified_by: classifiedBy } : i),
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('entities').update({ email_domain, website, notes }).eq('id', entityId), 'applyMetadataCard:entity');
        persist(sb.from('interactions').update({ needs_review: false, classified_by: classifiedBy }).eq('id', interactionId), 'applyMetadataCard:interaction');
      }
    },

    toggleTask(id: string) {
      const prev = dbRef.current;
      let newDone = false;
      const tasks = prev.tasks.map((t) => {
        if (t.id !== id) return t;
        newDone = !t.done;
        return { ...t, done: newDone };
      });
      commit({ ...prev, tasks });
      if (orgIdRef.current) persist(sb.from('tasks').update({ done: newDone }).eq('id', id), 'toggleTask');
    },

    addTask(t: Omit<TaskItem, 'id' | 'done'>) {
      const prev = dbRef.current;
      const row: TaskItem = { ...t, id: uuid(), done: false };
      commit({ ...prev, tasks: [...prev.tasks, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('tasks').insert({ ...row, org_id: o }), 'addTask');
    },

    addRejectionCode(rc: Omit<RejectionCode, 'id' | 'created_at'>) {
      const prev = dbRef.current;
      const row: RejectionCode = { ...rc, id: uuid(), created_at: new Date().toISOString() };
      const next = { ...prev, rejectionCodes: [...prev.rejectionCodes, row] };
      commit(next);
      const o = orgIdRef.current;
      if (o) persist(sb.from('rejection_codes').insert({ ...row, org_id: o }), 'addRejectionCode');
      // 253 §2 — a retroactively-coded pass compares against the CURRENT
      // startup classification immediately.
      applyReactivations(next, [rc.entity_id]);
    },

    addOrgAxisClassification(c: Omit<OrgAxisClassification, 'id' | 'confirmed_at'>) {
      const prev = dbRef.current;
      const row: OrgAxisClassification = { ...c, id: uuid(), confirmed_at: new Date().toISOString() };
      const next = { ...prev, orgAxisClassifications: [...prev.orgAxisClassifications, row] };
      commit(next);
      const o = orgIdRef.current;
      if (o) persist(sb.from('org_axis_classifications').insert({ ...row, org_id: o }), 'addOrgAxisClassification');
      // Bloc C — see the identical comment in store-demo.tsx: no entity
      // filter, this can clear any entity's code on the same axis.
      applyReactivations(next);
    },

    updateTask(id: string, patch: {
      reminder_at?: string | null; snoozed_until?: string | null; due_at?: string; notes?: string | null;
      reminder_muted?: boolean; last_reminded_at?: string | null;
    }) {
      const prev = dbRef.current;
      const tasks = prev.tasks.map((t) => t.id === id ? { ...t, ...patch } : t);
      commit({ ...prev, tasks });
      if (orgIdRef.current) persist(sb.from('tasks').update(patch).eq('id', id), 'updateTask');
    },

    updateOrg(patch: Partial<Org>) {
      const prev = dbRef.current;
      const next = { ...prev, org: { ...prev.org, ...patch } };
      commit(next);
      // orgs has an owner-only RLS update policy and needs admin editing too,
      // so writes go through /api/org/update (service-role after a role
      // check) rather than the browser client — fire-and-forget, the local
      // commit already reflects it optimistically.
      fetch('/api/org/update', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      }).then((r) => r.json()).then((b) => { if (!b.ok) console.error('[supabase-store] updateOrg failed:', b.error); }).catch((e) => console.error('[supabase-store] updateOrg failed:', e));
      // Bloco B — the startup itself changed; 'stage'/'sectors' are the
      // two axes this engine understands structurally today.
      if ('stage' in patch || 'sectors' in patch) applyReactivations(next);
    },

    addCompanyPerson(p) {
      const prev = dbRef.current;
      const sortOrder = prev.companyPeople.length
        ? Math.max(...prev.companyPeople.map((x) => x.sort_order)) + 1 : 0;
      const now = new Date().toISOString();
      const row: CompanyPerson = { ...p, id: uuid(), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now };
      commit({ ...prev, companyPeople: [...prev.companyPeople, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('company_people').insert({ ...row, org_id: o }), 'addCompanyPerson');
    },
    updateCompanyPerson(id, patch) {
      const prev = dbRef.current;
      commit({ ...prev, companyPeople: prev.companyPeople.map((p) => (p.id === id ? { ...p, ...patch, updated_at: new Date().toISOString() } : p)) });
      persist(sb.from('company_people').update(nullify(patch)).eq('id', id), 'updateCompanyPerson');
    },
    removeCompanyPerson(id) {
      const prev = dbRef.current;
      commit({ ...prev, companyPeople: prev.companyPeople.filter((p) => p.id !== id) });
      persist(sb.from('company_people').delete().eq('id', id), 'removeCompanyPerson');
    },

    async addTractionMetric(m) {
      const prev = dbRef.current;
      const sortOrder = prev.tractionMetrics.length
        ? Math.max(...prev.tractionMetrics.map((x) => x.sort_order)) + 1 : 0;
      const now = new Date().toISOString();
      const row: TractionMetric = { ...m, id: uuid(), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now };
      const o = orgIdRef.current;
      if (o) {
        // Awaited, not fire-and-forget — a brand-new metric created already
        // featured can also hit org_traction_metrics_dealdigger_limit; on
        // rejection the whole row must never appear locally at all.
        const { error } = await sb.from('org_traction_metrics').insert({ ...row, org_id: o });
        if (error) return { error: friendlyTractionError(error.message) };
      }
      commit({ ...prev, tractionMetrics: [...prev.tractionMetrics, row] });
      return {};
    },
    async updateTractionMetric(id, patch) {
      // Awaited (not fire-and-forget like the other persist() calls) because
      // org_traction_metrics_dealdigger_limit can reject this one (max 2
      // featured per org) — commit locally only after the DB confirms, so a
      // rejected toggle never leaves the optimistic UI state wrong.
      const { error } = await sb.from('org_traction_metrics').update(nullify(patch)).eq('id', id);
      if (error) return { error: friendlyTractionError(error.message) };
      const prev = dbRef.current;
      commit({ ...prev, tractionMetrics: prev.tractionMetrics.map((m) => (m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m)) });
      return {};
    },
    removeTractionMetric(id) {
      const prev = dbRef.current;
      commit({ ...prev, tractionMetrics: prev.tractionMetrics.filter((m) => m.id !== id) });
      persist(sb.from('org_traction_metrics').delete().eq('id', id), 'removeTractionMetric');
    },

    // Prompt 167 — same add/update/remove shape as traction metrics above,
    // minus the dealdigger-limit rejection path (roadmap has no such
    // constraint, so these stay simple fire-and-forget-with-error-surfaced
    // rather than needing an awaited-before-commit round trip).
    // Prompt 387 §B — each of these three now wraps its own network call in
    // try/catch: a genuine network failure (offline, DNS, an aborted
    // fetch) throws out of `sb.from(...)` rather than resolving to
    // `{error}` — confirmed live by forcing `window.fetch` to reject.
    // Before this, that throw propagated out of an un-awaited caller
    // (CategoryManager's onClick) as an unhandled promise rejection —
    // invisible to the founder, exactly the "não fez nada" Nuno described.
    // Converting it to the same `{error}` shape as a real Supabase error
    // means CategoryManager only ever has ONE case to handle, not two.
    async addRoadmapCategory(c) {
      const prev = dbRef.current;
      const row: RoadmapCategory = { visible: true, ...c, id: uuid(), org_id: prev.org.id, created_at: new Date().toISOString() };
      const o = orgIdRef.current;
      if (o) {
        try {
          const { error } = await sb.from('roadmap_categories').insert({ ...row, org_id: o });
          if (error) return { error: error.message };
        } catch (e) { return { error: (e as Error).message || 'Could not reach the server — check your connection and try again.' }; }
      }
      commit({ ...prev, roadmapCategories: [...prev.roadmapCategories, row] });
      return {};
    },
    async removeRoadmapCategory(id) {
      const prev = dbRef.current;
      if (orgIdRef.current) {
        try {
          const { error } = await sb.from('roadmap_categories').delete().eq('id', id);
          if (error) return { error: error.message };
        } catch (e) { return { error: (e as Error).message || 'Could not reach the server — check your connection and try again.' }; }
      }
      // Os itens que apontavam para ela NAO se tocam: o leitor resolve o
      // lookup-miss como General (roadmap-categories.ts) — o contrato que
      // faz apagar ser seguro sem triggers.
      commit({ ...prev, roadmapCategories: prev.roadmapCategories.filter((c) => c.id !== id) });
      return {};
    },
    async updateRoadmapCategory(id, patch) {
      try {
        const { error } = await sb.from('roadmap_categories').update(patch).eq('id', id);
        if (error) return { error: error.message };
      } catch (e) { return { error: (e as Error).message || 'Could not reach the server — check your connection and try again.' }; }
      const prev = dbRef.current;
      commit({ ...prev, roadmapCategories: prev.roadmapCategories.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
      return {};
    },
    async addFundingRound(r) {
      const prev = dbRef.current;
      const row: FundingRound = { ...r, id: uuid(), org_id: prev.org.id, created_at: new Date().toISOString() };
      const o = orgIdRef.current;
      if (o) {
        const { error } = await sb.from('funding_rounds').insert({ ...row, org_id: o });
        if (error) return { error: error.message };
      }
      commit({ ...prev, fundingRounds: [...prev.fundingRounds, row] });
      return {};
    },
    async removeFundingRound(id) {
      const prev = dbRef.current;
      if (orgIdRef.current) {
        const { error } = await sb.from('funding_rounds').delete().eq('id', id);
        if (error) return { error: error.message };
      }
      commit({ ...prev, fundingRounds: prev.fundingRounds.filter((f) => f.id !== id) });
      return {};
    },
    async addRoadmapMilestone(m) {
      const prev = dbRef.current;
      const sortOrder = prev.roadmapMilestones.length
        ? Math.max(...prev.roadmapMilestones.map((x) => x.sort_order)) + 1 : 0;
      const now = new Date().toISOString();
      const row: RoadmapMilestone = { ...m, id: uuid(), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now };
      const o = orgIdRef.current;
      if (o) {
        const { error } = await sb.from('company_roadmap_milestones').insert({ ...row, org_id: o });
        if (error) return { error: error.message };
      }
      commit({ ...prev, roadmapMilestones: [...prev.roadmapMilestones, row] });
      return {};
    },
    async updateRoadmapMilestone(id, patch) {
      const { error } = await sb.from('company_roadmap_milestones').update(nullify(patch)).eq('id', id);
      if (error) return { error: error.message };
      const prev = dbRef.current;
      commit({ ...prev, roadmapMilestones: prev.roadmapMilestones.map((r) => (r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r)) });
      return {};
    },
    removeRoadmapMilestone(id) {
      const prev = dbRef.current;
      commit({ ...prev, roadmapMilestones: prev.roadmapMilestones.filter((r) => r.id !== id) });
      persist(sb.from('company_roadmap_milestones').delete().eq('id', id), 'removeRoadmapMilestone');
    },

    // Prompt 359 — the roadmap canvas's own CRUD, direct-to-Supabase same as
    // every other org-scoped table here (RLS via is_org_member does the
    // real access control; no server route needed for a plain scalar
    // update like this one — unlike company_claims.document_refs, there's
    // no array-append race to guard against here, since document_id is a
    // single FK column, not an array).
    async addRoadmapEvent(e) {
      const prev = dbRef.current;
      const sortOrder = prev.roadmapEvents.length
        ? Math.max(...prev.roadmapEvents.map((x) => x.sort_order)) + 1 : 0;
      const now = new Date().toISOString();
      const row: RoadmapEvent = { ...e, id: uuid(), org_id: prev.org.id, sort_order: sortOrder, created_at: now, updated_at: now };
      const o = orgIdRef.current;
      if (o) {
        const { error } = await sb.from('roadmap_events').insert({ ...row, org_id: o });
        if (error) return { error: error.message };
      }
      commit({ ...prev, roadmapEvents: [...prev.roadmapEvents, row] });
      return { id: row.id };
    },
    async updateRoadmapEvent(id, patch) {
      const { error } = await sb.from('roadmap_events').update(nullify(patch)).eq('id', id);
      if (error) return { error: error.message };
      const prev = dbRef.current;
      commit({ ...prev, roadmapEvents: prev.roadmapEvents.map((r) => (r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r)) });
      return {};
    },
    removeRoadmapEvent(id) {
      const prev = dbRef.current;
      commit({ ...prev, roadmapEvents: prev.roadmapEvents.filter((r) => r.id !== id) });
      persist(sb.from('roadmap_events').delete().eq('id', id), 'removeRoadmapEvent');
    },

    setEntityStatus(id: string, status: EntityStatus, reason?: string) {
      const prev = dbRef.current;
      // Prompt 205 §B (reversao) — sair de dormant fecha a task de revisita,
      // que deixou de ter sentido: a revisita aconteceu. Feito aqui e nao no
      // componente porque a saida de dormant tem mais do que um caminho.
      const entity = prev.entities.find((e) => e.id === id);
      const wasParked = entity?.status === 'dormant';
      const closeIds = wasParked && status !== 'dormant' ? revisitTasksToClose(prev.tasks, id) : [];
      commit({
        ...prev,
        tasks: closeIds.length ? prev.tasks.map((t) => closeIds.includes(t.id) ? { ...t, done: true } : t) : prev.tasks,
        entities: prev.entities.map((e) => e.id === id
          ? {
              ...e, status,
              dormant_since: status === 'dormant' ? new Date().toISOString() : e.dormant_since,
              dormant_reason: status === 'dormant' ? reason ?? e.dormant_reason : e.dormant_reason,
            }
          : e),
      });
      if (orgIdRef.current) {
        const oid = orgIdRef.current;
        const patch: Record<string, unknown> = { status };
        if (status === 'dormant') {
          patch.dormant_since = new Date().toISOString();
          if (reason !== undefined) patch.dormant_reason = reason;
        }
        persist(sb.from('entities').update(patch).eq('id', id), 'setEntityStatus');
        for (const tid of closeIds) persist(sb.from('tasks').update({ done: true }).eq('id', tid), 'setEntityStatus:closeRevisit');

        // Prompt 416 §A.2 — same "genuine transition only" guard as
        // store-demo.tsx. Fire-and-forget: this is a secondary signal for
        // a later engine, not something a status change should ever be
        // blocked by.
        if (entity && (status === 'passed' || status === 'dormant') && entity.status !== status) {
          captureReopenSnapshot(sb, oid, entity, status, prev.catalog).then((snap) => {
            if (!snap) return;
            commit({ ...dbRef.current, entityReopenSnapshots: [...dbRef.current.entityReopenSnapshots, snap] });
          });
        }
      }
    },

    setInterest(id: string, eur: number | undefined) {
      const prev = dbRef.current;
      commit({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, interest_eur: eur } : e) });
      if (orgIdRef.current) persist(sb.from('entities').update({ interest_eur: eur ?? null }).eq('id', id), 'setInterest');
    },

    // Prompt 273 §3 / Prompt 277 A — see the matching comment in
    // store-demo.tsx's resolveHardFilter for why the audit columns
    // accompany both permanent-banner statuses now, and store-context.tsx
    // for why the actual fraud report (entity_fraud_flags) is written
    // separately, server-side, before this is ever called. userIdRef.
    // current mirrors edited_by's own pattern (line ~555,
    // interaction_edits) — the signed-in user's real auth.users id, not a
    // resolved display name.
    resolveHardFilter(id: string, status: 'open' | 'resolved_ok' | 'resolved_not_a_fit' | 'resolved_blocked') {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      const permanent = status === 'resolved_blocked' || status === 'resolved_not_a_fit';
      const resolvedAt = permanent ? now : undefined;
      const resolvedBy = permanent ? (userIdRef.current ?? undefined) : undefined;
      commit({
        ...prev,
        entities: prev.entities.map((e) => e.id === id
          ? { ...e, hard_filter_status: status, hard_filter_resolved_at: resolvedAt, hard_filter_resolved_by: resolvedBy }
          : e),
      });
      if (orgIdRef.current) {
        persist(sb.from('entities').update({
          hard_filter_status: status,
          hard_filter_resolved_at: resolvedAt ?? null,
          hard_filter_resolved_by: resolvedBy ?? null,
        }).eq('id', id), 'resolveHardFilter');
      }
    },

    updateEntity(id: string, patch: Partial<Entity>) {
      const prev = dbRef.current;
      const next = { ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, ...patch } : e) };
      commit(next);
      if (orgIdRef.current) persist(sb.from('entities').update(nullify(patch)).eq('id', id), 'updateEntity');
      // 253 (addendum) — see REACTIVATION_TRIGGER_FIELDS in store-demo.tsx
      // for the same list; kept here as a literal since this file has no
      // shared module-scope constant with that one.
      if (['sectors', 'invests_in_geographies', 'stage_min', 'stage_max', 'check_min_eur', 'check_max_eur'].some((f) => f in patch)) {
        applyReactivations(next, [id]);
      }
    },

    updatePerson(id: string, patch: Partial<Person>) {
      const prev = dbRef.current;
      commit({ ...prev, people: prev.people.map((p) => p.id === id ? { ...p, ...patch } : p) });
      if (orgIdRef.current) persist(sb.from('people').update(patch).eq('id', id), 'updatePerson');
    },

    addPerson(p) {
      const prev = dbRef.current;
      const siblings = prev.people.filter((x) => x.entity_id === p.entity_id);
      const seniority_rank = siblings.length ? Math.max(...siblings.map((x) => x.seniority_rank)) + 1 : 1;
      const person: Person = {
        id: uuid(), entity_id: p.entity_id, full_name: p.full_name, role: p.role, gender: p.gender,
        linkedin_url: p.linkedin_url, email_guess: p.email_guess, phone: p.phone,
        seniority_rank, linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
        hook_status: 'to_research', kill_words: [], preferred_language: 'pt',
        privacy_notice_sent: false, do_not_contact: false, identity_verified: false,
        data_source: 'Quick-created during logging',
      };
      commit({ ...prev, people: [...prev.people, person] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('people').insert({ ...person, org_id: o }), 'addPerson');
      return person;
    },

    markEntityVerified(entityId: string) {
      const prev = dbRef.current;
      const last_verified = new Date().toISOString().slice(0, 10);
      commit({ ...prev, entities: prev.entities.map((e) => e.id === entityId ? { ...e, last_verified } : e) });
      if (orgIdRef.current) persist(sb.from('entities').update({ last_verified }).eq('id', entityId), 'markEntityVerified');
    },

    addCompanyFact(f: Omit<CompanyFact, 'id' | 'created_at' | 'updated_at'>) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      const row: CompanyFact = { ...f, id: uuid(), created_at: now, updated_at: now };
      commit({ ...prev, companyFacts: [...prev.companyFacts, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('company_facts').insert({ ...row, org_id: o }), 'addCompanyFact');
    },

    confirmCompanyFact(id: string) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      commit({
        ...prev,
        companyFacts: prev.companyFacts.map((f) => f.id === id ? { ...f, status: 'confirmed' as const, confirmed_at: now, updated_at: now } : f),
      });
      persist(sb.from('company_facts').update({ status: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', id), 'confirmCompanyFact');
      triggerReawakening(id);
    },

    editAndConfirmCompanyFact(id: string, statement: string) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      commit({
        ...prev,
        companyFacts: prev.companyFacts.map((f) => f.id === id
          ? { ...f, statement, status: 'confirmed' as const, confirmed_at: now, updated_at: now } : f),
      });
      persist(sb.from('company_facts').update({ statement, status: 'confirmed', confirmed_at: now, updated_at: now }).eq('id', id), 'editAndConfirmCompanyFact');
      triggerReawakening(id);
    },

    rejectCompanyFact(id: string) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      commit({ ...prev, companyFacts: prev.companyFacts.map((f) => f.id === id ? { ...f, status: 'deprecated' as const, updated_at: now } : f) });
      persist(sb.from('company_facts').update({ status: 'deprecated', updated_at: now }).eq('id', id), 'rejectCompanyFact');
    },

    supersedeCompanyFact(oldId: string, newStatement: string) {
      const prev = dbRef.current;
      const old = prev.companyFacts.find((f) => f.id === oldId);
      if (!old) return;
      const now = new Date().toISOString();
      const successor: CompanyFact = {
        id: uuid(), category: old.category, statement: newStatement, status: 'confirmed',
        source: 'user', valid_from: now.slice(0, 10), confirmed_at: now, created_at: now, updated_at: now,
      };
      commit({
        ...prev,
        companyFacts: [
          ...prev.companyFacts.map((f) => f.id === oldId ? { ...f, status: 'deprecated' as const, superseded_by: successor.id, updated_at: now } : f),
          successor,
        ],
      });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('company_facts').update({ status: 'deprecated', superseded_by: successor.id, updated_at: now }).eq('id', oldId), 'supersedeCompanyFact:old');
        persist(sb.from('company_facts').insert({ ...successor, org_id: o }), 'supersedeCompanyFact:new');
      }
      // Superseding = positioning changed: evaluate against the successor fact,
      // passing the OLD statement so the AI sees the delta.
      triggerReawakening(successor.id, old.statement);
    },

    setDoNotContact(personId: string) {
      const prev = dbRef.current;
      commit({
        ...prev,
        people: prev.people.map((p) => p.id === personId
          ? {
              ...p, do_not_contact: true,
              email_verified: undefined, email_guess: undefined, phone: undefined,
              background: undefined, personal_notes: undefined, hook: undefined,
              hook_status: 'none_found', watch_outs: undefined, linkedin_url: undefined,
            }
          : p),
      });
      if (orgIdRef.current) {
        persist(sb.from('people').update({
          do_not_contact: true, email_verified: null, email_guess: null, phone: null,
          background: null, personal_notes: null, hook: null, hook_status: 'none_found',
          watch_outs: null, linkedin_url: null,
        }).eq('id', personId), 'setDoNotContact');
      }
    },

    addDocument(d: Omit<DocumentItem, 'id'>) {
      const external_url = d.external_url ? normalizeDocumentUrl(d.external_url) : d.external_url;
      if (external_url && isEditableLink(external_url)) {
        throw new Error('Editable link rejected — only view-only links can be stored.');
      }
      const prev = dbRef.current;
      const row: DocumentItem = { ...d, external_url, id: uuid(), created_at: new Date().toISOString() };
      commit({ ...prev, documents: [...prev.documents, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('documents').insert({ ...row, org_id: o }), 'addDocument');
      triggerDocumentExtraction(row.id, row.name, row.malware_scan_status);
      return row.id;
    },

    deleteDocument(id: string) {
      const prev = dbRef.current;
      const doc = prev.documents.find((d) => d.id === id);
      if (!doc) return;
      commit({ ...prev, documents: prev.documents.filter((d) => d.id !== id) });
      // access_grants scoped to this document are cleaned up by the DB's
      // own cascade (documents(id) on delete cascade) — nothing to do here.
      if (doc.storage_path) persist(sb.storage.from('data-room').remove([doc.storage_path]), 'deleteDocument:storage');
      persist(sb.from('documents').delete().eq('id', id), 'deleteDocument:row');
    },

    renameDocument(id: string, name: string) {
      const prev = dbRef.current;
      commit({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, name } : d) });
      if (orgIdRef.current) {
        persist(sb.from('documents').update({ name }).eq('id', id), 'renameDocument');
        // Prompt 358 Phase 2.1 — a rename can be the ONLY signal that turns a
        // vague filename into real evidence for an existing claim (the
        // motivating fixture: renaming a file to "Woman In Tech Agreement").
        // Fire-and-forget, same shape as triggerDocumentExtraction — never
        // blocks the rename itself, and the route degrades to a no-op if
        // migration 0235 or the Anthropic key isn't available.
        fetch('/api/blueprint/reconcile', { method: 'POST' }).catch(() => { /* never blocks the rename */ });
      }
    },

    updateDocumentDetails(id: string, details: string) {
      const prev = dbRef.current;
      commit({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, details } : d) });
      if (orgIdRef.current) persist(sb.from('documents').update({ details }).eq('id', id), 'updateDocumentDetails');
    },

    updateDocumentVisibility(id, visibility) {
      const prev = dbRef.current;
      commit({ ...prev, documents: prev.documents.map((d) => d.id === id ? { ...d, visibility } : d) });
      if (orgIdRef.current) persist(sb.from('documents').update({ visibility }).eq('id', id), 'updateDocumentVisibility');
    },

    // Data Room v3 (E5) — drag a document onto a folder. Appends to the end
    // of the destination's documents (position = max sibling + 1) so it lands
    // last rather than colliding with an existing position.
    moveDocumentToFolder(docId: string, folderId: string | undefined) {
      const prev = dbRef.current;
      const doc = prev.documents.find((d) => d.id === docId);
      if (!doc) return;
      const siblings = prev.documents.filter((d) => d.folder_id === folderId && d.id !== docId);
      const position = siblings.length ? Math.max(...siblings.map((d) => d.position ?? 0)) + 1 : 0;
      commit({ ...prev, documents: prev.documents.map((d) => d.id === docId ? { ...d, folder_id: folderId, position } : d) });
      if (orgIdRef.current) persist(sb.from('documents').update({ folder_id: folderId ?? null, position }).eq('id', docId), 'moveDocumentToFolder');
    },

    // Persist a new within-folder order (migration 0027). Writes one update
    // per moved row; positions are the array index so they stay dense.
    reorderDocuments(folderId: string | undefined, orderedIds: string[]) {
      const prev = dbRef.current;
      const pos = new Map(orderedIds.map((id, i) => [id, i] as const));
      commit({
        ...prev,
        documents: prev.documents.map((d) => (d.folder_id === folderId && pos.has(d.id)) ? { ...d, position: pos.get(d.id)! } : d),
      });
      if (orgIdRef.current) {
        for (const [id, position] of pos) persist(sb.from('documents').update({ position }).eq('id', id), 'reorderDocuments');
      }
    },

    // Swap the underlying file, keeping the same row/details/grants. Removes
    // the old storage object once the row points at the new path — the record
    // (name, folder, position, access grants) is deliberately preserved.
    replaceDocumentFile(docId: string, newStoragePath: string) {
      const prev = dbRef.current;
      const doc = prev.documents.find((d) => d.id === docId);
      if (!doc) return;
      const oldPath = doc.storage_path;
      commit({ ...prev, documents: prev.documents.map((d) => d.id === docId ? { ...d, storage_path: newStoragePath } : d) });
      if (orgIdRef.current) {
        persist(sb.from('documents').update({ storage_path: newStoragePath }).eq('id', docId), 'replaceDocumentFile:row');
        if (oldPath && oldPath !== newStoragePath) persist(sb.storage.from('data-room').remove([oldPath]), 'replaceDocumentFile:storage');
      }
    },

    // E7 — the versioning counterpart to replaceDocumentFile. NEVER removes the
    // old Storage object; it becomes a prior version. Repoints the document to
    // the new path (so portal/signed URLs serve current automatically).
    addDocumentVersion(docId: string, storagePath: string, size?: number, scan?: { status?: string; provider?: string | null; sha256?: string }) {
      const prev = dbRef.current;
      const doc = prev.documents.find((d) => d.id === docId);
      if (!doc) return;
      const existing = prev.documentVersions.filter((v) => v.document_id === docId);
      const now = new Date().toISOString();
      // Prompt 301 §3 — a restore (an OLD object, already scanned when it
      // was first uploaded) passes no `scan` at all; a genuinely new file
      // always does. Falling back to 'not_scanned' rather than inventing a
      // status for either case keeps this honest either way.
      const malwareScanStatus = (scan?.status as DocumentItem['malware_scan_status']) ?? 'not_scanned';
      const rows: DocumentVersion[] = [];
      let nextNum = existing.length ? Math.max(...existing.map((v) => v.version)) + 1 : 1;
      if (existing.length === 0 && doc.storage_path && doc.storage_path !== storagePath) {
        rows.push({
          id: uuid(), document_id: docId, version: 1, storage_path: doc.storage_path, uploaded_at: doc.created_at ?? now,
          malware_scan_status: doc.malware_scan_status ?? 'not_scanned',
        });
        nextNum = 2;
      }
      rows.push({
        id: uuid(), document_id: docId, version: nextNum, storage_path: storagePath, size, uploaded_at: now,
        malware_scan_status: malwareScanStatus, content_sha256: scan?.sha256,
      });
      commit({
        ...prev,
        documentVersions: [...prev.documentVersions, ...rows],
        documents: prev.documents.map((d) => d.id === docId ? { ...d, storage_path: storagePath, version: `v${nextNum}`, malware_scan_status: malwareScanStatus } : d),
      });
      const o = orgIdRef.current;
      if (o) {
        for (const r of rows) {
          persist(sb.from('document_versions').insert({
            id: r.id, document_id: r.document_id, version: r.version, storage_path: r.storage_path, size: r.size,
            uploaded_at: r.uploaded_at, malware_scan_status: r.malware_scan_status, content_sha256: r.content_sha256,
            malware_scan_provider: scan?.provider ?? null, malware_scan_checked_at: r.malware_scan_status !== 'not_scanned' ? now : null,
            org_id: o,
          }), 'addDocumentVersion:ver');
        }
        persist(sb.from('documents').update({
          storage_path: storagePath, version: `v${nextNum}`, malware_scan_status: malwareScanStatus,
          malware_scan_provider: scan?.provider ?? null, malware_scan_checked_at: malwareScanStatus !== 'not_scanned' ? now : null,
        }).eq('id', docId), 'addDocumentVersion:doc');
      }
      triggerDocumentExtraction(docId, doc.name, malwareScanStatus);
    },

    // F — approve a reawakening proposal. Entity returns to the active pipeline
    // with the (optionally overridden) suggested wave/fit + a follow-up task;
    // the proposal row is marked approved (RLS member-update).
    approveReawakening(proposalId: string, overrides?: { wave?: number; fit?: FitScore }) {
      const prev = dbRef.current;
      const p = prev.reawakeningProposals.find((x) => x.id === proposalId);
      if (!p) return;
      const now = new Date().toISOString();
      const entityName = prev.entities.find((e) => e.id === p.entity_id)?.name ?? '';
      const { entityPatch, task: taskBase } = buildReawakenApproval(p, entityName, overrides);
      const task: TaskItem = { ...taskBase, id: uuid(), done: false };
      commit({
        ...prev,
        entities: prev.entities.map((e) => e.id === p.entity_id ? { ...e, ...entityPatch } : e),
        tasks: [...prev.tasks, task],
        reawakeningProposals: prev.reawakeningProposals.map((x) => x.id === proposalId ? { ...x, status: 'approved', resolved_at: now } : x),
      });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('entities').update(nullify(entityPatch)).eq('id', p.entity_id), 'approveReawakening:entity');
        persist(sb.from('tasks').insert({ ...task, org_id: o }), 'approveReawakening:task');
        persist(sb.from('reawakening_proposals').update({ status: 'approved', resolved_at: now }).eq('id', proposalId), 'approveReawakening:proposal');
      }
    },

    rejectReawakening(proposalId: string) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      commit({ ...prev, reawakeningProposals: prev.reawakeningProposals.map((x) => x.id === proposalId ? { ...x, status: 'rejected', resolved_at: now } : x) });
      if (orgIdRef.current) persist(sb.from('reawakening_proposals').update({ status: 'rejected', resolved_at: now }).eq('id', proposalId), 'rejectReawakening');
    },

    // Prompt 271 §3 / Prompt 272 — founder-initiated only. Any 'reactivate'
    // verdict lands as a new reawakening_proposals row server-side;
    // refetch so it shows up in the same queue the other two origins
    // already use.
    async askSherlock(entityIds: string[]) {
      try {
        const res = await fetch('/api/reawakening/neglect-evaluate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entityIds }),
        });
        const body = await res.json() as {
          results?: { entityId: string; verdict: { outcome: NeglectOutcome; rationale: string; newHook?: string; holdReason?: string } }[];
        };
        const results = (body.results ?? []).map((r) => ({
          entityId: r.entityId, outcome: r.verdict.outcome, rationale: r.verdict.rationale,
          newHook: r.verdict.newHook, holdReason: r.verdict.holdReason,
        }));
        if (results.some((r) => r.outcome === 'reactivate')) await refetch();
        return results;
      } catch {
        return [];
      }
    },

    createFolder(name: string, parentId: string | undefined, kind: FolderKind) {
      const prev = dbRef.current;
      const siblings = prev.folders.filter((f) => f.parent_id === parentId);
      const position = siblings.length ? Math.max(...siblings.map((f) => f.position)) + 1 : 0;
      const folder: Folder = { id: uuid(), name, parent_id: parentId, kind, position };
      commit({ ...prev, folders: [...prev.folders, folder] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('folders').insert({ ...folder, org_id: o }), 'createFolder');
    },

    renameFolder(id: string, name: string) {
      const prev = dbRef.current;
      commit({ ...prev, folders: prev.folders.map((f) => f.id === id ? { ...f, name } : f) });
      if (orgIdRef.current) persist(sb.from('folders').update({ name }).eq('id', id), 'renameFolder');
    },

    // Reparents children BEFORE deleting the folder row, and awaits those
    // writes first — the DB's folders(id) on delete cascade would otherwise
    // race a fire-and-forget delete against the reparent update and could
    // wipe out real content that was meant to move to the parent instead.
    deleteFolder(id: string, moveContentsToParent: boolean) {
      const prev = dbRef.current;
      const folder = prev.folders.find((f) => f.id === id);
      if (!folder) return;
      const childFolders = prev.folders.filter((f) => f.parent_id === id);
      const childDocs = prev.documents.filter((d) => d.folder_id === id);
      if (!moveContentsToParent && (childFolders.length > 0 || childDocs.length > 0)) {
        throw new Error('Folder is not empty — delete its contents first, or choose "move contents to parent".');
      }
      commit({
        ...prev,
        folders: prev.folders.filter((f) => f.id !== id).map((f) => f.parent_id === id ? { ...f, parent_id: folder.parent_id } : f),
        documents: prev.documents.map((d) => d.folder_id === id ? { ...d, folder_id: folder.parent_id } : d),
      });
      if (!orgIdRef.current) return;
      (async () => {
        if (childFolders.length) await sb.from('folders').update({ parent_id: folder.parent_id ?? null }).eq('parent_id', id);
        if (childDocs.length) await sb.from('documents').update({ folder_id: folder.parent_id ?? null }).eq('folder_id', id);
        const { error } = await sb.from('folders').delete().eq('id', id);
        if (error) console.error('[supabase-store] deleteFolder failed:', error.message);
      })();
    },

    addGrant(g: Omit<AccessGrant, 'id' | 'granted_at'>) {
      const prev = dbRef.current;
      const grant: AccessGrant = { ...g, id: uuid(), granted_at: new Date().toISOString() };
      const auto = prev.automations.find((a) => a.trigger === 'grant_activated' && a.enabled);
      let run: AutomationRun | null = null;
      if (auto) {
        const person = prev.people.find((p) => p.id === g.person_id);
        // P104 #1 — a single "Grant access" click can insert multiple
        // access_grants rows in a cascade (one per folder/document
        // selected), and diffGrantSelection always does revoke+add rather
        // than update — each of those calls this fn. Without this check,
        // every one of them spawned its own draft (98 duplicates for one
        // real grant, confirmed live). A grant to the same person/entity
        // within the same 24h is the same "event" as far as the outreach
        // draft is concerned; a new grant days later should still draft fresh.
        const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - DEDUP_WINDOW_MS;
        const duplicate = prev.runs.find((r) =>
          r.automation_id === auto.id
          && (g.person_id ? r.person_id === g.person_id : r.entity_id === person?.entity_id)
          && (r.status === 'pending_review' || r.status === 'executed')
          && new Date(r.created_at).getTime() >= cutoff);
        if (!duplicate) {
          const email = person?.email_verified ?? g.grantee_email;
          run = {
            id: uuid(), automation_id: auto.id, entity_id: person?.entity_id, person_id: g.person_id,
            status: auto.mode === 'full_auto' && email ? 'executed' : 'pending_review',
            payload: {
              channel: 'email',
              subject: 'ablute_ — data room access',
              draft: `Hi ${person?.full_name?.split(' ')[0] ?? ''},\n\nAs discussed, here is your access to the ablute_ data room${g.expires_at ? ` (valid until ${g.expires_at.slice(0, 10)})` : ''}. You can sign in with this email address — no password needed.\n\nBest,\nNuno`,
            },
            created_at: new Date().toISOString(),
            executed_at: auto.mode === 'full_auto' && email ? new Date().toISOString() : undefined,
            blocked_reason: !email ? 'No verified email for the grantee — draft held for review.' : undefined,
          };
        }
      }
      commit({ ...prev, grants: [...prev.grants, grant], runs: run ? [...prev.runs, run] : prev.runs });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('access_grants').insert({ ...grant, org_id: o }), 'addGrant:grant');
        if (run) persist(sb.from('automation_runs').insert({ ...run, org_id: o }), 'addGrant:run');
        // Prompt 122 Block B (F1) §2.3 — ecosystem_facts observation only
        // (grant_created); zero effect on grant logic either way. Best-
        // effort, fire-and-forget, same pattern as triggerReawakening above.
        // ecosystem_facts only accepts service-role writes (see migration
        // 0116), hence the server hop this direct client insert otherwise
        // wouldn't need.
        fetch('/api/ecosystem/grant-created', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orgId: o, grantId: grant.id }),
        }).catch(() => { /* never blocks the grant */ });
      }
    },

    revokeGrant(id: string) {
      const prev = dbRef.current;
      const revoked_at = new Date().toISOString();
      commit({ ...prev, grants: prev.grants.map((g) => g.id === id ? { ...g, revoked_at } : g) });
      if (orgIdRef.current) persist(sb.from('access_grants').update({ revoked_at }).eq('id', id), 'revokeGrant');
    },

    async invitePersonForGrant(entityId: string, email: string, name: string): Promise<Person> {
      const prev = dbRef.current;
      const normalizedEmail = email.trim().toLowerCase();
      // Reconcile by email first — inviting the same person to a second
      // folder later shouldn't spawn a duplicate `people` row.
      const existing = prev.people.find((p) =>
        p.entity_id === entityId && (p.email_verified?.toLowerCase() === normalizedEmail || p.email_guess?.toLowerCase() === normalizedEmail));
      if (existing) return existing;

      const siblings = prev.people.filter((x) => x.entity_id === entityId);
      const seniority_rank = siblings.length ? Math.max(...siblings.map((x) => x.seniority_rank)) + 1 : 1;
      const person: Person = {
        id: uuid(), entity_id: entityId, full_name: name, email_guess: normalizedEmail,
        seniority_rank, linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
        hook_status: 'to_research', kill_words: [], preferred_language: 'en',
        privacy_notice_sent: false, do_not_contact: false, identity_verified: false,
        // §1c provenance — this is the founder's own claim about who this
        // person is, not a confirmed fact. Distinct from the person's own
        // later self-confirmation (self_verified on the resulting grant),
        // which is a much stronger signal — see the "Is this you?" flow.
        data_source: 'founder_invite',
      };
      const affiliation: PersonAffiliation = {
        id: uuid(), person_id: person.id, entity_id: entityId, kind: 'other', current: true,
        notes: `Added via founder access invite (${new Date().toISOString().slice(0, 10)}).`,
      };
      commit({ ...prev, people: [...prev.people, person], personAffiliations: [...prev.personAffiliations, affiliation] });
      const o = orgIdRef.current;
      if (o) {
        // person_affiliations.person_id (and access_grants.person_id, set by
        // the caller right after this returns) both FK into people.id — the
        // affiliation insert must wait for the person row to actually land,
        // not just fire in parallel (that raced and violated the FK live).
        const { error: personErr } = await sb.from('people').insert({ ...person, org_id: o });
        if (personErr) {
          console.error('[supabase-store] invitePersonForGrant:person failed:', personErr.message);
          return person;
        }
        persist(sb.from('person_affiliations').insert({ ...affiliation, org_id: o }), 'invitePersonForGrant:affiliation');
      }
      return person;
    },

    // No persist() here — /api/data-room/nda-upload already wrote both the
    // ndas row and the grants' nda_accepted_at server-side; this only syncs
    // local state to match what's already on disk.
    recordNdaUpload(nda: Nda, unlockedGrantIds: string[]) {
      const prev = dbRef.current;
      commit({
        ...prev,
        ndas: [...prev.ndas, nda],
        grants: prev.grants.map((g) => unlockedGrantIds.includes(g.id) ? { ...g, nda_accepted_at: new Date().toISOString() } : g),
      });
    },

    recordDocumentView(documentId: string, viewerEmail: string) {
      const o = orgIdRef.current;
      if (!o) return; // investor portal with no resolved org — safe no-op (Phase 4 wires real per-grant access)
      const prev = dbRef.current;
      // seconds/pages are left unset — this app doesn't yet measure actual
      // time-on-page, and a real portal view shouldn't carry a fabricated
      // duration (unlike demo mode, which is allowed to synthesize
      // plausible-looking data for local testing).
      const row: DocumentView = {
        id: uuid(), document_id: documentId, viewer_email: viewerEmail, viewed_at: new Date().toISOString(),
      };
      commit({ ...prev, views: [...prev.views, row] });
      persist(sb.from('document_views').insert({ ...row, org_id: o }), 'recordDocumentView');
    },

    toggleAutomation(id: string) {
      const prev = dbRef.current;
      let newEnabled = false;
      const automations = prev.automations.map((a) => {
        if (a.id !== id) return a;
        newEnabled = !a.enabled;
        return { ...a, enabled: newEnabled };
      });
      commit({ ...prev, automations });
      if (orgIdRef.current) persist(sb.from('automations').update({ enabled: newEnabled }).eq('id', id), 'toggleAutomation');
    },

    setAutomationMode(id: string, mode: Automation['mode']) {
      const prev = dbRef.current;
      commit({ ...prev, automations: prev.automations.map((a) => a.id === id ? { ...a, mode } : a) });
      if (orgIdRef.current) persist(sb.from('automations').update({ mode }).eq('id', id), 'setAutomationMode');
    },

    setAutomationConfig(id: string, config: Record<string, unknown>) {
      const prev = dbRef.current;
      const merged = { ...(prev.automations.find((a) => a.id === id)?.config ?? {}), ...config };
      commit({ ...prev, automations: prev.automations.map((a) => a.id === id ? { ...a, config: merged } : a) });
      if (orgIdRef.current) persist(sb.from('automations').update({ config: merged }).eq('id', id), 'setAutomationConfig');
    },

    // Mirrors the demo engine tick exactly, over the current in-memory snapshot;
    // in production this also runs server-side on the daily cron (/api/automations).
    runAutomationTick() {
      const prev = dbRef.current;
      let runs = [...prev.runs];
      let tasks = [...prev.tasks];
      const newRuns: AutomationRun[] = [];
      const newTasks: TaskItem[] = [];
      const pending = outboundsAwaitingFollowUp(prev);
      const followAuto = prev.automations.find((a) => a.trigger === 'no_reply_14d' && a.enabled);
      const dormantAuto = prev.automations.find((a) => a.trigger === 'followup_no_reply_14d' && a.enabled);

      for (const p of pending) {
        const already = runs.some((r) =>
          r.entity_id === p.entity?.id && ['pending_review', 'drafted', 'approved'].includes(r.status));
        if (already) continue;

        if (!p.isSecondSilence && followAuto && p.person && p.entity) {
          const tpl = prev.templates.find((t) => t.id === followAuto.template_id);
          const draft = tpl ? fillTemplate(tpl.body, {
            first_name: p.person.full_name.split(' ')[0],
            days_ago: '14',
            hook_line: p.person.hook ?? '',
            the_ask: p.entity.the_ask ?? '',
            deck_link: prev.documents.find((d) => d.id === 'doc-deck')?.external_url ?? '',
          }) : 'Follow-up draft';
          const canAuto = followAuto.mode === 'full_auto' && !!p.person.email_verified && p.person.bounce_count === 0;
          const run: AutomationRun = {
            id: uuid(), automation_id: followAuto.id, entity_id: p.entity.id, person_id: p.person.id,
            status: canAuto ? 'approved' : 'pending_review',
            payload: { channel: 'email', subject: 'Following up — ablute_', draft },
            created_at: new Date().toISOString(),
            blocked_reason: followAuto.mode === 'full_auto' && !canAuto
              ? 'full_auto blocked: no verified email — held for review (guessed addresses are never auto-sent).' : undefined,
          };
          runs.push(run); newRuns.push(run);
        }

        if (p.isSecondSilence && dormantAuto && p.entity) {
          const run: AutomationRun = {
            id: uuid(), automation_id: dormantAuto.id, entity_id: p.entity.id, person_id: p.person?.id,
            status: 'pending_review',
            payload: { note: `No reply 14 days after the follow-up. Propose marking ${p.entity.name} dormant. Never a third message.` },
            created_at: new Date().toISOString(),
          };
          runs.push(run); newRuns.push(run);
        }
      }

      const hookAuto = prev.automations.find((a) => a.trigger === 'hook_missing' && a.enabled);
      if (hookAuto) {
        for (const person of prev.people) {
          if (person.hook_status === 'to_research' && !person.do_not_contact) {
            const has = tasks.some((t) => t.person_id === person.id && t.kind === 'research' && !t.done);
            if (!has) {
              const task: TaskItem = {
                id: uuid(), kind: 'research', action_type: 'research_hook', done: false,
                title: `Research hook: ${person.full_name}`, person_id: person.id, entity_id: person.entity_id,
                due_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
              };
              tasks.push(task); newTasks.push(task);
            }
          }
        }
      }

      commit({ ...prev, runs, tasks });
      const o = orgIdRef.current;
      if (o) {
        if (newRuns.length) persist(sb.from('automation_runs').insert(newRuns.map((r) => ({ ...r, org_id: o }))), 'runAutomationTick:runs');
        if (newTasks.length) persist(sb.from('tasks').insert(newTasks.map((t) => ({ ...t, org_id: o }))), 'runAutomationTick:tasks');
      }
      return newRuns.length + newTasks.length;
    },

    approveRun(id: string) {
      const prev = dbRef.current;
      const run = prev.runs.find((r) => r.id === id);
      if (!run) return;
      const executed_at = new Date().toISOString();
      let entities = prev.entities;
      let interactions = prev.interactions;
      let newInteraction: Interaction | null = null;
      let entityPatch: Partial<Entity> | null = null;

      const auto = prev.automations.find((a) => a.id === run.automation_id);
      if (auto?.action === 'draft_follow_up' && run.entity_id && run.payload.draft) {
        newInteraction = {
          id: uuid(), entity_id: run.entity_id, person_id: run.person_id,
          occurred_at: executed_at, direction: 'out',
          channel: run.payload.channel ?? 'email', content: run.payload.draft,
          sent_from: prev.org.sender_email, automation_run_id: run.id,
          classification: 'awaiting',
        };
        interactions = [...interactions, newInteraction];
        entityPatch = { contact_lock_until: new Date(Date.now() + LOCK_DAYS * 24 * 3600 * 1000).toISOString() };
        entities = entities.map((e) => e.id === run.entity_id ? { ...e, ...entityPatch } : e);
      }
      if (auto?.action === 'propose_dormant' && run.entity_id) {
        entityPatch = { status: 'dormant', dormant_since: executed_at, dormant_reason: 'No reply after follow-up (stop rule).' };
        entities = entities.map((e) => e.id === run.entity_id ? { ...e, ...entityPatch } : e);
      }

      commit({
        ...prev, entities, interactions,
        runs: prev.runs.map((r) => r.id === id ? { ...r, status: 'executed', executed_at } : r),
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('automation_runs').update({ status: 'executed', executed_at }).eq('id', id), 'approveRun:run');
        if (newInteraction) persist(sb.from('interactions').insert({ ...newInteraction, org_id: o }), 'approveRun:interaction');
        if (entityPatch && run.entity_id) persist(sb.from('entities').update(entityPatch).eq('id', run.entity_id), 'approveRun:entity');
      }
    },

    rejectRun(id: string) {
      const prev = dbRef.current;
      commit({ ...prev, runs: prev.runs.map((r) => r.id === id ? { ...r, status: 'rejected' } : r) });
      if (orgIdRef.current) persist(sb.from('automation_runs').update({ status: 'rejected' }).eq('id', id), 'rejectRun');
    },

    updateRunDraft(id: string, draft: string) {
      const prev = dbRef.current;
      const run = prev.runs.find((r) => r.id === id);
      const payload = { ...run?.payload, draft };
      commit({ ...prev, runs: prev.runs.map((r) => r.id === id ? { ...r, payload } : r) });
      if (orgIdRef.current) persist(sb.from('automation_runs').update({ payload }).eq('id', id), 'updateRunDraft');
    },

    resetDemo() {
      // No localStorage in this backend — "reset" re-syncs from the server instead.
      void refetch();
    },

    async unlockPack(packId: string) {
      const prev = dbRef.current;
      const pack = prev.packs.find((p) => p.id === packId);
      if (!pack || prev.unlocks.some((u) => u.pack_id === packId)) return 0;
      const o = orgIdRef.current;
      if (!o) return 0;

      // Prompt 139 D3 — pack_items/pack.catalog_ids no longer decide what's
      // delivered (kept on disk, inert, for easy rollback); catalog_top_matches
      // does. p_limit is computed here, not inside the function, from a LIVE
      // read (never the cached client state) of the org's quota — an
      // accumulated ceiling that's never lowered (plan-sync.ts), not a
      // "remaining" counter — minus how many catalog entities this org
      // already has, so a second call (once multi-wave exists) still
      // computes correctly instead of assuming today's guard is the only
      // thing preventing a second unlock.
      //
      // Prompt 181 §3 — reads the quota via the catalog_effective_quota()
      // RPC, not a plain `.from('orgs').select('catalog_quota')`: that RPC
      // carries the is_ablute_developer() bypass (migration 0166,
      // effectively unlimited for a confirmed @ablute.pt caller), and a
      // direct table read would silently keep reading the real, small
      // stored value regardless of who's calling — the bypass would only
      // ever affect RLS *visibility* of rows already delivered, never how
      // many unlockPack is willing to insert in the first place. NOT
      // plan_catalog_quota() itself — that RPC has no is_org_member check
      // of its own and had its EXECUTE grant deliberately revoked from
      // `authenticated` in migration 0134 (a real RLS-bypass data leak,
      // confirmed exploitable with just the publishable key) —
      // catalog_effective_quota() is the properly org-scoped, safe-to-call
      // sibling added alongside it.
      // Only non-exempt rows count against quota, and this must stay in
      // lockstep with the DB-side guard: trg_catalog_deliveries_enforce_quota
      // filters on `not quota_exempt` since migration 0171. Quota is the
      // budget of investors *introduced to the founder* — unlockPack and the
      // monthly delivery both spend it; only an investor's own organic
      // interest (matchdeal_record_interest_notification, which inserts
      // quota_exempt=true) doesn't, since the founder never chose to spend
      // there. Counting exempt rows here would show "no quota left" to an org
      // that has consumed none: ablute_ has 525 rows against quota=40, 524 of
      // them exempt (a 2026-07-27 bulk seed plus interest notifications).
      // Do NOT go back to filtering on via_pack — 0170 tried that and 0171
      // undid it; via_pack means "which pack did this come from", nothing
      // about quota, and the monthly delivery has no pack.
      const [{ data: quotaData }, { count: deliveredCount }] = await Promise.all([
        sb.rpc('catalog_effective_quota', { check_org: o }),
        sb.from('catalog_deliveries').select('catalog_id', { count: 'exact', head: true }).eq('org_id', o).eq('quota_exempt', false),
      ]);
      const quota = typeof quotaData === 'number' ? quotaData : 0;
      const pLimit = Math.max(0, quota - (deliveredCount ?? 0));
      if (pLimit === 0) return 0;

      const { data: matches, error: matchErr } = await sb.rpc('catalog_top_matches', { p_org_id: o, p_limit: pLimit });
      if (matchErr || !matches?.length) return 0;

      const catalogIds = (matches as { catalog_id: string; score: number }[]).map((m) => m.catalog_id);
      const { data: catalogRows } = await sb.from('catalog_entities').select('*').in('id', catalogIds);
      const scoreById = new Map((matches as { catalog_id: string; score: number }[]).map((m) => [m.catalog_id, m.score]));

      const ownedNames = new Set(prev.entities.map((e) => e.name.toLowerCase()));
      const newEntities: Entity[] = [];
      const deliveredIds: string[] = [];
      for (const row of (catalogRows ?? []) as Record<string, unknown>[]) {
        const c = fromRow<CatalogEntity>(row);
        if (ownedNames.has(c.name.toLowerCase())) continue;
        // Prompt 285 §3 — same guard as deliverMonthlyForOrg(): a
        // suspended/deleted catalog entity must not reach a new org via
        // manual pack unlock either.
        if (c.moderation_status && c.moderation_status !== 'active') continue;
        deliveredIds.push(c.id);
        newEntities.push({
          id: uuid(), name: c.name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
          invests_in_geographies: [], website: c.website, website_verified: true,
          email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
          check_min_eur: c.check_min_eur, check_max_eur: c.check_max_eur,
          sectors: c.sectors, thesis: c.thesis, fit_score: fitBucketFromScore(scoreById.get(c.id) ?? 0), wave: 1,
          submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
          status: 'not_contacted', source: 'catalog',
        });
      }

      const unlockId = uuid();
      const unlockedAt = new Date().toISOString();
      commit({
        ...prev,
        entities: [...prev.entities, ...newEntities],
        unlocks: [...prev.unlocks, { id: unlockId, pack_id: packId, unlocked_at: unlockedAt, delivered_catalog_ids: deliveredIds }],
      });

      if (newEntities.length) persist(sb.from('entities').insert(newEntities.map((e) => ({ ...e, org_id: o }))), 'unlockPack:entities');
      persist(sb.from('pack_unlocks').insert({ id: unlockId, org_id: o, pack_id: packId, unlocked_at: unlockedAt }), 'unlockPack:pack_unlocks');
      if (deliveredIds.length) {
        persist(sb.from('catalog_deliveries').insert(deliveredIds.map((cid, i) => ({
          org_id: o, catalog_id: cid, entity_id: newEntities[i]?.id, via_pack: packId,
        }))), 'unlockPack:catalog_deliveries');
        triggerEnrichmentEnqueue(deliveredIds);
      }
      return newEntities.length;
    },

    submitInvestor(payload: InvestorSubmission['payload']) {
      const prev = dbRef.current;
      const entity: Entity = {
        id: uuid(), name: payload.name, type: payload.type,
        hq_city: payload.hq_city, hq_country: payload.hq_country,
        invests_in_geographies: [], website: payload.website, website_verified: false,
        email_domain_verified: false, sectors: payload.sectors,
        submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
        status: 'not_contacted', fit_score: 'medium', wave: 3, source: 'manual',
      };
      const submission: InvestorSubmission = {
        id: uuid(), payload, submitted_by: prev.org.name,
        status: 'pending_review', created_at: new Date().toISOString(),
      };
      commit({ ...prev, entities: [...prev.entities, entity], submissions: [...prev.submissions, submission] });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('entities').insert({ ...entity, org_id: o }), 'submitInvestor:entity');
        persist(sb.from('investor_submissions').insert({
          id: submission.id, org_id: o, payload: submission.payload,
          status: submission.status, created_at: submission.created_at,
        }), 'submitInvestor:submission');
      }
    },

    reviewSubmission(id: string, decision: 'approved' | 'rejected', notes?: string) {
      const prev = dbRef.current;
      const sub = prev.submissions.find((s) => s.id === id);
      if (!sub) return;
      const reviewed_at = new Date().toISOString();

      let catalog = prev.catalog;
      let mergedCatalogId: string | null = null;
      if (decision === 'approved') {
        const existing = prev.catalog.find((c) => c.name.toLowerCase() === sub.payload.name.toLowerCase());
        if (existing) {
          mergedCatalogId = existing.id;
          catalog = prev.catalog.map((c) => c.id === existing.id ? { ...c, verification_status: 'verified', verified_at: reviewed_at } : c);
        } else {
          const newCatalog: CatalogEntity = {
            id: uuid(), name: sub.payload.name, type: sub.payload.type,
            hq_city: sub.payload.hq_city, hq_country: sub.payload.hq_country,
            sectors: sub.payload.sectors, website: sub.payload.website,
            verification_status: 'verified', verified_at: reviewed_at,
            source: 'user_submission', notes,
          };
          mergedCatalogId = newCatalog.id;
          catalog = [...prev.catalog, newCatalog];
        }
      } else {
        catalog = prev.catalog.map((c) =>
          c.name.toLowerCase() === sub.payload.name.toLowerCase() && c.verification_status === 'pending'
            ? { ...c, verification_status: 'rejected', notes } : c);
      }

      commit({
        ...prev, catalog,
        submissions: prev.submissions.map((s) => s.id === id
          ? { ...s, status: decision === 'approved' ? 'merged' : 'rejected', reviewer_notes: notes, reviewed_at }
          : s),
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('investor_submissions').update({
          status: decision === 'approved' ? 'merged' : 'rejected',
          reviewer_notes: notes ?? null, reviewed_at, merged_catalog_id: mergedCatalogId,
        }).eq('id', id), 'reviewSubmission:submission');
      }
      if (decision === 'approved') {
        const existing = prev.catalog.find((c) => c.name.toLowerCase() === sub.payload.name.toLowerCase());
        if (existing) {
          persist(sb.from('catalog_entities').update({ verification_status: 'verified', verified_at: reviewed_at }).eq('id', existing.id), 'reviewSubmission:catalog_update');
        } else {
          const created = catalog[catalog.length - 1];
          persist(sb.from('catalog_entities').insert({
            id: created.id, name: created.name, type: created.type, hq_city: created.hq_city, hq_country: created.hq_country,
            sectors: created.sectors, website: created.website, verification_status: 'verified',
            verified_at: reviewed_at, source: 'user_submission', notes: notes ?? null,
          }), 'reviewSubmission:catalog_insert');
        }
      } else {
        persist(sb.from('catalog_entities')
          .update({ verification_status: 'rejected', notes: notes ?? null })
          .eq('verification_status', 'pending')
          .ilike('name', sub.payload.name), 'reviewSubmission:catalog_reject');
      }
    },

    undoStageChange(entityId: string, previousStage: RelationshipStage | undefined, milestoneId: string) {
      const prev = dbRef.current;
      const relationshipState = previousStage
        ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, stage: previousStage } : r)
        : prev.relationshipState.filter((r) => r.entity_id !== entityId);
      commit({
        ...prev,
        relationshipState,
        interactions: prev.interactions.filter((i) => i.id !== milestoneId),
      });
      const o = orgIdRef.current;
      if (o) {
        // So esta linha, por id. Nunca "a ultima stage_change da entidade".
        persist(sb.from('interactions').delete().eq('id', milestoneId), 'undoStageChange:milestone');
        if (previousStage) {
          persist(sb.from('relationship_state').upsert(
            { org_id: o, entity_id: entityId, stage: previousStage, updated_at: new Date().toISOString() },
            { onConflict: 'org_id,entity_id' },
          ), 'undoStageChange:state');
        } else {
          // Nao havia linha antes: desfazer e voltar a nao haver.
          persist(sb.from('relationship_state').delete().eq('org_id', o).eq('entity_id', entityId), 'undoStageChange:state');
        }
      }
    },

    setRelationshipStage(entityId: string, stage: RelationshipStage) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      const existing = prev.relationshipState.find((r) => r.entity_id === entityId);
      const relationshipState = existing
        ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, stage, updated_at: now } : r)
        : [...prev.relationshipState, { entity_id: entityId, stage, updated_at: now }];
      const milestone: Interaction = {
        id: uuid(), entity_id: entityId, occurred_at: now, direction: 'out',
        channel: 'stage_change', content: `Stage changed to ${STAGE_LABEL[stage]}.`,
      };
      commit({ ...prev, relationshipState, interactions: [...prev.interactions, milestone] });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('relationship_state').upsert(
          { org_id: o, entity_id: entityId, stage, updated_at: now }, { onConflict: 'org_id,entity_id' },
        ), 'setRelationshipStage:state');
        persist(sb.from('interactions').insert({ ...milestone, org_id: o }), 'setRelationshipStage:milestone');
      }
      return milestone.id;
    },

    setNextStepTask(entityId: string, taskId: string | undefined) {
      const prev = dbRef.current;
      const now = new Date().toISOString();
      const stage = getStage(prev, entityId);
      const existing = prev.relationshipState.find((r) => r.entity_id === entityId);
      const relationshipState = existing
        ? prev.relationshipState.map((r) => r.entity_id === entityId ? { ...r, next_step_task_id: taskId, updated_at: now } : r)
        : [...prev.relationshipState, { entity_id: entityId, stage, next_step_task_id: taskId, updated_at: now }];
      commit({ ...prev, relationshipState });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('relationship_state').upsert(
          { org_id: o, entity_id: entityId, stage, next_step_task_id: taskId ?? null, updated_at: now }, { onConflict: 'org_id,entity_id' },
        ), 'setNextStepTask');
      }
    },

    addAffiliation(a: Omit<PersonAffiliation, 'id' | 'current'>) {
      const prev = dbRef.current;
      const row: PersonAffiliation = { ...a, id: uuid(), current: true };
      commit({ ...prev, personAffiliations: [...prev.personAffiliations, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('person_affiliations').insert({ ...row, org_id: o }), 'addAffiliation');
    },

    endAffiliation(id: string) {
      const prev = dbRef.current;
      const ended_at = new Date().toISOString().slice(0, 10);
      commit({
        ...prev,
        personAffiliations: prev.personAffiliations.map((pa) => pa.id === id ? { ...pa, current: false, ended_at } : pa),
      });
      if (orgIdRef.current) persist(sb.from('person_affiliations').update({ current: false, ended_at }).eq('id', id), 'endAffiliation');
    },

    // Prompt 346 §A/C — "an investor's interest can never look lost". This
    // is the SAME refetch() this file already calls internally after
    // reawakening proposals land — never a parallel load path. Public now
    // so any surface that just learned about a server-side arrival
    // (investor interest, an automations task, a catalog delivery, …) can
    // pull the store forward without waiting for the next F5.
    refreshFromServer: refetch,

    // Prompt 415 §1 — same upsert-by-natural-key shape as setNextStepTask
    // above, keyed by (kind, whichever of the 4 id fields `key` sets)
    // instead of entity_id. onConflict targets migration 0261's own
    // candidate_key generated column (a single ordinary unique constraint
    // coalescing the 4 possible id columns) rather than one of the id
    // columns directly — PostgREST's onConflict param can't target a
    // partial index, which any one of those 4 columns alone would need
    // to be (nullable, only one populated per row).
    snoozeSherlockClue(kind: string, key: { task_id?: string; entity_id?: string; interaction_id?: string; person_id?: string }, snoozedUntil: string) {
      const prev = dbRef.current;
      const matches = (s: SherlockNextSnooze) => s.kind === kind
        && s.task_id === key.task_id && s.entity_id === key.entity_id
        && s.interaction_id === key.interaction_id && s.person_id === key.person_id;
      const existing = prev.sherlockNextSnoozes.find(matches);
      const row: SherlockNextSnooze = existing
        ? { ...existing, snoozed_until: snoozedUntil }
        : { id: uuid(), kind, ...key, snoozed_until: snoozedUntil };
      const sherlockNextSnoozes = existing
        ? prev.sherlockNextSnoozes.map((s) => matches(s) ? row : s)
        : [...prev.sherlockNextSnoozes, row];
      commit({ ...prev, sherlockNextSnoozes });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('sherlock_next_snoozes').upsert(
          { org_id: o, kind, task_id: key.task_id ?? null, entity_id: key.entity_id ?? null, interaction_id: key.interaction_id ?? null, person_id: key.person_id ?? null, snoozed_until: snoozedUntil },
          { onConflict: 'org_id,kind,candidate_key' },
        ), 'snoozeSherlockClue');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
