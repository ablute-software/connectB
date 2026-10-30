// Prompt 922 (Adenda 1, C) — the way the load of the evaluation is shared (Equal / Weighted / By rules), per call, in the database (server only). The configuration is kept per call and per VERSION: it is edited in
// place until the first evaluation is SUBMITTED; from then on a change makes a new version (like the grid), asks first, and what was already submitted is never touched. A duplicated call gets a copy of its own,
// with the rules pointing to the questions of the copy. Nothing here reads another call.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_ALLOC, freshAlloc, parseAlloc, type AllocConfig } from './eval-allocation';

type Row = Record<string, unknown>;
export interface AllocState { config: AllocConfig; version: number; rev: number }
const NOT_THERE = /does not exist|schema cache|PGRST205|42P01/i;

/** The configuration in force: the latest version. A call that never chose has the equal distribution, as always (and a database without the table answers the same). */
export async function loadAlloc(admin: SupabaseClient, callId: string): Promise<AllocState> {
  const { data, error } = await admin.from('call_eval_distribution_configs').select('version, rev, config').eq('call_id', callId).order('version', { ascending: false }).limit(1);
  if (error && NOT_THERE.test(`${error.code ?? ''} ${error.message ?? ''}`)) return { config: freshAlloc(), version: 1, rev: 0 };
  const r = (data ?? [])[0] as Row | undefined;
  if (!r) return { config: freshAlloc(), version: 1, rev: 0 };
  const parsed = parseAlloc(r.config);
  return { config: parsed.ok ? parsed.config : { ...DEFAULT_ALLOC }, version: Number(r.version ?? 1), rev: Number(r.rev ?? 0) };
}

export type SaveAlloc = { ok: true; state: AllocState; versioned: boolean } | { ok: false; status: number; code?: string; error: string; extra?: Record<string, unknown> };

/**
 * Saves the configuration. `submitted` = how many evaluations were already submitted: with any, a change that differs makes a NEW version and needs the administrator's confirmation first (the answer names how many
 * evaluations stay as they are). `baseRev` is the revision the editor read: somebody else's change in between is refused, never overwritten.
 */
export async function saveAlloc(admin: SupabaseClient, callId: string, baseRev: number, config: AllocConfig, actor: string, opts: { submitted: number; confirm: boolean }): Promise<SaveAlloc> {
  const cur = await loadAlloc(admin, callId);
  if (cur.rev !== baseRev) return { ok: false, status: 409, code: 'conflict', error: 'Someone else changed the distribution rules. Reload to see their changes.' };
  if (JSON.stringify(cur.config) === JSON.stringify(config)) return { ok: true, state: cur, versioned: false };
  const now = new Date().toISOString();
  if (opts.submitted > 0) {
    if (!opts.confirm) {
      return { ok: false, status: 409, code: 'needs_confirm', error: `${opts.submitted} evaluation${opts.submitted === 1 ? ' was' : 's were'} already submitted. This change makes version ${cur.version + 1} of the distribution rules; what was already evaluated stays as it is, and the screen shows what would move before anything is applied.`, extra: { nextVersion: cur.version + 1, evaluations: opts.submitted } };
    }
    const ins = await admin.from('call_eval_distribution_configs').insert({ call_id: callId, version: cur.version + 1, rev: 0, config, created_by: actor, updated_at: now });
    if (ins.error) return { ok: false, status: 409, code: 'conflict', error: 'Someone else changed the distribution rules. Reload to see their changes.' };
    return { ok: true, state: { config, version: cur.version + 1, rev: 0 }, versioned: true };
  }
  if (cur.rev === 0 && !(await hasRow(admin, callId))) {
    const ins = await admin.from('call_eval_distribution_configs').insert({ call_id: callId, version: 1, rev: 1, config, created_by: actor, updated_at: now });
    if (ins.error) return { ok: false, status: 500, error: 'The distribution rules could not be saved. Please try again.' };
    return { ok: true, state: { config, version: 1, rev: 1 }, versioned: false };
  }
  const upd = await admin.from('call_eval_distribution_configs').update({ config, rev: cur.rev + 1, updated_at: now }).eq('call_id', callId).eq('version', cur.version).eq('rev', cur.rev).select('rev');
  if (upd.error || (upd.data ?? []).length === 0) return { ok: false, status: 409, code: 'conflict', error: 'Someone else changed the distribution rules. Reload to see their changes.' };
  return { ok: true, state: { config, version: cur.version, rev: cur.rev + 1 }, versioned: false };
}

async function hasRow(admin: SupabaseClient, callId: string): Promise<boolean> {
  const { data } = await admin.from('call_eval_distribution_configs').select('version').eq('call_id', callId).limit(1);
  return ((data ?? []) as Row[]).length > 0;
}

/** A duplicated call gets the rules in force as a copy of its own; the rules about the form follow the questions to their new ids, and a rule about a question that was not copied is dropped. The people are the same: the team is copied too. */
export async function copyAlloc(admin: SupabaseClient, from: { id: string }, toCallId: string, fieldIdMap: Map<string, string>, actor: string): Promise<boolean> {
  const cur = await loadAlloc(admin, from.id);
  if (cur.config.strategy === 'equal' && cur.config.panels.length === 0 && cur.config.rules.length === 0 && Object.keys(cur.config.weighted.percent).length === 0 && Object.keys(cur.config.weighted.max).length === 0) return false;
  const config: AllocConfig = {
    ...cur.config,
    rules: cur.config.rules.map((r) => ({ ...r, conditions: r.conditions.flatMap((c) => { const f = fieldIdMap.get(c.fieldId); return f ? [{ ...c, fieldId: f }] : []; }) })),
  };
  const ins = await admin.from('call_eval_distribution_configs').insert({ call_id: toCallId, version: 1, rev: 1, config, created_by: actor });
  return !ins.error;
}
