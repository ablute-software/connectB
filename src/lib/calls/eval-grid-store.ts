// Prompt 922 (I1) — the evaluation grid of a call in the database (server only): the criteria of the active version, the settings, how many evaluations were already submitted (that freezes the grid), the
// templates of the entity, the reads of a document by the platform's own reader and what the administrator corrected, and the copy a duplicated call gets. Each call's grid is its own: nothing here reads another
// call's, and a template is COPIED into a call (nothing is shared afterwards).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAuto, type AutoScore } from './eval-auto';
import { DEFAULT_SETTINGS, parseCriteriaPayload, type Criterion, type GridSettings } from './eval-grid';
import type { Call, FormField } from './types';

type Row = Record<string, unknown>;

export const rowToCriterion = (r: Row): Criterion => ({
  id: r.id as string, section: (r.section as string | null) ?? null, position: Number(r.position ?? 0), name: String(r.name ?? ''), guidance: String(r.guidance ?? ''), weight: Number(r.weight ?? 0), format: 'scale',
  scaleMin: Number(r.scale_min), scaleMax: Number(r.scale_max), levels: Array.isArray(r.levels) ? (r.levels as Criterion['levels']) : [], commentRequired: r.comment_required === true, minScore: r.min_score == null ? null : Number(r.min_score),
  linkedFields: Array.isArray(r.linked_fields) ? (r.linked_fields as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  auto: r.auto_score && typeof r.auto_score === 'object' ? (r.auto_score as AutoScore) : null, linkNotice: r.link_notice === true,
});
const criterionRow = (callId: string, version: number, c: Criterion, i: number): Row => ({
  id: c.id, call_id: callId, version, position: i, section: c.section, name: c.name, guidance: c.guidance, weight: c.weight, format: c.format, scale_min: c.scaleMin, scale_max: c.scaleMax,
  levels: c.levels, comment_required: c.commentRequired, min_score: c.minScore, linked_fields: c.linkedFields ?? [], auto_score: c.auto ?? null, link_notice: c.linkNotice === true,
});

/**
 * Whether the Etapa 3 tables exist in this database. The code ships with the migration, but the migration is applied separately, so for the time in between every evaluation route answers
 * "not available yet" instead of a raw database error — and the editor shows that sentence. One tiny query; nothing is remembered.
 */
export async function evaluationReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.from('call_eval_settings').select('call_id').limit(1);
  return !(error && /does not exist|schema cache|PGRST205|42P01/i.test(`${error.code ?? ''} ${error.message ?? ''}`));
}
export const NOT_READY_BODY = { ok: false, code: 'not_available', error: 'Evaluation is not available yet. It will be switched on shortly.' } as const;

export async function loadCriteria(admin: SupabaseClient, callId: string, version: number): Promise<Criterion[]> {
  const { data } = await admin.from('call_eval_criteria').select('*').eq('call_id', callId).eq('version', version).order('position', { ascending: true });
  return ((data ?? []) as Row[]).map(rowToCriterion);
}

export async function loadSettings(admin: SupabaseClient, callId: string): Promise<GridSettings> {
  const { data } = await admin.from('call_eval_settings').select('*').eq('call_id', callId).maybeSingle();
  const r = data as Row | null;
  if (!r) return { ...DEFAULT_SETTINGS, divergence: { ...DEFAULT_SETTINGS.divergence }, deadlines: [] };
  const d = (r.divergence && typeof r.divergence === 'object' ? r.divergence : {}) as Partial<GridSettings['divergence']>;
  return {
    evaluatorsPerApplication: r.evaluators_all === true ? 'all' : Number(r.evaluators_per_application ?? 2), blind: r.blind === true, commentRequiredForAll: r.comment_required_all === true,
    divergence: { enabled: d.enabled !== false, scalePct: Number(d.scalePct ?? 40), totalPct: Number(d.totalPct ?? 20) }, deadlines: Array.isArray(r.deadlines) ? (r.deadlines as GridSettings['deadlines']) : [],
  };
}

export async function saveSettings(admin: SupabaseClient, callId: string, s: GridSettings, actor: string): Promise<void> {
  const { error } = await admin.from('call_eval_settings').upsert({
    call_id: callId, evaluators_per_application: s.evaluatorsPerApplication === 'all' ? 2 : s.evaluatorsPerApplication, evaluators_all: s.evaluatorsPerApplication === 'all', blind: s.blind,
    comment_required_all: s.commentRequiredForAll, divergence: s.divergence, deadlines: s.deadlines, updated_by: actor, updated_at: new Date().toISOString(),
  }, { onConflict: 'call_id' });
  if (error) throw new Error(`Could not save the evaluation settings: ${error.message}`);
}

