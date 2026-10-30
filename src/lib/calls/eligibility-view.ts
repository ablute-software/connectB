// Prompt 918 (I2) — what the Eligibility step shows, built in one place (pure) so the route and the tests read the same thing: each rule with its sentence, its problems and — for a document rule — the
// recipe in plain lines; the suggestions; the questions a rule may be tied to; and whether the rules can be changed now, and how.
import { DOC_TYPES, recipeLines, type DocRecipe } from './doc-recipe';
import { RULE_KIND_LABELS, allowedKinds, ruleProblems, ruleSentence, type EligibilityRule, type RuleKind } from './eligibility';
import type { Call, CallStatus, FieldOption, FormField } from './types';

/**
 * How the rules can be changed in each state of the call:
 *   edit       the call is being set up: the rules are edited in place;
 *   locked     confirmed or scheduled: like the form, "Edit configuration" first;
 *   versioned  the call has opened: they are frozen — a change makes a NEW version and the applications are evaluated again;
 *   archived   nothing changes.
 */
export type RulesMode = 'edit' | 'locked' | 'versioned' | 'archived';
export function rulesMode(status: CallStatus): RulesMode {
  if (status === 'draft') return 'edit';
  if (status === 'validated' || status === 'scheduled') return 'locked';
  if (status === 'archived') return 'archived';
  return 'versioned';
}

export interface RuleView {
  id: string; fieldId: string; fieldLabel: string; fieldKind: FormField['kind']; kind: RuleKind; kindLabel: string; params: EligibilityRule['params']; note: string | null; applicantText: string;
  sentence: string; problems: string[];
  /** "How we check this document": read-only lines, for a document rule. */
  recipe: string[] | null;
}
export interface QuestionOption { id: string; label: string; kind: FormField['kind']; options: FieldOption[]; allowed: RuleKind[]; page: number }

export interface EligibilityView {
  version: number; rev: number; mode: RulesMode;
  rules: RuleView[];
  suggestions: string[];
  questions: QuestionOption[];
  docTypes: { key: string; label: string }[];
  /** Submitted applications: what a change after opening evaluates again. */
  submitted: number;
}

export function buildEligibilityView(input: {
  call: Call; fields: FormField[]; rules: EligibilityRule[]; recipes: { ruleId: string; recipe: DocRecipe }[]; suggestions: string[]; submitted: number;
}): EligibilityView {
  const { call, fields } = input;
  const labelOfDoc = (key: string | null) => DOC_TYPES.find((d) => d.key === key)?.label ?? null;
  const ordered = [...fields].sort((a, b) => a.page - b.page || a.position - b.position);
  return {
    version: call.eligibilityVersion ?? 1, rev: call.eligibilityRev ?? 0, mode: rulesMode(call.status),
    rules: input.rules.map((r) => {
      const field = fields.find((f) => f.id === r.fieldId);
      const stored = input.recipes.find((x) => x.ruleId === r.id)?.recipe;
      return {
        id: r.id, fieldId: r.fieldId, fieldLabel: field?.label ?? '(question removed)', fieldKind: field?.kind ?? 'short_text', kind: r.kind, applicantText: r.applicantText ?? '', kindLabel: RULE_KIND_LABELS[r.kind], params: r.params, note: r.note,
        sentence: ruleSentence(r, field, { currency: call.currency, call, docTypeLabel: labelOfDoc }), problems: ruleProblems(r, fields, call),
        recipe: stored ? recipeLines(stored) : null,
      };
    }),
    suggestions: input.suggestions,
    questions: ordered.map((f) => ({ id: f.id, label: f.label, kind: f.kind, options: f.options, allowed: allowedKinds(f.kind), page: f.page })),
    docTypes: DOC_TYPES.map((d) => ({ key: d.key, label: d.label })),
    submitted: input.submitted,
  };
}
