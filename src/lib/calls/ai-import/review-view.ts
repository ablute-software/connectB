// Prompt 917 (I2, Adenda 1) — what the review screen says about a proposed question beyond its kind: the condition it carries, how a File or a Link is configured, what a
// repeatable group is made of, and — discreetly — who made it (the platform's own reader or the AI provider). Pure: the screen only draws these lines.
import { URL_HINT_LABELS } from '../types';
import { fileFormatsOf, formatsText, maxFileMbOf, maxFilesOf } from '../field-config';
import type { ProposalFieldItem } from './proposal';
import type { RunMeta } from './screen-state';

export const SOURCE_LABEL = { internal: 'read by our platform', ai: 'completed by our AI provider' } as const;
export const sourceLabel = (s: ProposalFieldItem['source']): string | null => (s ? SOURCE_LABEL[s] : null);

/** "Shown only if “4.4 Os promotores…” is Yes" — the question the condition points at is looked up in the proposal itself. */
export function conditionLine(f: ProposalFieldItem, all: ProposalFieldItem[]): string | null {
  const c = f.condition; if (!c) return null;
  const ctl = all.find((x) => x.tmpId === c.tmpId);
  const name = ctl ? (ctl.number ? `question ${ctl.number}` : `“${ctl.label.slice(0, 60)}”`) : 'an earlier question';
  return `Shown only if ${name} is ${c.value === 'yes' ? 'Yes' : 'No'}`;
}

/** The lines under a question: its configuration in plain words. */
export function configLines(f: ProposalFieldItem): string[] {
  const out: string[] = [];
  if (f.kind === 'file') {
    const v = f.validations ?? {};
    const n = maxFilesOf(v);
    out.push(`Accepts ${formatsText(fileFormatsOf(v))}, up to ${maxFileMbOf(v)} MB${n > 1 ? ` each, up to ${n} files` : ''}`);
  }
  if (f.kind === 'url') out.push(f.validations?.urlHint ? `A link to a ${URL_HINT_LABELS[f.validations.urlHint].toLowerCase()}` : 'A link (https://)');
  if (f.kind === 'number' && f.validations?.currency) out.push('Shown with the call’s currency');
  if (f.kind === 'group' && f.group) {
    const g = f.group;
    out.push(`Repeatable group “${g.entryLabel}”: ${g.subFields.length} question${g.subFields.length === 1 ? '' : 's'} (${g.subFields.map((s) => s.label).join(', ')})`);
    out.push(g.display === 'table'
      ? `Shown as a table${g.presetRows.length > 0 ? ` with ${g.presetRows.length} fixed rows (${g.presetRows.map((r) => r[0]).join(', ')})` : ''}`
      : `Shown as cards, ${g.min > 0 ? `${g.min} to ` : 'up to '}${g.max} entries`);
  }
  return out;
}

/** The line at the top of the review: who read the form and how well. Null when the run predates the platform's own reader. */
export function metaLine(m: RunMeta | null | undefined): string | null {
  if (!m || !m.mode) return null;
  const pct = (v: number | null) => (v == null ? null : `${Math.round(v * 100)}%`);
  const q = [m.coverage != null ? `${pct(m.coverage)} of the numbered items read` : null, m.typeConfidence != null ? `${pct(m.typeConfidence)} of the question types recognised` : null].filter(Boolean).join(', ');
  if (m.mode === 'internal') return `Read by our platform alone${q ? ` (${q})` : ''}. Nothing was sent to the AI provider.`;
  if (m.mode === 'internal+ai') return `Read by our platform${q ? ` (${q})` : ''}; only ${m.aiSections.length === 1 ? 'one part' : `${m.aiSections.length} parts`} went to our AI provider: ${m.aiSections.join('; ')}.`;
  return 'Read by our AI provider: the document did not have a structure our platform could read.';
}
