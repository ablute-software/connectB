// Prompt 922 (I2) — who evaluates what, against the database: gathers the facts of ONE call (the team members who may "Evaluate assigned applications", the Fit applications, what is assigned, the conflicts),
// asks the pure module (eval-distribution.ts) what to change, applies it, records every conflict and every move, and tells the evaluators. Nothing here reads another call.
//
// Modes (call_eval_settings.distribution_mode):
//   auto    the platform does everything: a new Fit application is distributed by itself, a conflict is removed and redistributed, the administrator only looks at the screen.
//   mixed   the same, and the administrator can also assign and remove by hand (an assignment made by hand is kept: only a conflict removes it).
//   manual  the platform assigns nothing: the administrator does (a conflict still removes the pair, and the screen says the application is short).
// An assignment whose evaluation was already started is never moved by a plan: it is reported ("kept with a conflict") for a person to decide.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emailNotice, createNotice, type NoticeContent } from './applicant/notices';
import { CONFLICT_TEXT, autoConflict, loadsOf, redistribute, distribute, type ConflictCode, type Pair } from './eval-distribution';
import { loadSettings } from './eval-grid-store';
import { effectivePermissions } from './permissions';
import { callOrg, describePeople, loadCallTeam, loadCategories, loadConflicts as loadCompanyConflicts } from './team-store';
import type { Call } from './types';

type Row = Record<string, unknown>;
export type DistributionMode = 'auto' | 'manual' | 'mixed';

export interface EvaluatorInfo { userId: string; name: string | null; email: string | null }
export interface AppInfo { applicationId: string; reference: string | null; startupOrgId: string | null; startupName: string | null; applicantUserId: string }
export interface Blocked { applicationId: string; userId: string; code: ConflictCode | 'declared' | 'declared_company'; text: string; kind: 'auto' | 'declared'; note: string | null; createdAt: string | null }
export interface AssignmentRow { applicationId: string; userId: string; source: 'auto' | 'manual'; createdAt: string }
export interface Gathered {
  call: Call; mode: DistributionMode; n: number | 'all';
  evaluators: EvaluatorInfo[]; apps: AppInfo[]; assignments: AssignmentRow[]; blocked: Blocked[];
  /** Pairs (application:user) with an evaluation already started: never moved by a plan. */
  started: Set<string>;
}
export const pairKey = (applicationId: string, userId: string): string => `${applicationId}:${userId}`;
const COMPANY_CONFLICT_TEXT = 'declared, before the call, a conflict with this company';

// --- Mode ------------------------------------------------------------------------------------------------------------------------------------------------

export async function loadMode(admin: SupabaseClient, callId: string): Promise<DistributionMode> {
  const { data } = await admin.from('call_eval_settings').select('distribution_mode').eq('call_id', callId).maybeSingle();
  const m = (data as Row | null)?.distribution_mode;
  return m === 'manual' || m === 'mixed' ? m : 'auto';
}
export async function saveMode(admin: SupabaseClient, callId: string, mode: DistributionMode, actor: string): Promise<void> {
  const { data } = await admin.from('call_eval_settings').select('call_id').eq('call_id', callId).maybeSingle();
  const patch = { distribution_mode: mode, updated_by: actor, updated_at: new Date().toISOString() };
  const r = data ? await admin.from('call_eval_settings').update(patch).eq('call_id', callId) : await admin.from('call_eval_settings').insert({ call_id: callId, ...patch });
  if (r.error) throw new Error(`Could not save the distribution mode: ${r.error.message}`);
}

// --- Gathering -------------------------------------------------------------------------------------------------------------------------------------------

async function emailOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  try { const { data } = await admin.auth.admin.getUserById(userId); return data?.user?.email?.toLowerCase() ?? null; } catch { return null; }
}

