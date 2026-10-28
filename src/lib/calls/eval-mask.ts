// Prompt 922 (I3) — blind evaluation. When the entity switches it on, the evaluator reads the application WITHOUT who applied: the startup's name, the people and their emails — in the answers and in the names
// of the files (the files themselves stay open, so the evaluator can still read them). The administrator always sees everything; the masking is done on the SERVER, so what leaves it is already masked.
//
// Pure: the route gathers who the identifiers are (the startup, the applicant, the members: names and emails), this redacts. A name is also looked for in the forms a file name gives it ("Acme Robotics, Lda."
// → acme-robotics-lda, acme_robotics, acmerobotics, and without the legal suffix), because the identity of a startup is usually in the file name of its certificate.
import type { AnswerValue, FormField } from './types';

export const HIDDEN = '[hidden]';
const SUFFIXES = /\b(lda|ltda|unipessoal|s\.?a\.?|sociedade anonima|sgps|inc|llc|ltd|limited|gmbh|bv|sarl|srl|plc|corp|co)\b\.?/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The ways one identifier can appear: as written, without the legal suffix, and joined with - _ . or nothing (as in a file name). Only forms of at least 4 characters, so "Co" never blanks a text. */
export function identifierForms(raw: string): string[] {
  const base = fold(raw).replace(/[,;()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (base.length < 3) return [];
  const core = base.replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
  const out = new Set<string>();
  for (const v of [base, core]) {
    if (v.length < 4) continue;
    out.add(v);
    const words = v.split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length > 1) for (const sep of ['-', '_', '.', '']) out.add(words.join(sep));
  }
  return [...out].filter((f) => f.length >= 4);
}

export interface Redactor { text: (s: string) => string; changed: (s: string) => boolean }

/** A function that blanks every identifier (and any email address) from a text. Case and accents do not matter. */
export function buildRedactor(identifiers: (string | null | undefined)[]): Redactor {
  const forms = [...new Set(identifiers.filter((x): x is string => typeof x === 'string').flatMap(identifierForms))].sort((a, b) => b.length - a.length);
  const re = forms.length ? new RegExp(forms.map(escapeRe).join('|'), 'g') : null;
  const text = (s: string): string => {
    // Work on the folded text for the search, but blank the ORIGINAL characters (folding keeps the length for these accents; the guard below covers the rare case where it does not).
    let out = s.replace(EMAIL, HIDDEN);
    if (!re) return out;
    const folded = fold(out);
    if (folded.length !== out.length) return out.replace(new RegExp(forms.map(escapeRe).join('|'), 'gi'), HIDDEN);
    const parts: string[] = []; let last = 0;
    for (const m of folded.matchAll(re)) { parts.push(out.slice(last, m.index)); parts.push(HIDDEN); last = (m.index ?? 0) + m[0].length; }
    parts.push(out.slice(last));
    out = parts.join('');
    return out;
  };
  return { text, changed: (s) => text(s) !== s };
}

/** The identifiers an application carries: the startup, the applicant and the people of the startup (names, emails and the domain of each email that is not a generic mailbox). */
export function identifiersOf(input: { startupName?: string | null; people: { name?: string | null; email?: string | null }[]; genericDomains: Set<string> }): string[] {
  const out: string[] = [];
  if (input.startupName) out.push(input.startupName);
  for (const p of input.people) {
    if (p.name) out.push(p.name);
    if (p.email) {
      out.push(p.email);
      const domain = p.email.split('@')[1]?.toLowerCase();
      if (domain && !input.genericDomains.has(domain)) out.push(domain.replace(/\.[a-z.]+$/, ''));      // "acme" from acme.pt — the company's name as the file names have it
    }
  }
  return out;
}

const mapValue = (v: unknown, redact: Redactor): unknown => {
  if (typeof v === 'string') return redact.text(v);
  if (Array.isArray(v)) return v.map((x) => mapValue(x, redact));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, mapValue(x, redact)]));
  return v;
};

/** The answers with every identifier blanked; an email or web address answer is hidden whole (it almost always points at the company or a person). Keys (question ids) and the shape are untouched. */
export function maskAnswers(fields: Pick<FormField, 'id' | 'kind'>[], answers: Record<string, AnswerValue>, redact: Redactor): Record<string, AnswerValue> {
  const kindOf = new Map(fields.map((f) => [f.id, f.kind]));
  const out: Record<string, AnswerValue> = {};
  for (const [id, value] of Object.entries(answers)) {
    const kind = kindOf.get(id);
    out[id] = (kind === 'email' || kind === 'url') && value !== null && value !== undefined && value !== '' ? (HIDDEN as AnswerValue) : (mapValue(value, redact) as AnswerValue);
  }
  return out;
}

/** The name a file is shown under: its own when it holds no identifier; otherwise "<label> — document n" with the extension (the question it answers is enough to know what it is). */
export function maskFileName(fileName: string, redact: Redactor, label: string, index: number): string {
  if (!redact.changed(fileName)) return fileName;
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(fileName)?.[0] ?? '';
  return `${label || 'Document'} — document ${index + 1}${ext}`;
}
