// Prompt 905 — the Supabase side of Calls Stage 1: every read and write of the calls tables, with the service
// role (callers have already authenticated and authorised the request in access.ts). Nothing here decides who
// may do what; it only keeps the data coherent: optimistic concurrency on the configuration, compare-and-swap on
// status transitions, an event for every change.
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fieldToRow, rowToCall, rowToField, rowToPhase } from './mappers';
import { CLOSE_REASON_EVENTS, closeReasonFrom, type CloseReason } from './closing';
import type { Call, CallPhase, FormField, PromoterKind } from './types';
import { newFieldId } from './form-builder';

type Row = Record<string, unknown>;

export const generateLinkToken = (): string => randomBytes(16).toString('base64url');

export async function logCallEvent(
  admin: SupabaseClient, callId: string, event: string, actor: string | null, detail: Record<string, unknown> = {},
): Promise<void> {
  await admin.from('call_events').insert({ call_id: callId, event, actor_user_id: actor, detail });
}

/**
 * A call by id. A DELETED call (Prompt 918, Adenda 2, C) does not exist for anybody — the editor, the link, the applicants' area, the cron — unless the caller says so:
 * only the "Deleted calls" screen, the restore, the purge and the read of an application of a cancelled call do.
 */
export async function loadCall(admin: SupabaseClient, id: string, opts: { includeDeleted?: boolean } = {}): Promise<Call | null> {
  const { data } = await admin.from('calls').select('*').eq('id', id).maybeSingle();
  if (!data) return null;
  if ((data as Row).deleted_at && !opts.includeDeleted) return null;
  return rowToCall(data as Row);
}

export async function loadCallByToken(admin: SupabaseClient, token: string, opts: { includeDeleted?: boolean } = {}): Promise<Call | null> {
  const { data } = await admin.from('calls').select('*').eq('link_token', token).maybeSingle();
  if (!data) return null;
  if ((data as Row).deleted_at && !opts.includeDeleted) return null;
  return rowToCall(data as Row);
}

/** Is this link the one of a call that was deleted? (The link then says "This call is no longer available" rather than "not found".) */
export async function isDeletedLink(admin: SupabaseClient, token: string): Promise<boolean> {
  const call = await loadCallByToken(admin, token, { includeDeleted: true });
  return !!call?.deletedAt;
}

export async function loadPhases(admin: SupabaseClient, callId: string): Promise<CallPhase[]> {
  const { data } = await admin.from('call_phases').select('*').eq('call_id', callId).order('position', { ascending: true });
  return ((data ?? []) as Row[]).map(rowToPhase);
}

export async function loadFields(admin: SupabaseClient, callId: string): Promise<FormField[]> {
  const { data } = await admin.from('call_form_fields').select('*').eq('call_id', callId)
    .order('page', { ascending: true }).order('position', { ascending: true });
  return ((data ?? []) as Row[]).map(rowToField);
}

export async function loadEvents(admin: SupabaseClient, callId: string, limit = 50) {
  const { data } = await admin.from('call_events').select('id, event, actor_user_id, detail, created_at')
    .eq('call_id', callId).order('id', { ascending: false }).limit(limit);
  return (data ?? []) as { id: number; event: string; actor_user_id: string | null; detail: Record<string, unknown>; created_at: string }[];
}

/**
 * WHY the call is closed, read from its history (Prompt 918, Adenda 3): by its deadline, early on purpose, or deleted and restored. The one place that decides it (closing.ts): the "Reopen and extend"
 * box says it, and whether reopening asks for a confirmation follows from it.
 */
export async function loadCloseReason(admin: SupabaseClient, callId: string): Promise<CloseReason> {
  const { data } = await admin.from('call_events').select('id, event, detail').eq('call_id', callId).in('event', [...CLOSE_REASON_EVENTS]).order('id', { ascending: false }).limit(6);
  return closeReasonFrom(((data ?? []) as { id: number; event: string; detail: Record<string, unknown> | null }[]));
}

/** Did the call close early ("Close early", a decision of the team) rather than by its deadline or by being deleted and restored? */
export async function wasClosedEarly(admin: SupabaseClient, callId: string): Promise<boolean> {
  return (await loadCloseReason(admin, callId)) === 'early';
}

export async function promoterName(admin: SupabaseClient, kind: PromoterKind, id: string): Promise<string> {
  const { data } = kind === 'incubator'
    ? await admin.from('incubators').select('name').eq('id', id).maybeSingle()
    : await admin.from('catalog_entities').select('name').eq('id', id).maybeSingle();
  return ((data as Row | null)?.name as string | undefined) ?? 'Your organisation';
}