/** The team members with the permission "Evaluate assigned applications" (the category's, with the person's own adjustments on top). */
export async function loadEvaluators(admin: SupabaseClient, call: Call): Promise<EvaluatorInfo[]> {
  const [members, categories] = await Promise.all([loadCallTeam(admin, call.id), loadCategories(admin, callOrg(call))]);
  const byCat = new Map(categories.map((c) => [c.id, c]));
  const ids = members.filter((m) => { const c = byCat.get(m.categoryId); return !!c && effectivePermissions(c.permissions, m.overrides).evaluate_assigned; }).map((m) => m.userId);
  const people = await describePeople(admin, callOrg(call), ids);
  const out: EvaluatorInfo[] = [];
  for (const id of ids) {
    const p = people.get(id);
    out.push({ userId: id, name: p?.name ?? null, email: p?.email ?? (await emailOf(admin, id)) });
  }
  return out;
}

/** Applications that are SUBMITTED and whose current eligibility is Fit — the only ones that enter evaluation (To validate must be resolved first; Not a fit is not distributed). */
export async function loadFitApplications(admin: SupabaseClient, callId: string): Promise<AppInfo[]> {
  const { data: apps } = await admin.from('call_applications').select('id, reference, startup_org_id, applicant_user_id, status').eq('call_id', callId).eq('status', 'submitted');
  const rows = (apps ?? []) as Row[];
  if (rows.length === 0) return [];
  const { data: elig } = await admin.from('call_application_eligibility').select('application_id, status').eq('call_id', callId).eq('is_current', true);
  const fit = new Set(((elig ?? []) as Row[]).filter((e) => e.status === 'fit').map((e) => e.application_id as string));
  const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (orgIds.length) { const { data: orgs } = await admin.from('orgs').select('id, name').in('id', orgIds); for (const o of (orgs ?? []) as Row[]) names.set(o.id as string, String(o.name ?? '')); }
  return rows.filter((r) => fit.has(r.id as string))
    .map((r) => ({ applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startupOrgId: (r.startup_org_id as string | null) ?? null, startupName: r.startup_org_id ? names.get(r.startup_org_id as string) ?? null : null, applicantUserId: r.applicant_user_id as string }))
    .sort((a, b) => (a.reference ?? a.applicationId) < (b.reference ?? b.applicationId) ? -1 : 1);
}

export async function loadAssignments(admin: SupabaseClient, callId: string): Promise<AssignmentRow[]> {
  const { data } = await admin.from('call_eval_assignments').select('application_id, evaluator_user_id, source, created_at').eq('call_id', callId).eq('status', 'assigned');
  return ((data ?? []) as Row[]).map((r) => ({ applicationId: r.application_id as string, userId: r.evaluator_user_id as string, source: r.source === 'manual' ? 'manual' : 'auto', createdAt: String(r.created_at ?? '') }));
}

/** The facts an automatic conflict is decided from, for one application: the people of the startup, their emails, and everybody who applied for that startup in this call. */
async function factsOf(admin: SupabaseClient, callId: string, app: AppInfo, cache: Map<string, { memberUserIds: string[]; memberEmails: string[]; applicantUserIds: string[] }>) {
  const key = app.startupOrgId ?? `app:${app.applicationId}`;
  const hit = cache.get(key);
  if (hit) return { applicationId: app.applicationId, startupOrgId: app.startupOrgId, ...hit };
  const members = new Set<string>([app.applicantUserId]);
  const applicants = new Set<string>([app.applicantUserId]);
  if (app.startupOrgId) {
    const { data: m } = await admin.from('org_members').select('user_id').eq('org_id', app.startupOrgId);
    for (const r of (m ?? []) as Row[]) if (r.user_id) members.add(r.user_id as string);
    const { data: same } = await admin.from('call_applications').select('applicant_user_id').eq('call_id', callId).eq('startup_org_id', app.startupOrgId);
    for (const r of (same ?? []) as Row[]) if (r.applicant_user_id) applicants.add(r.applicant_user_id as string);
  }
  const memberEmails: string[] = [];
  for (const u of members) { const e = await emailOf(admin, u); if (e) memberEmails.push(e); }
  const facts = { memberUserIds: [...members], memberEmails, applicantUserIds: [...applicants] };
  cache.set(key, facts);
  return { applicationId: app.applicationId, startupOrgId: app.startupOrgId, ...facts };
}

