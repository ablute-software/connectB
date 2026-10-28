// Prompt 918 (I2) — the rules of a call in the database: reading the active version, replacing it (in place while the call is being set up, as a NEW version once it has opened), the recipes prepared for
// the document rules, the suggestions the import left for later, and the copy a duplicated call gets. Server only. Each call's rules and recipes are its own: nothing here reads another call's.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { prepareRecipe, type DocRecipe } from './doc-recipe';
import { isDocKind, ruleSentence, ruleProblems, type EligibilityRule, type RuleKind, type RuleParams } from './eligibility';
import type { Call, FormField } from './types';

type Row = Record<string, unknown>;

export const rowToRule = (r: Row): EligibilityRule => ({
  id: r.id as string, fieldId: r.field_id as string, kind: r.kind as RuleKind, params: ((r.params && typeof r.params === 'object' ? r.params : {}) as RuleParams),
  note: (r.note as string | null) ?? null, position: Number(r.position ?? 0),
});

/** The rules in force (or, for the record, those of another version). */
export async function loadRules(admin: SupabaseClient, callId: string, version: number): Promise<EligibilityRule[]> {
  const { data } = await admin.from('call_eligibility_rules').select('*').eq('call_id', callId).eq('version', version).order('position', { ascending: true });
  return ((data ?? []) as Row[]).map(rowToRule);
}

export interface StoredRecipe { ruleId: string; fieldId: string; recipe: DocRecipe; sourceText: string; preparedAt: string }

export async function loadRecipes(admin: SupabaseClient, callId: string, version: number): Promise<StoredRecipe[]> {
  const { data } = await admin.from('call_eligibility_recipes').select('*').eq('call_id', callId).eq('version', version);
  return ((data ?? []) as Row[]).map((r) => ({ ruleId: r.rule_id as string, fieldId: r.field_id as string, recipe: r.recipe as DocRecipe, sourceText: (r.source_text as string) ?? '', preparedAt: (r.prepared_at as string) ?? '' }));
}

/** How many rules are in force and how many cannot work (the Setup step's state and "What is missing"). */
export async function eligibilitySummary(admin: SupabaseClient, call: Call, fields: FormField[]): Promise<{ rules: number; broken: number }> {
  const rules = await loadRules(admin, call.id, call.eligibilityVersion ?? 1);
  return { rules: rules.length, broken: rules.filter((r) => ruleProblems(r, fields, call).length > 0).length };
}

/** Plain text of a rule for the history ("before and after"). */
export const rulesAsText = (rules: EligibilityRule[], fields: FormField[], call: Call): string[] =>
  rules.map((r) => ruleSentence(r, fields.find((f) => f.id === r.fieldId), { currency: call.currency, call }));

const ruleRow = (callId: string, version: number, r: EligibilityRule, actor: string): Row => ({
  id: r.id, call_id: callId, version, field_id: r.fieldId, kind: r.kind, params: r.params, note: r.note, position: r.position, created_by: actor,
});

/** The recipe row of a document rule, prepared from the entity's own text. */
function recipeRowFor(callId: string, version: number, r: EligibilityRule, fields: FormField[]): Row | null {
  if (!isDocKind(r.kind)) return null;
  const field = fields.find((f) => f.id === r.fieldId);
  if (!field) return null;
  const { recipe, sourceText } = prepareRecipe(r, field, fields);
  return { call_id: callId, rule_id: r.id, field_id: r.fieldId, version, recipe, source_text: sourceText };
}

/**
 * Writes the rules of `version` (replacing what was there: while the call is being set up the active version is edited in place; for a NEW version there is nothing yet) and prepares the recipes of the
 * document rules. Throws if the database refuses — a save that says "ok" with nothing stored is how things go missing.
 */
export async function writeRules(admin: SupabaseClient, call: Call, version: number, rules: EligibilityRule[], fields: FormField[], actor: string): Promise<void> {
  const del1 = await admin.from('call_eligibility_rules').delete().eq('call_id', call.id).eq('version', version);
  if (del1.error) throw new Error(`Could not replace the rules: ${del1.error.message}`);
  const del2 = await admin.from('call_eligibility_recipes').delete().eq('call_id', call.id).eq('version', version);
  if (del2.error) throw new Error(`Could not replace the recipes: ${del2.error.message}`);
  if (rules.length > 0) {
    const ins = await admin.from('call_eligibility_rules').insert(rules.map((r, i) => ruleRow(call.id, version, { ...r, position: i }, actor)));
    if (ins.error) throw new Error(`Could not save the rules: ${ins.error.message}`);
    const recipes = rules.map((r) => recipeRowFor(call.id, version, r, fields)).filter((x): x is Row => !!x);
    if (recipes.length > 0) {
      const rec = await admin.from('call_eligibility_recipes').insert(recipes);
      if (rec.error) throw new Error(`Could not save the recipes: ${rec.error.message}`);
    }
  }
}