export interface CallCard {
  /** Prompt 917 (Adenda 1): a reading in progress, or a proposal waiting for review. */
  importRun?: { id: string; status: 'reading' | 'proposed' } | null; call: Call; applications: number; applicationsTotal: number; fields: number; phases: number }

/** Applications of a call by state. Only the numbers: the answers are never read here. */
export async function countApplications(admin: SupabaseClient, callId: string): Promise<{ submitted: number; inProgress: number; withdrawn: number; total: number }> {
  const { data } = await admin.from('call_applications').select('status').eq('call_id', callId);
  const rows = (data ?? []) as Row[];
  const n = (st: string) => rows.filter((r) => r.status === st).length;
  return { submitted: n('submitted'), inProgress: n('draft'), withdrawn: n('withdrawn'), total: rows.length };
}

/** What deleting a call would remove: the numbers only (never who). Drafts are applicants who started and have not submitted. */
export async function deletionImpact(admin: SupabaseClient, callId: string): Promise<{ submitted: number; drafts: number; files: number }> {
  const [counts, { data: files }] = await Promise.all([countApplications(admin, callId), admin.from('call_application_files').select('id').eq('call_id', callId)]);
  return { submitted: counts.submitted + counts.withdrawn, drafts: counts.inProgress, files: ((files ?? []) as Row[]).length };
}

export interface SoftDeleted { ok: true; submitted: number; drafts: number; files: number; purgeAfter: string; closedIt: boolean; statusBefore: string }
/**
 * Delete a call (Prompt 918, Adenda 2, C): marked deleted, closed if it was open, purged in 30 days. One transaction in SQL under a row lock (soft_delete_call), which also writes the
 * record that survives. Nothing is removed yet: it can be restored until `purgeAfter`.
 */
export async function softDeleteCall(admin: SupabaseClient, call: Call, actor: string, promoterDisplayName: string): Promise<SoftDeleted | { ok: false; reason: string }> {
  const { data, error } = await admin.rpc('soft_delete_call', { p_call: call.id, p_actor: actor, p_promoter_name: promoterDisplayName });
  if (error || !data) return { ok: false, reason: 'error' };
  if (data.ok !== true) return { ok: false, reason: String(data.reason ?? 'error') };
  return { ok: true, submitted: Number(data.submitted ?? 0), drafts: Number(data.drafts ?? 0), files: Number(data.files ?? 0), purgeAfter: String(data.purge_after), closedIt: data.closed_it === true, statusBefore: String(data.status_before ?? '') };
}

/** Bring a deleted call back, as it was (a call that was open comes back closed). Refused when the 30 days are over. */
export async function restoreCall(admin: SupabaseClient, callId: string, actor: string, promoterDisplayName: string): Promise<{ ok: true; status: string } | { ok: false; reason: string }> {
  const { data, error } = await admin.rpc('restore_call', { p_call: callId, p_actor: actor, p_promoter_name: promoterDisplayName });
  if (error || !data) return { ok: false, reason: 'error' };
  return data.ok === true ? { ok: true, status: String(data.status ?? '') } : { ok: false, reason: String(data.reason ?? 'error') };
}

/** The organisation's deleted calls, newest deletion first. */
export async function listDeletedCalls(admin: SupabaseClient, kind: PromoterKind, promoterId: string): Promise<Call[]> {
  const col = kind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('calls').select('*').eq(col, promoterId);
  return ((data ?? []) as Row[]).filter((r) => r.deleted_at).map(rowToCall)
    .sort((a, b) => String(b.deletedAt ?? '').localeCompare(String(a.deletedAt ?? '')));
}

/**
 * Delete a call that nobody applied to, with the record of who deleted what and when (it survives the call). One
 * transaction in SQL under a row lock, so a late application cannot slip in between the check and the delete.
 */
export async function deleteCallIfEmpty(
  admin: SupabaseClient, call: Call, actor: string, promoterDisplayName: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data, error } = await admin.rpc('delete_call_if_empty', { p_call: call.id, p_actor: actor, p_promoter_name: promoterDisplayName });
  if (error || !data) return { ok: false, reason: 'error' };
  return data.ok === true ? { ok: true } : { ok: false, reason: String(data.reason ?? 'error') };
}