export async function gather(admin: SupabaseClient, call: Call): Promise<Gathered> {
  const [settings, mode, evaluators, apps, assignments, declaredRes, company, evals] = await Promise.all([
    loadSettings(admin, call.id), loadMode(admin, call.id), loadEvaluators(admin, call), loadFitApplications(admin, call.id), loadAssignments(admin, call.id),
    admin.from('call_eval_conflicts').select('application_id, evaluator_user_id, kind, code, note, created_at').eq('call_id', call.id),
    loadCompanyConflicts(admin, call.id), admin.from('call_evaluations').select('application_id, evaluator_user_id').eq('call_id', call.id),
  ]);
  const blocked: Blocked[] = [];
  const seen = new Set<string>();
  const add = (b: Blocked) => { const k = `${pairKey(b.applicationId, b.userId)}:${b.kind}`; if (!seen.has(k)) { seen.add(k); blocked.push(b); } };
  for (const r of (declaredRes.data ?? []) as Row[]) {
    if (!r.application_id) continue;
    const code = String(r.code);
    add({ applicationId: r.application_id as string, userId: r.evaluator_user_id as string, code: (code in CONFLICT_TEXT ? code : 'declared') as Blocked['code'], text: CONFLICT_TEXT[(code in CONFLICT_TEXT ? code : 'declared') as keyof typeof CONFLICT_TEXT], kind: r.kind === 'declared' ? 'declared' : 'auto', note: (r.note as string | null) ?? null, createdAt: String(r.created_at ?? '') });
  }
  const cache = new Map<string, { memberUserIds: string[]; memberEmails: string[]; applicantUserIds: string[] }>();
  for (const a of apps) {
    const facts = await factsOf(admin, call.id, a, cache);
    for (const e of evaluators) {
      const c = autoConflict({ userId: e.userId, email: e.email, application: facts });
      if (c) add({ applicationId: a.applicationId, userId: e.userId, code: c.code, text: c.text, kind: 'auto', note: null, createdAt: null });
      const name = (a.startupName ?? '').trim().toLowerCase();
      if (name && company.some((x) => x.userId === e.userId && x.companyName.trim().toLowerCase() === name)) add({ applicationId: a.applicationId, userId: e.userId, code: 'declared_company', text: COMPANY_CONFLICT_TEXT, kind: 'declared', note: null, createdAt: null });
    }
  }
  const started = new Set(((evals.data ?? []) as Row[]).map((r) => pairKey(r.application_id as string, r.evaluator_user_id as string)));
  return { call, mode, n: settings.evaluatorsPerApplication, evaluators, apps, assignments, blocked, started };
}

// --- The plan --------------------------------------------------------------------------------------------------------------------------------------------

export interface Plan {
  remove: (Pair & { why: string })[];
  add: Pair[];
  /** Conflicts found but kept because the evaluation was already started: a person decides. */
  keptWithConflict: Pair[];
  shortfalls: { applicationId: string; wanted: number; got: number }[];
  loads: Record<string, number>;
  warning: string | null;
  /** Automatic conflicts found that are not recorded yet. */
  newConflicts: Blocked[];
}

