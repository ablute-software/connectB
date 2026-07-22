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
  AccessGrant, Automation, AutomationRun, CatalogEntity, Classification, Db, DocumentItem,
  DocumentView, Entity, EntityStatus, Folder, Interaction, InvestorSubmission, MessageTemplate,
  Org, Pack, PackUnlock, PassReasonCategory, Person, PersonAffiliation, RelationshipStage,
  RelationshipState, RuleOverride, TaskItem, AiReview,
} from './types';
import { LOCK_DAYS, outboundsAwaitingFollowUp, fillTemplate } from './rules';
import { STAGE_LABEL, getStage } from './relationship';

type SB = ReturnType<typeof browserClient>;

const EMPTY_ORG: Org = { id: '', name: '', plan: 'free', daily_cap: 5, weekly_cap: 20 };
const EMPTY_DB: Db = {
  org: EMPTY_ORG, entities: [], people: [], personAffiliations: [], interactions: [], tasks: [], relationshipState: [], overrides: [],
  folders: [], documents: [], grants: [], views: [], templates: [], automations: [],
  runs: [], aiReviews: [], catalog: [], packs: [], unlocks: [], submissions: [],
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

async function loadAll(sb: SB, orgId: string): Promise<Db> {
  const [
    orgRes, entitiesRes, peopleRes, interactionsRes, tasksRes, overridesRes,
    foldersRes, documentsRes, grantsRes, viewsRes, templatesRes, automationsRes,
    runsRes, aiReviewsRes, catalogRes, packsRes, packItemsRes, unlocksRes,
    deliveriesRes, submissionsRes, relationshipStateRes, personAffiliationsRes,
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
  };
}

export function SupabaseStoreProvider({ children }: { children: React.ReactNode }) {
  const sbRef = useRef<SB | null>(null);
  if (!sbRef.current) sbRef.current = browserClient();
  const sb = sbRef.current;

  const dbRef = useRef<Db>(EMPTY_DB);
  const orgIdRef = useRef<string | null>(null);
  const [version, bump] = useReducer((x: number) => x + 1, 0);

  function commit(next: Db) {
    dbRef.current = next;
    bump();
  }

  async function refetch() {
    const oid = orgIdRef.current;
    if (!oid) return;
    try { commit(await loadAll(sb, oid)); } catch (err) { console.error('[supabase-store] refetch failed', err); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (cancelled) return;
      if (!user) { commit(EMPTY_DB); return; }
      const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
      const oid = (member as { org_id: string } | null)?.org_id ?? null;
      orgIdRef.current = oid;
      if (!oid) { commit(EMPTY_DB); return; }
      try {
        const loaded = await loadAll(sb, oid);
        if (!cancelled) commit(loaded);
      } catch (err) {
        console.error('[supabase-store] initial load failed', err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<StoreApi>(() => ({
    db: dbRef.current,

    logInteraction(input: LogInput) {
      const prev = dbRef.current;
      const interaction: Interaction = { id: uuid(), occurred_at: new Date().toISOString(), ...input };
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
        const person = prev.people.find((p) => p.id === input.person_id);
        const entity = prev.entities.find((e) => e.id === input.entity_id);
        const newStatus: EntityStatus | undefined = entity && entity.status === 'not_contacted' ? 'contacted' : undefined;
        entityPatch = { contact_lock_until: lockUntil, ...(newStatus ? { status: newStatus } : {}) };
        entities = entities.map((e) => e.id === input.entity_id ? { ...e, ...entityPatch } : e);
        newTaskRows.push({
          id: uuid(), kind: 'follow_up', action_type: 'follow_up_no_reply', done: false, due_at: lockUntil,
          title: `Follow up ${person?.full_name ?? ''} (${entity?.name ?? ''})`.trim(),
          entity_id: input.entity_id, person_id: input.person_id,
        });
      } else if (input.classification && ['interested', 'meeting_request', 'question'].includes(input.classification)) {
        const entity = prev.entities.find((e) => e.id === input.entity_id);
        if (entity && ['not_contacted', 'contacted'].includes(entity.status)) {
          entityPatch = { status: 'in_conversation' };
          entities = entities.map((e) => e.id === input.entity_id ? { ...e, ...entityPatch } : e);
        }
      }

      // The founder's own explicit next step (Log Interaction's "Next
      // action" fields) becomes a real, visible Agenda task — separate
      // from the automatic 14-day lock-reminder above.
      if (input.next_action) {
        newTaskRows.push({
          id: uuid(), kind: 'follow_up', action_type: input.next_action_type ?? 'other', done: false,
          due_at: input.next_action_due ? `${input.next_action_due}T12:00:00Z` : undefined,
          title: input.next_action, entity_id: input.entity_id, person_id: input.person_id,
        });
      }
      tasks = [...tasks, ...newTaskRows];

      commit({
        ...prev, entities, tasks,
        interactions: [...prev.interactions, interaction],
        overrides: [...prev.overrides, ...overrideRows],
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('interactions').insert({ ...interaction, org_id: o }), 'logInteraction:interaction');
        if (overrideRows.length) persist(sb.from('rule_overrides').insert(overrideRows.map((r) => ({ ...r, org_id: o }))), 'logInteraction:overrides');
        if (newTaskRows.length) persist(sb.from('tasks').insert(newTaskRows.map((t) => ({ ...t, org_id: o }))), 'logInteraction:task');
        if (entityPatch) persist(sb.from('entities').update(entityPatch).eq('id', input.entity_id), 'logInteraction:entity');
      }
      return interaction;
    },

    classifyInteraction(id: string, c: Classification, cat?: PassReasonCategory, reason?: string) {
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
        interactions: prev.interactions.map((i) => i.id === id ? { ...i, classification: c, pass_reason_category: cat, pass_reason: reason } : i),
      });

      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('interactions').update({ classification: c, pass_reason_category: cat ?? null, pass_reason: reason ?? null }).eq('id', id), 'classifyInteraction:interaction');
        if (entityPatch && it) persist(sb.from('entities').update(entityPatch).eq('id', it.entity_id), 'classifyInteraction:entity');
        if (newBounceCount !== null && it?.person_id) persist(sb.from('people').update({ bounce_count: newBounceCount }).eq('id', it.person_id), 'classifyInteraction:person');
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

    setEntityStatus(id: string, status: EntityStatus, reason?: string) {
      const prev = dbRef.current;
      commit({
        ...prev,
        entities: prev.entities.map((e) => e.id === id
          ? {
              ...e, status,
              dormant_since: status === 'dormant' ? new Date().toISOString() : e.dormant_since,
              dormant_reason: status === 'dormant' ? reason ?? e.dormant_reason : e.dormant_reason,
            }
          : e),
      });
      if (orgIdRef.current) {
        const patch: Record<string, unknown> = { status };
        if (status === 'dormant') {
          patch.dormant_since = new Date().toISOString();
          if (reason !== undefined) patch.dormant_reason = reason;
        }
        persist(sb.from('entities').update(patch).eq('id', id), 'setEntityStatus');
      }
    },

    setInterest(id: string, eur: number | undefined) {
      const prev = dbRef.current;
      commit({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, interest_eur: eur } : e) });
      if (orgIdRef.current) persist(sb.from('entities').update({ interest_eur: eur ?? null }).eq('id', id), 'setInterest');
    },

    resolveHardFilter(id: string, status: 'resolved_ok' | 'resolved_blocked') {
      const prev = dbRef.current;
      commit({ ...prev, entities: prev.entities.map((e) => e.id === id ? { ...e, hard_filter_status: status } : e) });
      if (orgIdRef.current) persist(sb.from('entities').update({ hard_filter_status: status }).eq('id', id), 'resolveHardFilter');
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
      if (d.external_url && d.external_url.includes('/edit')) {
        throw new Error('Editable link rejected — only view-only links can be stored.');
      }
      const prev = dbRef.current;
      const row: DocumentItem = { ...d, id: uuid() };
      commit({ ...prev, documents: [...prev.documents, row] });
      const o = orgIdRef.current;
      if (o) persist(sb.from('documents').insert({ ...row, org_id: o }), 'addDocument');
    },

    addGrant(g: Omit<AccessGrant, 'id' | 'granted_at'>) {
      const prev = dbRef.current;
      const grant: AccessGrant = { ...g, id: uuid(), granted_at: new Date().toISOString() };
      const auto = prev.automations.find((a) => a.trigger === 'grant_activated' && a.enabled);
      let run: AutomationRun | null = null;
      if (auto) {
        const person = prev.people.find((p) => p.id === g.person_id);
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
      commit({ ...prev, grants: [...prev.grants, grant], runs: run ? [...prev.runs, run] : prev.runs });
      const o = orgIdRef.current;
      if (o) {
        persist(sb.from('access_grants').insert({ ...grant, org_id: o }), 'addGrant:grant');
        if (run) persist(sb.from('automation_runs').insert({ ...run, org_id: o }), 'addGrant:run');
      }
    },

    revokeGrant(id: string) {
      const prev = dbRef.current;
      const revoked_at = new Date().toISOString();
      commit({ ...prev, grants: prev.grants.map((g) => g.id === id ? { ...g, revoked_at } : g) });
      if (orgIdRef.current) persist(sb.from('access_grants').update({ revoked_at }).eq('id', id), 'revokeGrant');
    },

    recordDemoView(documentId: string, viewerEmail: string) {
      const o = orgIdRef.current;
      if (!o) return; // investor portal with no resolved org — safe no-op (Phase 4 wires real per-grant access)
      const prev = dbRef.current;
      const row: DocumentView = {
        id: uuid(), document_id: documentId, viewer_email: viewerEmail,
        viewed_at: new Date().toISOString(), seconds: 60 + Math.floor(Math.random() * 400),
      };
      commit({ ...prev, views: [...prev.views, row] });
      persist(sb.from('document_views').insert({ ...row, org_id: o }), 'recordDemoView');
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

    unlockPack(packId: string) {
      const prev = dbRef.current;
      const pack = prev.packs.find((p) => p.id === packId);
      if (!pack || prev.unlocks.some((u) => u.pack_id === packId)) return 0;

      const alreadyDelivered = new Set(prev.unlocks.flatMap((u) => u.delivered_catalog_ids));
      const ownedNames = new Set(prev.entities.map((e) => e.name.toLowerCase()));
      const newEntities: Entity[] = [];
      const deliveredIds: string[] = [];
      for (const cid of pack.catalog_ids) {
        const c = prev.catalog.find((x) => x.id === cid);
        if (!c || c.verification_status !== 'verified') continue;
        if (alreadyDelivered.has(cid) || ownedNames.has(c.name.toLowerCase())) continue;
        deliveredIds.push(cid);
        newEntities.push({
          id: uuid(), name: c.name, type: c.type, hq_city: c.hq_city, hq_country: c.hq_country,
          invests_in_geographies: [], website: c.website, website_verified: true,
          email_domain_verified: false, stage_min: c.stage_min, stage_max: c.stage_max,
          check_min_eur: c.check_min_eur, check_max_eur: c.check_max_eur,
          sectors: c.sectors, thesis: c.thesis, fit_score: 'medium', wave: 3,
          submission_channel_type: 'unknown', hard_filter_status: 'not_applicable',
          status: 'not_contacted',
        });
      }

      const unlockId = uuid();
      const unlockedAt = new Date().toISOString();
      commit({
        ...prev,
        entities: [...prev.entities, ...newEntities],
        unlocks: [...prev.unlocks, { id: unlockId, pack_id: packId, unlocked_at: unlockedAt, delivered_catalog_ids: deliveredIds }],
      });

      const o = orgIdRef.current;
      if (o) {
        if (newEntities.length) persist(sb.from('entities').insert(newEntities.map((e) => ({ ...e, org_id: o }))), 'unlockPack:entities');
        persist(sb.from('pack_unlocks').insert({ id: unlockId, org_id: o, pack_id: packId, unlocked_at: unlockedAt }), 'unlockPack:pack_unlocks');
        if (deliveredIds.length) {
          persist(sb.from('catalog_deliveries').insert(deliveredIds.map((cid, i) => ({
            org_id: o, catalog_id: cid, entity_id: newEntities[i]?.id, via_pack: packId,
          }))), 'unlockPack:catalog_deliveries');
        }
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
        status: 'not_contacted', fit_score: 'medium', wave: 3,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [version]);

  return <StoreCtx.Provider value={api}>{children}</StoreCtx.Provider>;
}