export async function listPromoterCalls(admin: SupabaseClient, kind: PromoterKind, promoterId: string): Promise<CallCard[]> {
  const col = kind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('calls').select('*').eq(col, promoterId).order('created_at', { ascending: false });
  const calls = ((data ?? []) as Row[]).filter((r) => !r.deleted_at).map(rowToCall);   // a deleted call is not in the list (it is in "Deleted calls")
  if (calls.length === 0) return [];
  const ids = calls.map((c) => c.id);
  const [{ data: apps }, { data: fields }, { data: phases }, { data: runs }] = await Promise.all([
    admin.from('call_applications').select('call_id, status').in('call_id', ids),
    admin.from('call_form_fields').select('call_id').in('call_id', ids),
    admin.from('call_phases').select('call_id').in('call_id', ids),
    // Prompt 917 (Adenda 1): a reading in progress, or a proposal waiting for review — shown on the call's card, with the way to it.
    admin.from('call_import_runs').select('id, call_id, status, created_at').in('call_id', ids).in('status', ['reading', 'proposed']).order('created_at', { ascending: false }),
  ]);
  const importRun = new Map<string, { id: string; status: 'reading' | 'proposed' }>();
  for (const r of ((runs ?? []) as Row[])) {
    const cid = r.call_id as string;
    const cur = importRun.get(cid);
    // a reading in progress wins over a proposal; otherwise the newest
    if (!cur || (r.status === 'reading' && cur.status !== 'reading')) importRun.set(cid, { id: r.id as string, status: r.status as 'reading' | 'proposed' });
  }
  const count = (rows: unknown) => {
    const m = new Map<string, number>();
    for (const r of (rows ?? []) as Row[]) m.set(r.call_id as string, (m.get(r.call_id as string) ?? 0) + 1);
    return m;
  };
  const allApps = (apps ?? []) as Row[];
  const a = count(allApps.filter((r) => r.status === 'submitted'));
  const total = count(allApps);
  const f = count(fields); const p = count(phases);
  return calls.map((call) => ({ call, applications: a.get(call.id) ?? 0, applicationsTotal: total.get(call.id) ?? 0, fields: f.get(call.id) ?? 0, phases: p.get(call.id) ?? 0, importRun: importRun.get(call.id) ?? null }));
}

export async function createCall(
  admin: SupabaseClient, args: { kind: PromoterKind; promoterId: string; userId: string; name: string; description?: string | null },
): Promise<Call> {
  const row: Row = {
    promoter_kind: args.kind, name: args.name, description: args.description ?? null, created_by: args.userId,
    ...(args.kind === 'incubator' ? { incubator_id: args.promoterId } : { catalog_entity_id: args.promoterId }),
  };
  const { data, error } = await admin.from('calls').insert(row).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not create the call.');
  const call = rowToCall(data as Row);
  // A call always has at least one phase (§5.2: "uma call simples tem uma só fase").
  await admin.from('call_phases').insert({ call_id: call.id, position: 0, name: 'Phase 1' });
  await logCallEvent(admin, call.id, 'call_created', args.userId, { name: call.name });
  return call;
}

/**
 * Change the configuration under optimistic concurrency: the write only lands if nobody saved since the editor
 * last read (`baseVersion`), and bumps the version. Returns null on a conflict.
 */
export async function bumpConfig(admin: SupabaseClient, call: Call, baseVersion: number, patch: Row = {}): Promise<Call | null> {
  const { data } = await admin.from('calls')
    .update({ ...patch, config_version: baseVersion + 1, updated_at: new Date().toISOString() })
    .eq('id', call.id).eq('config_version', baseVersion).eq('status', 'draft').select('*');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? rowToCall(row) : null;
}

/**
 * Sets or clears the cover image or the logo of a call (Prompt 918, Adenda 1 C). Not part of the configuration: no version bump, whatever the call's state.
 * Returns the call as it is now, or null.
 */
export async function setCallMedia(admin: SupabaseClient, call: Call, kind: 'cover' | 'logo', path: string | null): Promise<Call | null> {
  const now = new Date().toISOString();
  const patch: Row = kind === 'cover' ? { cover_path: path, cover_updated_at: path ? now : null } : { logo_path: path, logo_updated_at: path ? now : null };
  const { data } = await admin.from('calls').update({ ...patch, updated_at: now }).eq('id', call.id).select('*');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? rowToCall(row) : null;
}

/** The description changes after the call is validated (presentation, not configuration): no version bump. Returns the call as it is now, or null. */
export async function setCallDescription(admin: SupabaseClient, call: Call, description: string | null): Promise<Call | null> {
  const { data } = await admin.from('calls').update({ description, updated_at: new Date().toISOString() }).eq('id', call.id).select('*');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? rowToCall(row) : null;
}

export async function replacePhases(
  admin: SupabaseClient, callId: string, phases: { id: string; position: number; name: string; starts_on: string | null; ends_on: string | null }[],
): Promise<void> {
  const keep = phases.map((p) => p.id);
  const { data: existing } = await admin.from('call_phases').select('id').eq('call_id', callId);
  const drop = ((existing ?? []) as Row[]).map((r) => r.id as string).filter((id) => !keep.includes(id));
  if (drop.length) {
    const { error } = await admin.from('call_phases').delete().in('id', drop).eq('call_id', callId);
    if (error) throw new Error(`Could not remove the old phases: ${error.message}`);
  }
  const { error } = await admin.from('call_phases').upsert(phases.map((p) => ({ ...p, call_id: callId })), { onConflict: 'id' });
  if (error) throw new Error(`Could not save the phases: ${error.message}`);
}