export function plan(g: Gathered, opts: { only?: string[]; recordedKeys?: Set<string> } = {}): Plan {
  const apps = (opts.only ? g.apps.filter((a) => opts.only!.includes(a.applicationId)) : g.apps).map((a) => ({ applicationId: a.applicationId }));
  const input = { applications: apps, evaluators: g.evaluators.map((e) => ({ userId: e.userId })), n: g.n, existing: g.assignments.map((a) => ({ applicationId: a.applicationId, userId: a.userId })), blocked: g.blocked.map((b) => ({ applicationId: b.applicationId, userId: b.userId })) };
  const r = redistribute(input);
  const why = (p: Pair) => (g.blocked.some((b) => b.applicationId === p.applicationId && b.userId === p.userId) ? 'conflict of interest' : 'no longer an evaluator');
  const keptWithConflict = r.remove.filter((p) => g.started.has(pairKey(p.applicationId, p.userId)));
  const remove = r.remove.filter((p) => !g.started.has(pairKey(p.applicationId, p.userId))).map((p) => ({ ...p, why: why(p) }));
  // The ones kept still count as assigned, so nobody is added in their place.
  let add = r.add; let shortfalls = r.shortfalls; let loads = r.loads; let warning = r.warning;
  if (keptWithConflict.length) {
    const kept = g.assignments.filter((a) => !remove.some((x) => x.applicationId === a.applicationId && x.userId === a.userId)).map((a) => ({ applicationId: a.applicationId, userId: a.userId }));
    const again = distribute({ ...input, existing: kept });
    add = again.add; shortfalls = again.shortfalls; loads = again.loads; warning = again.warning;
  }
  if (g.mode === 'manual') add = [];
  const recorded = opts.recordedKeys ?? new Set<string>();
  const newConflicts = g.blocked.filter((b) => b.kind === 'auto' && !recorded.has(`${pairKey(b.applicationId, b.userId)}:auto`) && (g.assignments.some((a) => a.applicationId === b.applicationId && a.userId === b.userId) || g.apps.some((a) => a.applicationId === b.applicationId)));
  return { remove, add, keptWithConflict, shortfalls, loads: g.mode === 'manual' ? loadsOf(g.assignments, g.evaluators.map((e) => e.userId)) : loads, warning, newConflicts };
}

// --- Applying --------------------------------------------------------------------------------------------------------------------------------------------

async function recordedAutoKeys(admin: SupabaseClient, callId: string): Promise<Set<string>> {
  const { data } = await admin.from('call_eval_conflicts').select('application_id, evaluator_user_id, kind').eq('call_id', callId);
  return new Set(((data ?? []) as Row[]).filter((r) => r.application_id).map((r) => `${pairKey(r.application_id as string, r.evaluator_user_id as string)}:${r.kind}`));
}

const assignedContent = (call: Call, n: number): NoticeContent => ({
  title: n === 1 ? `1 application to evaluate — ${call.name}` : `${n} applications to evaluate — ${call.name}`,
  body: n === 1 ? `One application of “${call.name}” was assigned to you. Open “My evaluations” to read it and score it.` : `${n} applications of “${call.name}” were assigned to you. Open “My evaluations” to read them and score them.`,
  ctaLabel: 'Open my evaluations',
});

