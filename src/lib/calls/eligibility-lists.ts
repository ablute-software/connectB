// Prompt 918 (I3) — what the Applications tab needs about eligibility, gathered for ONE call (server only): the current result of each submitted application and the state of its task, the counts per
// sub-view, and the "Possible duplicate" signals between applications of this call. Nothing of another call is read; a draft is never touched (only submitted applications are listed).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findPossibleDuplicates, type DuplicateFacts, type PossibleDuplicate } from './duplicates';
import { loadCurrent, type CurrentEligibility } from './eligibility-review';
import { buildInfo, viewOf, type EligibilityInfo, type EligibilityView } from './eligibility-payload';
import { loadRules } from './eligibility-store';
import type { Call } from './types';

type Row = Record<string, unknown>;

export interface ApplicationEligibilityRow { applicationId: string; info: EligibilityInfo; view: EligibilityView; duplicates: PossibleDuplicate[] }

/** The latest task of each application (the one that says whether it is waiting, running or failed). */
async function taskStates(admin: SupabaseClient, callId: string): Promise<Map<string, { status: string; lastError: string | null }>> {
  const { data } = await admin.from('call_processing_tasks').select('application_id, status, last_error, created_at').eq('call_id', callId).order('created_at', { ascending: true });
  const m = new Map<string, { status: string; lastError: string | null }>();
  for (const t of (data ?? []) as Row[]) m.set(t.application_id as string, { status: t.status as string, lastError: (t.last_error as string | null) ?? null });
  return m;
}

async function currents(admin: SupabaseClient, callId: string): Promise<Map<string, CurrentEligibility>> {
  const { data } = await admin.from('call_application_eligibility').select('application_id').eq('call_id', callId).eq('is_current', true);
  const out = new Map<string, CurrentEligibility>();
  for (const r of (data ?? []) as Row[]) { const c = await loadCurrent(admin, r.application_id as string); if (c) out.set(c.applicationId, c); }
  return out;
}

/** Facts for the duplicate signals: the startup's name and website, the emails and ids of its people, and the tax ID declared in the application when a rule compares one. */
async function duplicateFacts(admin: SupabaseClient, call: Call, apps: Row[]): Promise<DuplicateFacts[]> {
  const orgIds = [...new Set(apps.map((a) => a.startup_org_id as string | null).filter((x): x is string => !!x))];
  const [orgs, members] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name, website').in('id', orgIds) : Promise.resolve({ data: [] }),
    orgIds.length ? admin.from('org_members').select('org_id, user_id').in('org_id', orgIds) : Promise.resolve({ data: [] }),
  ]);
  const orgRow = new Map(((orgs.data ?? []) as Row[]).map((o) => [o.id as string, o]));
  const people = new Map<string, string[]>();
  for (const m of (members.data ?? []) as Row[]) people.set(m.org_id as string, [...(people.get(m.org_id as string) ?? []), m.user_id as string]);
  const emailOf = new Map<string, string | null>();
  const userIds = [...new Set([...people.values()].flat())];
  await Promise.all(userIds.map(async (u) => { const { data } = await admin.auth.admin.getUserById(u); emailOf.set(u, data?.user?.email ?? null); }));
  const taxFields = (await loadRules(admin, call.id, call.eligibilityVersion ?? 1)).map((r) => (r.params as { matchTaxId?: string | null }).matchTaxId).filter((x): x is string => !!x);
  const subIds = apps.map((a) => a.current_submission_id as string | null).filter((x): x is string => !!x);
  const answersOf = new Map<string, Record<string, unknown>>();
  if (taxFields.length && subIds.length) {
    const { data } = await admin.from('call_application_submissions').select('id, answers').in('id', subIds);
    for (const s of (data ?? []) as Row[]) answersOf.set(s.id as string, (s.answers ?? {}) as Record<string, unknown>);
  }
  return apps.map((a) => {
    const org = orgRow.get(a.startup_org_id as string);
    const ans = answersOf.get(a.current_submission_id as string) ?? {};
    const tax = taxFields.map((f) => ans[f]).find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? null;
    const ids = people.get(a.startup_org_id as string) ?? [];
    return {
      applicationId: a.id as string, reference: (a.reference as string | null) ?? null, startup: String(org?.name ?? 'A startup'), website: (org?.website as string | null) ?? null,
      emails: ids.map((u) => emailOf.get(u)).filter((e): e is string => !!e), people: ids, taxId: tax,
    };
  });
}

/** Every submitted application of the call with its eligibility state and its possible duplicates. */
export async function loadEligibilityRows(admin: SupabaseClient, call: Call, apps: Row[]): Promise<ApplicationEligibilityRow[]> {
  const [cur, tasks, facts] = await Promise.all([currents(admin, call.id), taskStates(admin, call.id), duplicateFacts(admin, call, apps)]);
  const dups = findPossibleDuplicates(facts);
  return apps.map((a) => {
    const id = a.id as string;
    const info = buildInfo(cur.get(id) ?? null, tasks.get(id) ?? null);
    return { applicationId: id, info, view: viewOf(info.state), duplicates: dups.get(id) ?? [] };
  });
}

export function countViews(rows: { view: EligibilityView }[]): Record<EligibilityView, number> {
  const c: Record<EligibilityView, number> = { fit: 0, not_fit: 0, to_validate: 0, processing: 0 };
  for (const r of rows) c[r.view]++;
  return c;
}
