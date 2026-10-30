// Prompt 922 (Adenda 1, B) — the questions of the form as the grid sees them, pure: numbered in the order the applicant meets them, grouped by page, with what each one can do for a criterion (be read beside it, or
// score it by itself); which criteria each question is linked to ("what is left unevaluated"); and, for a grid read from a document, the questions a criterion's text clearly points to — only ever PROPOSED.
import { isAutoField } from './eval-auto';
import type { Criterion } from './eval-grid';
import type { FormField } from './types';

export interface LinkableField { id: string; number: number; page: number; label: string; kind: FormField['kind']; options: { id: string; label: string }[]; canScore: boolean; condition: boolean }

/** Every question of the form, numbered 1…N in the order of the form (page, then position). The layout-only ones do not exist in this model; a group or a table is one question. */
export function linkableFields(fields: Pick<FormField, 'id' | 'page' | 'position' | 'kind' | 'label' | 'options' | 'condition'>[]): LinkableField[] {
  return [...fields].sort((a, b) => a.page - b.page || a.position - b.position)
    .map((f, i) => ({ id: f.id, number: i + 1, page: f.page, label: f.label, kind: f.kind, options: f.options.map((o) => ({ id: o.id, label: o.label })), canScore: isAutoField(f), condition: !!f.condition }));
}

export const fieldTitle = (f: Pick<LinkableField, 'number' | 'label'>): string => `${f.number}. ${f.label}`;

/** The pages of the form with their questions, for the picker and the side panel. */
export function byPage(fields: LinkableField[]): { page: number; fields: LinkableField[] }[] {
  const pages: { page: number; fields: LinkableField[] }[] = [];
  for (const f of fields) {
    const last = pages[pages.length - 1];
    if (last && last.page === f.page) last.fields.push(f); else pages.push({ page: f.page, fields: [f] });
  }
  return pages;
}

/** For each question, the criteria it is linked to — so the panel shows what the grid leaves unevaluated. */
export function criteriaByField(criteria: Pick<Criterion, 'id' | 'name' | 'linkedFields'>[]): Map<string, { id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }[]>();
  for (const c of criteria) for (const f of c.linkedFields ?? []) { const l = out.get(f) ?? []; l.push({ id: c.id, name: c.name }); out.set(f, l); }
  return out;
}

// --- Proposals for a grid read from a document ---------------------------------------------------------------------------------------------------

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'your', 'you', 'is', 'are', 'what', 'how', 'do', 'does', 'de', 'da', 'do', 'das', 'dos', 'e', 'o', 'a', 'os', 'as', 'um', 'uma', 'para', 'com', 'que', 'em', 'no', 'na', 'del', 'la', 'el', 'los', 'las', 'y', 'le', 'les', 'des', 'du', 'et', 'der', 'die', 'das', 'und']);
const words = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * The questions a criterion's text CLEARLY points to: the question's words are (nearly) all in the criterion's name, or the criterion's name is (nearly) all in the question. Two words at least, and a question that
 * stands alone as the best match; otherwise nothing — a wrong link is worse than none. The result is a proposal the administrator sees and accepts; it is never applied by itself.
 */
export function suggestLinks(criterionName: string, fields: Pick<LinkableField, 'id' | 'label'>[]): string[] {
  const a = new Set(words(criterionName));
  if (a.size === 0) return [];
  const scored = fields.map((f) => {
    const b = new Set(words(f.label));
    const common = [...a].filter((w) => b.has(w)).length;
    const cover = b.size ? common / b.size : 0;           // how much of the question the criterion says
    const reach = common / a.size;                         // how much of the criterion the question has
    return { id: f.id, common, whole: b.size === 1, score: Math.max(cover, reach) };
  }).filter((x) => x.common >= 2 || (x.common === 1 && x.whole && x.score === 1)).filter((x) => x.score >= 0.6).sort((x, y) => y.score - x.score || y.common - x.common);
  if (scored.length === 0) return [];
  if (scored.length > 1 && scored[0].score === scored[1].score && scored[0].common === scored[1].common) return [];      // two equally good: no clear match
  return [scored[0].id];
}