/** Tells each evaluator who received something new, once per move (the dedupe key carries the batch). Never throws: a notice must not undo an assignment. */
async function tellEvaluators(admin: SupabaseClient, call: Call, added: Pair[], evaluators: EvaluatorInfo[], batch: string): Promise<void> {
  const per = new Map<string, number>();
  for (const p of added) per.set(p.userId, (per.get(p.userId) ?? 0) + 1);
  for (const [userId, n] of per) {
    try {
      const content = assignedContent(call, n);
      const { created, id } = await createNotice(admin, { userId, callId: call.id, applicationId: null, kind: 'eval_assigned', dedupeKey: `eval:assigned:${call.id}:${batch}`, content, linkPath: null });
      const email = evaluators.find((e) => e.userId === userId)?.email;
      if (created && email) await emailNotice(admin, id, email, call, content, { url: emailBase() });
    } catch (e) { console.error('[calls/eval] could not tell an evaluator:', (e as Error).message); }
  }
}
function emailBase(): string {
  const b = process.env.NEXT_PUBLIC_APP_URL || 'https://www.sherlockdeal.com';
  return (/^https?:\/\//i.test(b) ? b : `https://${b}`).replace(/\/$/, '');
}

export interface Applied { removed: number; added: number; conflictsRecorded: number }

export async function applyPlan(admin: SupabaseClient, g: Gathered, p: Plan, actor: string | null, source: 'auto' | 'manual' = 'auto', batch: string = new Date().toISOString()): Promise<Applied> {
  const now = new Date().toISOString();
  for (const r of p.remove) {
    await admin.from('call_eval_assignments').update({ status: 'removed', removed_at: now, reason: r.why }).eq('call_id', g.call.id).eq('application_id', r.applicationId).eq('evaluator_user_id', r.userId).eq('status', 'assigned');
    await admin.from('call_events').insert({ call_id: g.call.id, application_id: r.applicationId, event: 'eval_unassigned', actor_user_id: actor, detail: { evaluator: r.userId, why: r.why } });
  }
  const rows = p.add.map((a) => ({ call_id: g.call.id, application_id: a.applicationId, evaluator_user_id: a.userId, source, status: 'assigned', assigned_by: actor }));
  if (rows.length) { const ins = await admin.from('call_eval_assignments').insert(rows); if (ins.error) throw new Error(`Could not assign the applications: ${ins.error.message}`); }
  for (const a of p.add) await admin.from('call_events').insert({ call_id: g.call.id, application_id: a.applicationId, event: 'eval_assigned', actor_user_id: actor, detail: { evaluator: a.userId, source } });
  let recorded = 0;
  for (const c of p.newConflicts) {
    const ins = await admin.from('call_eval_conflicts').insert({ call_id: g.call.id, evaluator_user_id: c.userId, application_id: c.applicationId, kind: 'auto', code: c.code, note: null });
    if (!ins.error) { recorded++; await admin.from('call_events').insert({ call_id: g.call.id, application_id: c.applicationId, event: 'eval_conflict_found', actor_user_id: null, detail: { evaluator: c.userId, code: c.code } }); }
  }
  if (p.add.length) await tellEvaluators(admin, g.call, p.add, g.evaluators, batch);
  return { removed: p.remove.length, added: p.add.length, conflictsRecorded: recorded };
}

/** "Redistribute": the plan for the whole call, to show before applying — and the same plan applied once the administrator confirms. */
export async function previewRedistribution(admin: SupabaseClient, call: Call): Promise<{ g: Gathered; p: Plan }> {
  const g = await gather(admin, call);
  return { g, p: plan(g, { recordedKeys: await recordedAutoKeys(admin, call.id) }) };
}
export async function redistributeAll(admin: SupabaseClient, call: Call, actor: string): Promise<{ applied: Applied; plan: Plan }> {
  const { g, p } = await previewRedistribution(admin, call);
  const applied = await applyPlan(admin, g, p, actor, 'auto');
  await admin.from('call_events').insert({ call_id: call.id, application_id: null, event: 'eval_redistributed', actor_user_id: actor, detail: { removed: applied.removed, added: applied.added, mode: g.mode } });
  return { applied, plan: p };
}

/**
 * One application just became Fit (or stopped being): distribute it if the mode allows; if it is no longer Fit, drop the assignments nobody has started.
 * Called after every eligibility result. Never throws — an eligibility result must never fail because of the distribution.
 */
export async function syncApplication(admin: SupabaseClient, call: Call, applicationId: string): Promise<void> {
  try {
    const { error: missing } = await admin.from('call_eval_settings').select('call_id').limit(1);
    if (missing && /does not exist|schema cache|PGRST205|42P01/i.test(`${missing.code ?? ''} ${missing.message ?? ''}`)) return;
    const g = await gather(admin, call);
    if (!g.apps.some((a) => a.applicationId === applicationId)) {
      // Not Fit (any more): whatever was assigned and not started is withdrawn.
      const stale = g.assignments.filter((a) => a.applicationId === applicationId && !g.started.has(pairKey(a.applicationId, a.userId)));
      if (stale.length) await applyPlan(admin, g, { remove: stale.map((s) => ({ applicationId: s.applicationId, userId: s.userId, why: 'the application is not Fit' })), add: [], keptWithConflict: [], shortfalls: [], loads: {}, warning: null, newConflicts: [] }, null);
      return;
    }
    const p = plan(g, { only: [applicationId], recordedKeys: await recordedAutoKeys(admin, call.id) });
    await applyPlan(admin, g, p, null, 'auto');
  } catch (e) { console.error(`[calls/eval] could not distribute application ${applicationId}:`, (e as Error).message); }
}

// --- By hand ---------------------------------------------------------------------------------------------------------------------------------------------

export type MoveResult = { ok: true } | { ok: false; error: string; status: number };

export async function assignByHand(admin: SupabaseClient, call: Call, applicationId: string, userId: string, actor: string): Promise<MoveResult> {
  const g = await gather(admin, call);
  if (g.mode === 'auto') return { ok: false, status: 409, error: 'The distribution is automatic. Switch to “Mixed” or “Manual” to assign by hand.' };
  if (!g.apps.some((a) => a.applicationId === applicationId)) return { ok: false, status: 404, error: 'Only submitted applications that are a Fit can be assigned.' };
  const ev = g.evaluators.find((e) => e.userId === userId);
  if (!ev) return { ok: false, status: 409, error: 'This person cannot evaluate: they need the permission “Evaluate assigned applications”.' };
  const c = g.blocked.find((b) => b.applicationId === applicationId && b.userId === userId);
  if (c) return { ok: false, status: 409, error: `${ev.name ?? ev.email ?? 'This person'} ${c.text}: they cannot evaluate this application.` };
  if (g.assignments.some((a) => a.applicationId === applicationId && a.userId === userId)) return { ok: false, status: 409, error: 'This application is already assigned to that person.' };
  await applyPlan(admin, g, { remove: [], add: [{ applicationId, userId }], keptWithConflict: [], shortfalls: [], loads: {}, warning: null, newConflicts: [] }, actor, 'manual');
  return { ok: true };
}

export async function unassignByHand(admin: SupabaseClient, call: Call, applicationId: string, userId: string, actor: string): Promise<MoveResult> {
  const g = await gather(admin, call);
  if (g.mode === 'auto') return { ok: false, status: 409, error: 'The distribution is automatic. Switch to “Mixed” or “Manual” to change it by hand.' };
  if (!g.assignments.some((a) => a.applicationId === applicationId && a.userId === userId)) return { ok: false, status: 404, error: 'That assignment does not exist.' };
  if (g.started.has(pairKey(applicationId, userId))) return { ok: false, status: 409, error: 'This evaluator has already started this evaluation. Reopen or remove it from the evaluation instead.' };
  await applyPlan(admin, g, { remove: [{ applicationId, userId, why: 'removed by the administrator' }], add: [], keptWithConflict: [], shortfalls: [], loads: {}, warning: null, newConflicts: [] }, actor);
  return { ok: true };
}

/**
 * "I have a conflict" (the evaluator, on an application assigned to them): recorded with the optional reason (only the administrator sees it), the assignment removed, the draft they had started discarded, and
 * the application given to someone else if the mode allows. A submitted evaluation cannot be undone by declaring a conflict afterwards.
 */
export async function declareConflict(admin: SupabaseClient, call: Call, applicationId: string, userId: string, note: string | null): Promise<MoveResult> {
  const g = await gather(admin, call);
  if (!g.assignments.some((a) => a.applicationId === applicationId && a.userId === userId)) return { ok: false, status: 404, error: 'That application is not assigned to you.' };
  const { data: ev } = await admin.from('call_evaluations').select('id, status').eq('application_id', applicationId).eq('evaluator_user_id', userId).maybeSingle();
  if ((ev as Row | null)?.status === 'submitted') return { ok: false, status: 409, error: 'You already submitted this evaluation. Ask the administrator to reopen it.' };
  const clean = (note ?? '').trim().slice(0, 1000) || null;
  const ins = await admin.from('call_eval_conflicts').insert({ call_id: call.id, evaluator_user_id: userId, application_id: applicationId, kind: 'declared', code: 'declared', note: clean, declared_by: userId });
  if (ins.error && ins.error.code !== '23505') return { ok: false, status: 500, error: 'Your conflict could not be recorded. Please try again.' };
  if (ev) await admin.from('call_evaluations').delete().eq('id', (ev as Row).id as string);                // the unsent draft is discarded with the assignment
  await admin.from('call_events').insert({ call_id: call.id, application_id: applicationId, event: 'eval_conflict_declared', actor_user_id: userId, detail: { evaluator: userId, hasNote: !!clean } });
  const after = await gather(admin, call);
  const p = plan(after, { only: [applicationId], recordedKeys: await recordedAutoKeys(admin, call.id) });
  await applyPlan(admin, after, { ...p, remove: [...p.remove, ...(p.remove.some((r) => r.userId === userId) ? [] : [{ applicationId, userId, why: 'declared a conflict' }])] }, userId, 'auto');
  return { ok: true };
}

// --- What the administrator's screen shows ---------------------------------------------------------------------------------------------------------------

export interface DistributionView {
  mode: DistributionMode; evaluatorsPerApplication: number | 'all'; effectiveN: number; warning: string | null;
  evaluators: { userId: string; name: string | null; email: string | null; assigned: number; started: number; submitted: number }[];
  applications: { applicationId: string; reference: string | null; startupName: string | null; needed: number; evaluators: { userId: string; name: string | null; source: 'auto' | 'manual'; status: 'not_started' | 'in_progress' | 'submitted' }[]; short: boolean }[];
  conflicts: { applicationId: string; reference: string | null; userId: string; evaluator: string | null; text: string; kind: 'auto' | 'declared'; note: string | null; createdAt: string | null; resolved: boolean }[];
  unassigned: number;
}

export async function buildDistributionView(admin: SupabaseClient, g: Gathered): Promise<DistributionView> {
  const { data: evs } = await admin.from('call_evaluations').select('application_id, evaluator_user_id, status').eq('call_id', g.call.id);
  const state = new Map(((evs ?? []) as Row[]).map((r) => [pairKey(r.application_id as string, r.evaluator_user_id as string), r.status === 'submitted' ? 'submitted' as const : 'in_progress' as const]));
  const nameOf = (id: string) => { const e = g.evaluators.find((x) => x.userId === id); return e?.name ?? e?.email ?? null; };
  const effectiveN = g.n === 'all' ? g.evaluators.length : Math.min(g.n, g.evaluators.length);
  const dry = distribute({ applications: [], evaluators: g.evaluators.map((e) => ({ userId: e.userId })), n: g.n, existing: [], blocked: [] });
  const evaluators = g.evaluators.map((e) => {
    const mine = g.assignments.filter((a) => a.userId === e.userId);
    return { userId: e.userId, name: e.name, email: e.email, assigned: mine.length, started: mine.filter((a) => state.has(pairKey(a.applicationId, a.userId))).length, submitted: mine.filter((a) => state.get(pairKey(a.applicationId, a.userId)) === 'submitted').length };
  });
  const applications = g.apps.map((a) => {
    const mine = g.assignments.filter((x) => x.applicationId === a.applicationId);
    const needed = g.n === 'all' ? Math.max(0, g.evaluators.filter((e) => !g.blocked.some((b) => b.applicationId === a.applicationId && b.userId === e.userId)).length - mine.length) : Math.max(0, effectiveN - mine.length);
    return { applicationId: a.applicationId, reference: a.reference, startupName: a.startupName, needed, short: needed > 0,
      evaluators: mine.map((m) => ({ userId: m.userId, name: nameOf(m.userId), source: m.source, status: state.get(pairKey(m.applicationId, m.userId)) ?? ('not_started' as const) })) };
  });
  const refOf = new Map(g.apps.map((a) => [a.applicationId, a.reference]));
  const conflicts = g.blocked.map((b) => ({ applicationId: b.applicationId, reference: refOf.get(b.applicationId) ?? null, userId: b.userId, evaluator: nameOf(b.userId), text: b.text, kind: b.kind, note: b.note, createdAt: b.createdAt,
    resolved: !g.assignments.some((a) => a.applicationId === b.applicationId && a.userId === b.userId) }));
  return { mode: g.mode, evaluatorsPerApplication: g.n, effectiveN, warning: dry.warning, evaluators, applications, conflicts, unassigned: applications.filter((a) => a.evaluators.length === 0).length };
}