/** Evaluations of this call that already exist: started (in progress) and submitted. The first SUBMITTED one freezes the grid; any one locks "blind". */
export async function evaluationCounts(admin: SupabaseClient, callId: string): Promise<{ started: number; submitted: number }> {
  const { data } = await admin.from('call_evaluations').select('status').eq('call_id', callId);
  const rows = (data ?? []) as Row[];
  return { started: rows.length, submitted: rows.filter((r) => r.status === 'submitted').length };
}

/** Replaces the criteria of `version` (in place) — a NEW version has nothing yet. Throws when the database refuses. */
export async function writeCriteria(admin: SupabaseClient, callId: string, version: number, criteria: Criterion[]): Promise<void> {
  const del = await admin.from('call_eval_criteria').delete().eq('call_id', callId).eq('version', version);
  if (del.error) throw new Error(`Could not replace the criteria: ${del.error.message}`);
  if (criteria.length > 0) {
    const ins = await admin.from('call_eval_criteria').insert(criteria.map((c, i) => criterionRow(callId, version, c, i)));
    if (ins.error) throw new Error(`Could not save the criteria: ${ins.error.message}`);
  }
}

/** Compare-and-swap on the step's revision (and the version, when a change makes a new one). null = somebody else changed the grid meanwhile. */
export async function bumpGrid(admin: SupabaseClient, call: Call, baseRev: number, newVersion: number | null): Promise<{ rev: number; version: number } | null> {
  const patch: Row = { eval_grid_rev: baseRev + 1, updated_at: new Date().toISOString() };
  if (newVersion !== null) patch.eval_grid_version = newVersion;
  const { data } = await admin.from('calls').update(patch).eq('id', call.id).eq('eval_grid_rev', baseRev).select('eval_grid_rev, eval_grid_version');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? { rev: Number(row.eval_grid_rev), version: Number(row.eval_grid_version) } : null;
}

// --- Templates (per entity; a copy, never shared) ---------------------------------------------------------------------------------------------------

export interface TemplateRow { id: string; name: string; criteria: number; createdAt: string }
const orgCol = (call: Pick<Call, 'promoterKind' | 'promoterId'>) => (call.promoterKind === 'incubator' ? { incubator_id: call.promoterId } : { catalog_entity_id: call.promoterId });

export async function listTemplates(admin: SupabaseClient, call: Pick<Call, 'promoterKind' | 'promoterId'>): Promise<TemplateRow[]> {
  const col = call.promoterKind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('call_eval_templates').select('id, name, criteria, created_at').eq(col, call.promoterId).order('created_at', { ascending: false });
  return ((data ?? []) as Row[]).map((r) => ({ id: r.id as string, name: r.name as string, criteria: Array.isArray(r.criteria) ? (r.criteria as unknown[]).length : 0, createdAt: r.created_at as string }));
}

export async function saveTemplate(admin: SupabaseClient, call: Call, name: string, criteria: Criterion[], settings: GridSettings, actor: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const n = name.trim().slice(0, 120);
  if (!n) return { ok: false, error: 'Give the template a name.' };
  const existing = await listTemplates(admin, call);
  if (existing.some((t) => t.name.trim().toLowerCase() === n.toLowerCase())) return { ok: false, error: `The organisation already has a template called “${n}”.` };
  // Saved without ids and without anything that belongs to this call (its phases' deadlines, the people): a template is a grid, not a call.
  const { deadlines: _d, ...rest } = settings; void _d;
  const { data, error } = await admin.from('call_eval_templates').insert({ ...orgCol(call), name: n, criteria: criteria.map(({ id: _i, position: _p, ...c }) => { void _i; void _p; return c; }), settings: rest, created_by: actor }).select('id').single();
  if (error || !data) return { ok: false, error: 'Could not save the template.' };
  return { ok: true, id: (data as Row).id as string };
}

/**
 * A template is a grid, not a call: the questions its criteria were linked to belong to the call it was saved in. Used in another call, a link survives only if that question exists here (the same id, which
 * is the case when the form is the same), and a table of points only if it still fits the question. A criterion that lost a link asks to be linked to the questions of THIS call.
 */
