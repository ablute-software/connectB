// Prompt 426 §B — pure schema + parsing for "Watson, help me build it" (cap
// table). Sibling to team-ai-fill.ts, same discipline (never trust the
// model's output shape — validate every field before it becomes a draft
// row), adapted for financial data: category is a closed enum to check
// against rather than a free-form roster name to match, and there is no
// "never invent a person" guard to apply since a named investor/adviser
// here doesn't have to already exist anywhere else in the app.
import type { CapTableEntry } from './types';

export interface CapTableFillEntry {
  category: CapTableEntry['category']; label: string; pct: number; asOf: string; sourceNote: string | null;
}
export interface CapTableFillResult { entries: CapTableFillEntry[] }

const CATEGORIES: CapTableEntry['category'][] = ['founder', 'option_pool', 'adviser', 'investor'];

export const CAP_TABLE_FILL_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      description: 'One entry per cap table line item with a literal, explicitly stated percentage in the attached '
        + 'documents. Return an empty array if the documents do not contain a clear ownership breakdown — never '
        + 'estimate one, and never complete a partial breakdown up to 100%.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES, description: 'Which kind of holder this line is.' },
          label: { type: 'string', description: 'Name of the founder, option pool, adviser, or investor, as stated in the document.' },
          pct: { type: 'number', description: 'The ownership percentage literally stated in the document — never inferred or computed from other numbers.' },
          as_of: { type: 'string', description: 'The date this breakdown is stated as of, if given (YYYY-MM-DD). Omit if not stated.' },
          source_note: { type: 'string', description: 'A short quote or page/section reference where you found this figure, so the founder can verify it without reopening the document.' },
        },
        required: ['category', 'label', 'pct'],
      },
    },
  },
  required: ['entries'],
};

interface RawEntry { category?: unknown; label?: unknown; pct?: unknown; as_of?: unknown; source_note?: unknown }

function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// `today` is injected rather than read from the clock here, same discipline
// as sherlockNext(db, now)/followUpTaskDisplayTitle(task, now) elsewhere in
// this codebase — keeps this a pure, deterministic function.
export function rawCapTableFillToResult(raw: unknown, today: string): CapTableFillResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { entries?: unknown };
  if (!Array.isArray(r.entries)) return { entries: [] };
  const out: CapTableFillEntry[] = [];
  for (const e of r.entries as RawEntry[]) {
    if (!e || typeof e.label !== 'string' || !e.label.trim()) continue;
    if (typeof e.category !== 'string' || !CATEGORIES.includes(e.category as CapTableEntry['category'])) continue;
    if (typeof e.pct !== 'number' || !Number.isFinite(e.pct) || e.pct < 0 || e.pct > 100) continue;
    out.push({
      category: e.category as CapTableEntry['category'],
      label: e.label.trim(),
      pct: e.pct,
      asOf: isIsoDate(e.as_of) ? e.as_of : today,
      sourceNote: typeof e.source_note === 'string' && e.source_note.trim() ? e.source_note.trim() : null,
    });
  }
  return { entries: out };
}
