// Prompt 917 (I2) — a proposal never says the same thing twice. The reading in parallel parts (and the platform's own reader next to the AI) could produce the same
// question, or the same warning, more than once: question 6.3 twice, the competitor table twice. Pure; applied to every proposal, whoever made it.
import type { AttentionItem, ProposalFieldItem } from './proposal';

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The number a warning is about ("6.5 asked for 4 documents" -> "6.5"; "“2.10.2” in the label" -> "2.10.2"; "4.4/2" -> "4.4"). */
export function numberOf(text: string): string | null {
  const m = /^[\s“"'(]*((?:\d+\.)*\d+[a-z]?)(?:\/\d+)?(?=[\s”"'):.,;]|$)/i.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** At most ONE warning per question number (and one per identical text when there is no number). A "not covered" outranks an "out of date", which outranks a "done". */
export function dedupeAttention(items: AttentionItem[]): AttentionItem[] {
  const rank: Record<AttentionItem['kind'], number> = { not_covered: 0, outdated: 1, done: 2 };
  const out: AttentionItem[] = []; const at = new Map<string, number>();
  for (const a of items) {
    const key = numberOf(a.what) ?? `t:${norm(a.what)}`;
    const i = at.get(key);
    if (i === undefined) { at.set(key, out.length); out.push(a); continue; }
    if (rank[a.kind] < rank[out[i].kind]) out[i] = a;
  }
  return out;
}

export interface Deduped { fields: ProposalFieldItem[]; removed: string[] }

/**
 * No question appears twice. The same number is the same question (the first is kept); with no number, the same text and kind. A follow-up made from a question ("4.4/2")
 * is a question of its own. What was removed is returned, to be recorded on the run.
 */
export function dedupeFields(fields: ProposalFieldItem[]): Deduped {
  const seen = new Set<string>(); const removed: string[] = []; const out: ProposalFieldItem[] = [];
  for (const f of fields) {
    // The AI often writes the number in the label ("1.2 Morada") without giving it as a field: that is the same question as the platform's 1.2.
    const num = f.number ?? /^((?:\d+\.)+\d+)(?=\s)/.exec(f.label)?.[1] ?? null;
    const key = num ? `n:${num}` : `l:${f.kind}:${norm(f.label)}`;
    if (seen.has(key)) { removed.push(num ?? f.label); continue; }
    seen.add(key); out.push(f);
  }
  // A condition that pointed at a removed duplicate is dropped rather than left dangling (the sanitiser does the same when it re-reads the list).
  const ids = new Set(out.map((f) => f.tmpId));
  return { fields: out.map((f) => (f.condition && !ids.has(f.condition.tmpId) ? { ...f, condition: null } : f)), removed };
}
