// Prompt 917 (Adenda 1, Part B) — what the person CHANGES in the review is the best teacher the platform has: a question whose kind they corrected, one they deleted, a label,
// the required flag, the options. This turns the difference between the proposal and what was accepted into rows to keep (per run), and those rows into the simple view the back
// office shows: the corrections that happen most often — and so which rules of the platform's own reader to improve. Pure.
import type { ProposalFieldItem } from './proposal';

export type CorrectionKind = 'field_deleted' | 'kind_changed' | 'label_changed' | 'required_changed' | 'options_changed';
export interface Correction { kind: CorrectionKind; number: string | null; source: 'internal' | 'ai' | null; detail: Record<string, unknown> }

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Compare what the engine proposed with what the person accepted (possibly edited). A proposed question that was not accepted is a deletion; an accepted one that
 * changed its kind, label, required flag or options is a correction of that kind. Only fields are compared: the call's general data and phases are not "questions".
 * Everything is keyed by the item's tmpId, which the review screen sends back unchanged.
 */
export function diffCorrections(proposed: ProposalFieldItem[], accepted: ProposalFieldItem[]): Correction[] {
  const byId = new Map(accepted.map((a) => [a.tmpId, a]));
  const out: Correction[] = [];
  for (const p of proposed) {
    const base = { number: p.number ?? null, source: p.source ?? null };
    const a = byId.get(p.tmpId);
    if (!a) { out.push({ ...base, kind: 'field_deleted', detail: { kind: p.kind, label: norm(p.label).slice(0, 120) } }); continue; }
    if (a.kind !== p.kind) out.push({ ...base, kind: 'kind_changed', detail: { from: p.kind, to: a.kind, label: norm(p.label).slice(0, 120) } });
    if (norm(a.label) !== norm(p.label)) out.push({ ...base, kind: 'label_changed', detail: { kind: a.kind } });
    if (a.required !== p.required) out.push({ ...base, kind: 'required_changed', detail: { from: p.required, to: a.required, kind: a.kind } });
    if (a.kind === p.kind && (a.kind === 'single_choice' || a.kind === 'multiple_choice') && a.options.map(norm).join('\n') !== p.options.map(norm).join('\n')) {
      out.push({ ...base, kind: 'options_changed', detail: { from: p.options.length, to: a.options.length, kind: a.kind } });
    }
  }
  return out;
}

export interface CorrectionsSummary {
  total: number;
  byKind: { kind: CorrectionKind; count: number }[];
  /** "short_text -> single_choice": the kind changes people make most, with who made the item they changed. */
  kindChanges: { from: string; to: string; count: number; internal: number; ai: number }[];
  /** The kinds of question people delete most. */
  deleted: { kind: string; count: number }[];
  bySource: { internal: number; ai: number; unknown: number };
}

/** The back office's simple view: the most frequent corrections. */
export function summariseCorrections(rows: { kind: string; source: string | null; detail: Record<string, unknown> | null }[]): CorrectionsSummary {
  const byKind = new Map<string, number>(); const changes = new Map<string, { from: string; to: string; count: number; internal: number; ai: number }>(); const deleted = new Map<string, number>();
  const bySource = { internal: 0, ai: 0, unknown: 0 };
  for (const r of rows) {
    byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    if (r.source === 'internal') bySource.internal++; else if (r.source === 'ai') bySource.ai++; else bySource.unknown++;
    const d = r.detail ?? {};
    if (r.kind === 'kind_changed') {
      const from = String(d.from ?? '?'); const to = String(d.to ?? '?'); const k = `${from}>${to}`;
      const c = changes.get(k) ?? { from, to, count: 0, internal: 0, ai: 0 };
      c.count++; if (r.source === 'internal') c.internal++; else if (r.source === 'ai') c.ai++;
      changes.set(k, c);
    }
    if (r.kind === 'field_deleted') { const k = String(d.kind ?? '?'); deleted.set(k, (deleted.get(k) ?? 0) + 1); }
  }
  const sorted = <T extends { count: number }>(xs: T[]) => xs.sort((a, b) => b.count - a.count);
  return {
    total: rows.length,
    byKind: sorted([...byKind].map(([kind, count]) => ({ kind: kind as CorrectionKind, count }))),
    kindChanges: sorted([...changes.values()]).slice(0, 15),
    deleted: sorted([...deleted].map(([kind, count]) => ({ kind, count }))).slice(0, 10),
    bySource,
  };
}
