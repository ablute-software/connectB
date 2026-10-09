// Prompt 905 — the Supabase side of Calls Stage 1: every read and write of the calls tables, with the service
// role (callers have already authenticated and authorised the request in access.ts). Nothing here decides who
// may do what; it only keeps the data coherent: optimistic concurrency on the configuration, compare-and-swap on
// status transitions, an event for every change.
import 'server-only';
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fieldToRow, rowToCall, rowToField, rowToPhase } from './mappers';
import type { Call, CallPhase, FormField, PromoterKind } from './types';
import { newFieldId } from './form-builder';

type Row = Record<string, unknown>;

export const generateLinkToken = (): string => randomBytes(16).toString('base64url');

export async function logCallEvent(
  admin: SupabaseClient, callId: string, event: string, actor: string | null, detail: Record<string, unknown> = {},
): Promise<void> {
  await admin.from('call_events').insert({ call_id: callId, event, actor_user_id: actor, detail });
}

export async function loadCall(admin: SupabaseClient, id: string): Promise<Call | null> {
  const { data } = await admin.from('calls').select('*').eq('id', id).maybeSingle();
  return data ? rowToCall(data as Row) : null;
}

export async function loadCallByToken(admin: SupabaseClient, token: string): Promise<Call | null> {
  const { data } = await admin.from('calls').select('*').eq('link_token', token).maybeSingle();
  return data ? rowToCall(data as Row) : null;
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

export async function promoterName(admin: SupabaseClient, kind: PromoterKind, id: string): Promise<string> {
  const { data } = kind === 'incubator'
    ? await admin.from('incubators').select('name').eq('id', id).maybeSingle()
    : await admin.from('catalog_entities').select('name').eq('id', id).maybeSingle();
  return ((data as Row | null)?.name as string | undefined) ?? 'Your organisation';
}

export interface CallCard { call: Call; applications: number; fields: number; phases: number }

export async function listPromoterCalls(admin: SupabaseClient, kind: PromoterKind, promoterId: string): Promise<CallCard[]> {
  const col = kind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('calls').select('*').eq(col, promoterId).order('created_at', { ascending: false });
  const calls = ((data ?? []) as Row[]).map(rowToCall);
  if (calls.length === 0) return [];
  const ids = calls.map((c) => c.id);
  const [{ data: apps }, { data: fields }, { data: phases }] = await Promise.all([
    admin.from('call_applications').select('call_id').in('call_id', ids).eq('status', 'submitted'),
    admin.from('call_form_fields').select('call_id').in('call_id', ids),
    admin.from('call_phases').select('call_id').in('call_id', ids),
  ]);
  const count = (rows: unknown) => {
    const m = new Map<string, number>();
    for (const r of (rows ?? []) as Row[]) m.set(r.call_id as string, (m.get(r.call_id as string) ?? 0) + 1);
    return m;
  };
  const a = count(apps); const f = count(fields); const p = count(phases);
  return calls.map((call) => ({ call, applications: a.get(call.id) ?? 0, fields: f.get(call.id) ?? 0, phases: p.get(call.id) ?? 0 }));
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

export async function replacePhases(
  admin: SupabaseClient, callId: string, phases: { id: string; position: number; name: string; starts_on: string | null; ends_on: string | null }[],
): Promise<void> {
  const keep = phases.map((p) => p.id);
  const { data: existing } = await admin.from('call_phases').select('id').eq('call_id', callId);
  const drop = ((existing ?? []) as Row[]).map((r) => r.id as string).filter((id) => !keep.includes(id));
  if (drop.length) await admin.from('call_phases').delete().in('id', drop).eq('call_id', callId);
  await admin.from('call_phases').upsert(phases.map((p) => ({ ...p, call_id: callId })), { onConflict: 'id' });
}

export async function replaceFields(admin: SupabaseClient, callId: string, fields: FormField[]): Promise<void> {
  const keep = fields.map((f) => f.id);
  const { data: existing } = await admin.from('call_form_fields').select('id').eq('call_id', callId);
  const drop = ((existing ?? []) as Row[]).map((r) => r.id as string).filter((id) => !keep.includes(id));
  if (drop.length) await admin.from('call_form_fields').delete().in('id', drop).eq('call_id', callId);
  if (fields.length) await admin.from('call_form_fields').upsert(fields.map((f) => fieldToRow(callId, f)), { onConflict: 'id' });
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
  await logCallEvent(admin, copy.id, 'call_duplicated', actor, { from: source.id });
  await logCallEvent(admin, source.id, 'call_duplicated_as', actor, { copy: copy.id });
  return copy;
}