/** Compare-and-swap on the step's revision (and the version, when a change makes a new one). null = somebody else changed the rules meanwhile. */
export async function bumpRules(admin: SupabaseClient, call: Call, baseRev: number, newVersion: number | null): Promise<{ rev: number; version: number } | null> {
  const patch: Row = { eligibility_rev: baseRev + 1, updated_at: new Date().toISOString() };
  if (newVersion !== null) patch.eligibility_version = newVersion;
  const { data } = await admin.from('calls').update(patch).eq('id', call.id).eq('eligibility_rev', baseRev).select('eligibility_rev, eligibility_version');
  const row = (data ?? [])[0] as Row | undefined;
  return row ? { rev: Number(row.eligibility_rev), version: Number(row.eligibility_version) } : null;
}

// --- Suggestions from the import ---------------------------------------------------------------------------------------------------------------

/** What the import found for the eligibility step ("Suggested rules"): its text, minus what the entity dismissed and what already is a rule. Nothing becomes a rule without a click. */
export async function loadSuggestions(admin: SupabaseClient, callId: string, rules: EligibilityRule[]): Promise<string[]> {
  const [runs, dismissed] = await Promise.all([
    admin.from('call_import_runs').select('found_later, created_at').eq('call_id', callId).order('created_at', { ascending: false }).limit(10),
    admin.from('call_eligibility_dismissed').select('text').eq('call_id', callId),
  ]);
  const gone = new Set(((dismissed.data ?? []) as Row[]).map((r) => norm(r.text as string)));
  for (const r of rules) { if (r.note) gone.add(norm(r.note)); const t = (r.params as { text?: string }).text; if (t) gone.add(norm(t)); }
  const out: string[] = [];
  for (const run of (runs.data ?? []) as Row[]) {
    const found = (run.found_later as { eligibility?: unknown } | null)?.eligibility;
    if (!Array.isArray(found)) continue;
    for (const t of found) if (typeof t === 'string' && t.trim() && !gone.has(norm(t)) && !out.some((o) => norm(o) === norm(t))) out.push(t.trim().slice(0, 600));
  }
  return out.slice(0, 40);
}
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

export async function dismissSuggestion(admin: SupabaseClient, callId: string, text: string, actor: string): Promise<void> {
  await admin.from('call_eligibility_dismissed').upsert({ call_id: callId, text: text.trim().slice(0, 600), dismissed_by: actor }, { onConflict: 'call_id,text' });
}

// --- A duplicated call ---------------------------------------------------------------------------------------------------------------------------

/** A copy gets the active rules and their recipes AS A COPY OF ITS OWN (new ids, version 1, its own questions' ids are the same because the form is copied with fresh ids — see `fieldIdMap`). */
export async function copyEligibility(admin: SupabaseClient, fromCall: Call, toCallId: string, fieldIdMap: Map<string, string>, actor: string): Promise<number> {
  const rules = await loadRules(admin, fromCall.id, fromCall.eligibilityVersion ?? 1);
  if (rules.length === 0) return 0;
  const recipes = await loadRecipes(admin, fromCall.id, fromCall.eligibilityVersion ?? 1);
  const idMap = new Map<string, string>();
  const rows: Row[] = [];
  for (const r of rules) {
    const field = fieldIdMap.get(r.fieldId);
    if (!field) continue;
    const id = globalThis.crypto.randomUUID(); idMap.set(r.id, id);
    // A document comparison points at another question of the form: it follows the copy.
    const params = { ...(r.params as Record<string, unknown>) };
    for (const k of ['matchName', 'matchTaxId']) if (typeof params[k] === 'string') params[k] = fieldIdMap.get(params[k] as string) ?? null;
    rows.push({ id, call_id: toCallId, version: 1, field_id: field, kind: r.kind, params, note: r.note, position: r.position, created_by: actor });
  }
  if (rows.length === 0) return 0;
  const ins = await admin.from('call_eligibility_rules').insert(rows);
  if (ins.error) throw new Error(`Could not copy the rules: ${ins.error.message}`);
  const recRows = recipes.filter((x) => idMap.has(x.ruleId)).map((x) => ({ call_id: toCallId, rule_id: idMap.get(x.ruleId)!, field_id: fieldIdMap.get(x.fieldId)!, version: 1, recipe: x.recipe, source_text: x.sourceText }));
  if (recRows.length > 0) {
    const rec = await admin.from('call_eligibility_recipes').insert(recRows);
    if (rec.error) throw new Error(`Could not copy the recipes: ${rec.error.message}`);
  }
  return rows.length;
}
