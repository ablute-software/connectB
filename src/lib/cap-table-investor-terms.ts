// Prompt 432 §E — pure schema + parsing for the convertible-note "Watson
// Review" single-document read. Same discipline as the deleted
// cap-table-ai-fill.ts (Prompt 431, removed with the multi-doc mode):
// never trust the model's raw output shape, validate every field before it
// reaches the form. Adapted here for ONE set of investor terms (not a list
// of cap table rows), where "everything is null" is the CORRECT, expected
// answer whenever the document doesn't state a fixed percentage or an
// exact trigger yet — never estimate one.
//
// No `today` parameter (unlike the deleted sibling's asOf default) — none
// of these fields have an "if missing, default to today" fallback; a
// missing conversionDate/pct/label just stays null, for the founder to
// fill in by hand.
export const CAP_TABLE_INVESTOR_TERMS_TOOL_SCHEMA = {
  name: 'report_investor_terms',
  description:
    'Report only what is literally stated in this one document about the '
    + 'investor and the conversion trigger. Never infer, guess, or compute a '
    + 'percentage or a date that is not explicitly written. A convertible '
    + 'instrument with no fixed percentage yet is correct as null — that is '
    + 'the right answer, not a failure.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: ['string', 'null'], description: "The investing entity or individual's name, exactly as written. Null if not stated." },
      pct: { type: ['number', 'null'], description: 'Ownership percentage, 0-100, ONLY if a specific number is explicitly stated. Null otherwise — do not estimate.' },
      conversionTriggerType: { type: ['string', 'null'], enum: ['date', 'event', null] },
      conversionDate: { type: ['string', 'null'], description: 'ISO date (YYYY-MM-DD) ONLY if an explicit date, month, or quarter is stated. Null otherwise.' },
      conversionEvent: { type: ['string', 'null'], description: 'The triggering event exactly as described (e.g. "next priced round", "Series A close"). Null if a date was given instead, or no trigger is stated.' },
      sourceNote: { type: ['string', 'null'] },
    },
    required: ['label', 'pct', 'conversionTriggerType', 'conversionDate', 'conversionEvent', 'sourceNote'],
  },
} as const;

export interface CapTableInvestorTermsResult {
  label: string | null;
  pct: number | null;
  conversionTriggerType: 'date' | 'event' | null;
  conversionDate: string | null;
  conversionEvent: string | null;
  sourceNote: string | null;
}

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function rawInvestorTermsToResult(raw: unknown): CapTableInvestorTermsResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as {
    label?: unknown; pct?: unknown; conversionDate?: unknown; conversionEvent?: unknown; sourceNote?: unknown;
  };

  const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : null;

  const pct = typeof r.pct === 'number' && Number.isFinite(r.pct) ? Math.max(0, Math.min(100, r.pct)) : null;

  const conversionDate = isIsoDate(r.conversionDate) ? r.conversionDate : null;
  const conversionEvent = typeof r.conversionEvent === 'string' && r.conversionEvent.trim() ? r.conversionEvent.trim() : null;

  // Never trust the model's own conversionTriggerType field blindly —
  // derive the real trigger from whichever of date/event actually came
  // through populated ("corrige para o que realmente veio preenchido").
  // Both populated at once shouldn't happen given the tool schema's own
  // guidance, but resolves deterministically (date wins) rather than
  // silently keeping an invalid dual-trigger combination.
  const conversionTriggerType: 'date' | 'event' | null = conversionDate ? 'date' : conversionEvent ? 'event' : null;

  const sourceNote = typeof r.sourceNote === 'string' && r.sourceNote.trim() ? r.sourceNote.trim() : null;

  return {
    label, pct, conversionTriggerType,
    conversionDate: conversionTriggerType === 'date' ? conversionDate : null,
    conversionEvent: conversionTriggerType === 'event' ? conversionEvent : null,
    sourceNote,
  };
}
