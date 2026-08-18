// Investor Workspace Agenda calendar (Prompt 247 B / 248) — CRUD glue for
// investor_tasks (migration 0182), the investor's own task/reminder list,
// mirroring the founder's tasks store the same way investor-agenda.ts
// mirrors the founder's Agenda rail. Every write is scoped by
// investor_email (the table's only ownership check — same trust boundary
// as investor_followups, see 0182's header).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionType, TaskKind } from './types';

export interface InvestorTaskItem {
  id: string;
  orgId: string | null;
  orgName: string | null;
  title: string;
  kind: TaskKind;
  action_type: ActionType;
  due_at: string | null;
  notes: string | null;
  reminder_at: string | null;
  snoozed_until: string | null;
  done: boolean;
}

function toItem(row: Record<string, unknown>, orgName: string | null): InvestorTaskItem {
  return {
    id: row.id as string,
    orgId: (row.org_id as string | null) ?? null,
    orgName,
    title: row.title as string,
    kind: row.kind as TaskKind,
    action_type: row.action_type as ActionType,
    due_at: (row.due_at as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    reminder_at: (row.reminder_at as string | null) ?? null,
    snoozed_until: (row.snoozed_until as string | null) ?? null,
    done: row.done as boolean,
  };
}

export async function listInvestorTasks(admin: SupabaseClient, email: string): Promise<InvestorTaskItem[]> {
  const { data: rows } = await admin.from('investor_tasks').select('*').eq('investor_email', email).order('due_at', { ascending: true });
  if (!rows || rows.length === 0) return [];
  const orgIds = [...new Set(rows.map((r) => r.org_id as string | null).filter(Boolean))] as string[];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] };
  const nameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  return rows.map((r) => toItem(r, r.org_id ? nameById.get(r.org_id as string) ?? null : null));
}

export interface CreateInvestorTaskInput {
  investorEmail: string;
  orgId?: string | null;
  title: string;
  kind: TaskKind;
  action_type: ActionType;
  due_at?: string | null;
  notes?: string | null;
  reminder_at?: string | null;
}

// eligibleOrgIds is the caller's job to compute (portal-access.ts) and pass
// in — this function only enforces it, it never decides eligibility itself,
// so there's exactly one place in the codebase that answers "which startups
// can this investor see" (the root privacy rule this route was reviewed
// against in prompt 248).
export async function createInvestorTask(
  admin: SupabaseClient, input: CreateInvestorTaskInput, eligibleOrgIds: string[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!input.title.trim()) return { ok: false, error: 'Title is required.' };
  if (input.orgId && !eligibleOrgIds.includes(input.orgId)) return { ok: false, error: 'No active access to this startup.' };

  const { data, error } = await admin.from('investor_tasks').insert({
    investor_email: input.investorEmail,
    org_id: input.orgId || null,
    title: input.title.trim(),
    kind: input.kind,
    action_type: input.action_type,
    due_at: input.due_at || null,
    notes: input.notes || null,
    reminder_at: input.reminder_at || null,
  }).select('id').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id as string };
}

export interface UpdateInvestorTaskInput {
  id: string;
  investorEmail: string;
  done?: boolean;
  reminder_at?: string | null;
  snoozed_until?: string | null;
}

export async function updateInvestorTask(admin: SupabaseClient, input: UpdateInvestorTaskInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch: Record<string, unknown> = {};
  if (input.done !== undefined) patch.done = input.done;
  if (input.reminder_at !== undefined) patch.reminder_at = input.reminder_at;
  if (input.snoozed_until !== undefined) patch.snoozed_until = input.snoozed_until;
  if (Object.keys(patch).length === 0) return { ok: false, error: 'Nothing to update.' };

  // investor_email match here IS the ownership check (this table has no
  // RLS policy for any authenticated role — see 0182's header) — a
  // service-role update without it would let any signed-in investor edit
  // any other investor's tasks.
  const { error } = await admin.from('investor_tasks').update(patch).eq('id', input.id).eq('investor_email', input.investorEmail);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
