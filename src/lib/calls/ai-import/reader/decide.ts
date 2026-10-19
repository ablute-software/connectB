// Prompt 917 (Adenda 1, Part B) — what the quality of the platform's own reading decides: is it enough on its own, does the AI get only the parts that failed, or the whole text.
// The thresholds are constants so they can be tuned without touching anything else (Nuno, 15/10/2026).
import type { ProposalFieldItem } from '../proposal';
import type { ReaderQuality, ReaderResult, UnresolvedBlock } from './read-form';

export const READER_THRESHOLDS = {
  /** At least this share of the numbered items must have become a question (or a section, or part of one) … */
  coverage: 0.95,
  /** … at least this share of the questions must have their kind from a clear rule … */
  typeConfidence: 0.8,
  /** … and nothing may be left unresolved. Below this coverage the document is not a form the reader understands: the AI gets the WHOLE text. */
  wholeDocumentBelow: 0.6,
} as const;

export type ImportMode = 'internal' | 'internal+ai' | 'ai';

export interface Decision { mode: ImportMode; reasons: string[] }

export function decide(q: ReaderQuality, t: typeof READER_THRESHOLDS = READER_THRESHOLDS): Decision {
  const reasons: string[] = [];
  if (q.questions === 0 || q.coverage < t.wholeDocumentBelow) {
    return { mode: 'ai', reasons: [`the platform could read only ${Math.round(q.coverage * 100)}% of the numbered items (below ${Math.round(t.wholeDocumentBelow * 100)}%)`] };
  }
  if (q.coverage < t.coverage) reasons.push(`coverage ${Math.round(q.coverage * 100)}% is below ${Math.round(t.coverage * 100)}%`);
  if (q.typeConfidence < t.typeConfidence) reasons.push(`only ${Math.round(q.typeConfidence * 100)}% of the question types came from a clear rule (below ${Math.round(t.typeConfidence * 100)}%)`);
  for (const u of q.unresolved) reasons.push(`a part could not be read: “${u.title}”`);
  return { mode: reasons.length === 0 ? 'internal' : 'internal+ai', reasons };
}

/** One piece of the form the AI is asked about: a structure the reader could not read, or questions whose kind it was not sure of. */
export interface AiPart {
  id: string;
  kind: 'block' | 'items';
  /** Human words for the run's record ("page 6: Exemplo - template…", "5.3, 6.4.3"). */
  label: string;
  /** The text of the part: all the AI sees of the form (never the rest of the document). */
  text: string;
  /** Where the questions made from a block are placed: after this numbered question. */
  afterNumber: string | null;
  /** For items: the numbers of the questions the AI may correct. */
  numbers: string[];
}

const MAX_PART_CHARS = 6000;

/**
 * The parts the AI is given in "internal + AI": every unresolved block, and — only when the kinds were not trusted enough — the questions that got theirs from a guess.
 * Each part carries the text of what it is about and, for questions, the platform's own reading of them, so the AI corrects rather than starts over.
 */
export function aiParts(result: ReaderResult, d: Decision): AiPart[] {
  const parts: AiPart[] = result.quality.unresolved.map((u: UnresolvedBlock, i): AiPart => ({
    id: `block:${i + 1}`, kind: 'block', label: `page ${u.page}: ${u.title}`, text: u.text.slice(0, MAX_PART_CHARS), afterNumber: u.afterNumber, numbers: [],
  }));
  const lowConfidence = result.quality.typeConfidence < READER_THRESHOLDS.typeConfidence;
  if (lowConfidence && result.quality.weak.length > 0) {
    const weak = new Set(result.quality.weak);
    const byNum = result.fields.filter((f) => f.number && weak.has(f.number));
    const sec = (f: ProposalFieldItem) => result.sections.find((s) => s.page === f.page);
    const text = byNum.map((f) => {
      const own = sec(f)?.text.split('\n').find((l) => l.startsWith(`${f.number} `)) ?? f.label;
      return `${own}\n  (the platform read it as: ${f.kind}${f.options.length ? `, options ${f.options.join(' | ')}` : ''})`;
    }).join('\n').slice(0, MAX_PART_CHARS);
    parts.push({ id: 'items:1', kind: 'items', label: `questions ${byNum.map((f) => f.number).join(', ')}`, text, afterNumber: null, numbers: byNum.map((f) => f.number as string) });
  }
  void d;
  return parts;
}