export function relinkToForm(criteria: Criterion[], fields: Pick<FormField, 'id' | 'kind' | 'label' | 'options'>[]): Criterion[] {
  return criteria.map((c) => {
    const had = c.linkedFields ?? [];
    const linkedFields = had.filter((f) => fields.some((x) => x.id === f));
    let auto = c.auto ?? null;
    if (auto) {
      const ok = parseAuto(auto, fields.find((x) => x.id === auto!.fieldId), c, c.name);
      auto = ok.ok ? ok.auto : null;
    }
    const lost = linkedFields.length < had.length || (!!c.auto && !auto);
    return { ...c, linkedFields, auto, linkNotice: lost || (c.linkNotice === true && linkedFields.length === 0) };
  });
}

export async function templateCriteria(admin: SupabaseClient, call: Call, templateId: string, fields: Pick<FormField, 'id' | 'kind' | 'label' | 'options'>[] = []): Promise<{ criteria: Criterion[]; name: string } | null> {
  const col = call.promoterKind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('call_eval_templates').select('name, criteria').eq('id', templateId).eq(col, call.promoterId).maybeSingle();
  const r = data as Row | null;
  if (!r) return null;
  const parsed = parseCriteriaPayload(r.criteria);       // fresh ids: a use is a copy
  return parsed.ok ? { criteria: relinkToForm(parsed.criteria.map((c) => ({ ...c, id: globalThis.crypto.randomUUID() })), fields), name: r.name as string } : null;
}

export async function deleteTemplate(admin: SupabaseClient, call: Call, templateId: string): Promise<boolean> {
  const col = call.promoterKind === 'incubator' ? 'incubator_id' : 'catalog_entity_id';
  const { data } = await admin.from('call_eval_templates').delete().eq('id', templateId).eq(col, call.promoterId).select('id');
  return ((data ?? []) as Row[]).length > 0;
}

// --- A duplicated call -----------------------------------------------------------------------------------------------------------------------------------

/** A copy gets the active grid and the settings as a copy of its own (new ids, version 1). The deadlines belong to the phases of the original and are not copied. Never the evaluations or the decisions. */
export async function copyEvalGrid(admin: SupabaseClient, from: Call, toCallId: string, actor: string, fieldIdMap?: Map<string, string>): Promise<number> {
  const criteria = await loadCriteria(admin, from.id, from.evalGridVersion ?? 1);
  const settings = await loadSettings(admin, from.id);
  if (criteria.length === 0 && JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS)) return 0;
  // Duplicating the WHOLE call: its form is copied with fresh ids (`fieldIdMap`), so the links and the table of points follow the questions to their new ids.
  const remap = (id: string): string => fieldIdMap?.get(id) ?? id;
  if (criteria.length > 0) await writeCriteria(admin, toCallId, 1, criteria.map((c) => ({ ...c, id: globalThis.crypto.randomUUID(), linkedFields: (c.linkedFields ?? []).map(remap), auto: c.auto ? { ...c.auto, fieldId: remap(c.auto.fieldId) } : null })));
  await saveSettings(admin, toCallId, { ...settings, deadlines: [] }, actor);
  return criteria.length;
}

// --- Import runs -------------------------------------------------------------------------------------------------------------------------------------------

export async function saveImportRun(admin: SupabaseClient, callId: string, fileName: string, proposal: unknown, actor: string): Promise<string> {
  const { data, error } = await admin.from('call_eval_import_runs').insert({ call_id: callId, file_name: fileName.slice(0, 200), proposal, created_by: actor }).select('id').single();
  if (error || !data) throw new Error('Could not keep the reading of the document.');
  return (data as Row).id as string;
}
export async function loadImportRun(admin: SupabaseClient, callId: string, runId: string): Promise<{ id: string; proposal: unknown; status: string } | null> {
  const { data } = await admin.from('call_eval_import_runs').select('id, proposal, status').eq('id', runId).eq('call_id', callId).maybeSingle();
  const r = data as Row | null;
  return r ? { id: r.id as string, proposal: r.proposal, status: r.status as string } : null;
}
export async function markImportApplied(admin: SupabaseClient, callId: string, runId: string, corrections: unknown[]): Promise<void> {
  await admin.from('call_eval_import_runs').update({ status: 'applied', corrections, applied_at: new Date().toISOString() }).eq('id', runId).eq('call_id', callId);
}