export async function replaceFields(admin: SupabaseClient, callId: string, fields: FormField[]): Promise<void> {
  const keep = fields.map((f) => f.id);
  const { data: existing } = await admin.from('call_form_fields').select('id').eq('call_id', callId);
  const drop = ((existing ?? []) as Row[]).map((r) => r.id as string).filter((id) => !keep.includes(id));
  // A write that fails must say so: a save that answers "ok" with the questions not stored is how a whole form can go missing (Prompt 917, 16/10/2026).
  if (drop.length) {
    const { error } = await admin.from('call_form_fields').delete().in('id', drop).eq('call_id', callId);
    if (error) throw new Error(`Could not remove the old questions: ${error.message}`);
  }
  if (fields.length) {
    const { error } = await admin.from('call_form_fields').upsert(fields.map((f) => fieldToRow(callId, f)), { onConflict: 'id' });
    if (error) throw new Error(`Could not save the questions: ${error.message}`);
  }
}

/** A status change: compare-and-swap on the status the caller saw, so two clicks cannot both succeed. */
export async function transitionCall(admin: SupabaseClient, call: Call, patch: Row): Promise<Call | null> {
  const { data } = await admin.from('calls').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', call.id).eq('status', call.status).select('*');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? rowToCall(row) : null;
}

/** The configuration as it was when confirmed (§22: "configurações confirmadas") — append-only. */
export async function snapshotConfig(admin: SupabaseClient, call: Call, phases: CallPhase[], fields: FormField[], actor: string): Promise<void> {
  await admin.from('call_config_snapshots').insert({
    call_id: call.id, version: call.configVersion, confirmed_by: actor,
    snapshot: { call: { ...call, linkToken: null }, phases, fields },
  });
}

/** Copy the configuration, the phases and the form. Never applications, evaluations or decisions (§5.3). */
export async function duplicateCall(admin: SupabaseClient, source: Call, actor: string): Promise<Call> {
  const [phases, fields] = await Promise.all([loadPhases(admin, source.id), loadFields(admin, source.id)]);
  const col = source.promoterKind === 'incubator' ? { incubator_id: source.promoterId } : { catalog_entity_id: source.promoterId };
  const { data, error } = await admin.from('calls').insert({
    promoter_kind: source.promoterKind, ...col, name: `${source.name} (copy)`.slice(0, 200), description: source.description,
    timezone: source.timezone, visibility: source.visibility, limit_unit: source.limitUnit, allow_multiple: source.allowMultiple,
    content_language: source.contentLanguage, currency: source.currency, duplicated_from: source.id, created_by: actor,
    // Dates are NOT copied: a copy is a new edition and must be given its own.
  }).select('*').single();
  if (error || !data) throw new Error(error?.message ?? 'Could not duplicate the call.');
  const copy = rowToCall(data as Row);

  const idMap = new Map(fields.map((f) => [f.id, newFieldId()]));
  await admin.from('call_phases').insert((phases.length ? phases : [{ id: '', position: 0, name: 'Phase 1', startsOn: null, endsOn: null }])
    .map((p, i) => ({ call_id: copy.id, position: i, name: p.name, starts_on: p.startsOn, ends_on: p.endsOn })));
  if (fields.length) {
    await admin.from('call_form_fields').insert(fields.map((f) => fieldToRow(copy.id, {
      ...f, id: idMap.get(f.id)!, condition: f.condition ? { ...f.condition, fieldId: idMap.get(f.condition.fieldId) ?? f.condition.fieldId } : null,
    })));
  }
  // The cover image (and a logo uploaded for the call) are copied as files of the copy — never shared, so removing one from either call cannot take the other's away (Prompt 918, Adenda 1 C).
  let result = copy;
  for (const [kind, path] of [['cover', source.coverPath], ['logo', source.logoPath]] as const) {
    if (!path) continue;
    const to = `calls/${copy.id}/${kind}-${path.split('/').pop()?.replace(/^(?:cover|logo)-/, '') ?? 'copy'}`;
    const { error: copyErr } = await admin.storage.from('data-room').copy(path, to);
    if (copyErr && !/already exists|duplicate/i.test(copyErr.message ?? '')) continue;
    result = (await setCallMedia(admin, result, kind, to)) ?? result;
  }
  await logCallEvent(admin, copy.id, 'call_duplicated', actor, { from: source.id });
  await logCallEvent(admin, source.id, 'call_duplicated_as', actor, { copy: copy.id });
  return result;
}
