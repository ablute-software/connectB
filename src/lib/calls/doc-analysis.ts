// Prompt 918 (I3) — what the INTERNAL engine can tell from the text of a document, given its recipe (doc-recipe.ts): is it the right document, is it valid (age, tax ID, company name), what is the access
// code and where can a person confirm it. Pure and deterministic: no AI, no network, and nothing of another call. The engine NEVER excludes on a doubt: a failure is only a CLEAR, objective one (a
// different kind of document, a document older than the limit, a tax ID printed on it that is not the declared one, an expired validity date); anything it cannot read or confirm goes to a person
// ("To validate"). A document that is only images of pages is not read at all (no OCR in v1) and goes to a person too.
import { DOC_TYPES, fold, type DocRecipe } from './doc-recipe';
import type { Outcome, RuleResult } from './eligibility';

export interface DocText {
  fileName: string;
  /** The text of each page (a Word or Excel file: one entry). null when nothing could be read. */
  pages: string[] | null;
  /** The file is a PDF with no text layer — only images (no OCR in v1). */
  scanned?: boolean;
  /** Why it could not be read at all (damaged, encrypted…). */
  unreadable?: string;
  /** The file carries a digital signature (a /ByteRange signature field in a PDF). The validity of the signature is NOT verified in v1. */
  hasSignature?: boolean;
}
export interface Declared { legalName?: string | null; taxId?: string | null }

export const SCANNED_REASON = 'Scanned file (image): text cannot be read automatically.';

type Part = { outcome: Outcome; reason: string; evidence?: RuleResult['evidence'] };
const res = (ruleId: string, p: Part): RuleResult => ({ ruleId, outcome: p.outcome, reason: p.reason, evidence: p.evidence ?? null });

const fullText = (d: DocText): string => (d.pages ?? []).join('\n');
const foldedPages = (d: DocText): string[] => (d.pages ?? []).map(fold);

/** The first page, and the line, where `needle` (already folded) appears — the quote a person can check. */
export function findQuote(d: DocText, needle: string): { page: number; quote: string } | null {
  const pages = d.pages ?? [];
  for (let i = 0; i < pages.length; i++) {
    const folded = fold(pages[i]);
    const at = folded.indexOf(needle);
    if (at < 0) continue;
    // The folding keeps lengths (accents are combining marks removed after NFD): map back by line.
    const lines = pages[i].split(/\r?\n/);
    const line = lines.find((l) => fold(l).includes(needle)) ?? pages[i].slice(Math.max(0, at - 40), at + needle.length + 60);
    return { page: i + 1, quote: line.replace(/\s+/g, ' ').trim().slice(0, 220) };
  }
  return null;
}

// --- Reading values out of the text ---------------------------------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const validDay = (y: number, m: number, d: number): string | null => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
};
/** Every date written in the text, as YYYY-MM-DD, in the order they appear: 12/10/2026, 12-10-2026, 2026-10-12, "12 de outubro de 2026", "12 October 2026". */
export function datesIn(text: string): { day: string; at: number }[] {
  const t = fold(text);
  const out: { day: string; at: number }[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/g)) { const d = validDay(Number(m[3]), Number(m[2]), Number(m[1])); if (d) out.push({ day: d, at: m.index ?? 0 }); }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { const d = validDay(Number(m[1]), Number(m[2]), Number(m[3])); if (d) out.push({ day: d, at: m.index ?? 0 }); }
  for (const m of t.matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?(\d{4})\b/g)) { const mo = MONTHS[m[2]]; if (mo) { const d = validDay(Number(m[3]), mo, Number(m[1])); if (d) out.push({ day: d, at: m.index ?? 0 }); } }
  return out.sort((a, b) => a.at - b.at);
}

const DATE_RX = String.raw`(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:de\s+)?[a-z]+\s+(?:de\s+)?\d{4})`;
/** The issue date: the date that follows an "issued / emitida / data de emissão" label. null when none is labelled. */
export function issueDate(text: string): string | null {
  const t = fold(text);
  const m = t.match(new RegExp(String.raw`(?:emitid[oa]|data\s+de\s+emissao|emissao|issued(?:\s+on)?|date\s+of\s+issue|extraid[oa]|emitida\s+em)\D{0,20}?${DATE_RX}`));
  return m ? datesIn(m[1])[0]?.day ?? null : null;
}
/** The validity limit: the date after "válida até / validade / valid until / expires". */
export function validUntil(text: string): string | null {
  const t = fold(text);
  const m = t.match(new RegExp(String.raw`(?:valid[oa]?\s+ate|validade|valid\s+until|expires?(?:\s+on)?|data\s+de\s+validade)\D{0,20}?${DATE_RX}`));
  return m ? datesIn(m[1])[0]?.day ?? null : null;
}

/** Tax IDs: the ones printed after a label (NIF, NIPC, VAT, tax ID), and every nine-digit number in the text. */
export function taxIdsIn(text: string): { labelled: string[]; any: string[] } {
  const t = fold(text);
  const labelled = [...t.matchAll(/(?:\bnif\b|\bnipc\b|\bvat\b|tax\s*id|numero\s+de\s+identificacao\s+fiscal|contribuinte)\D{0,25}?((?:\d\s?){9})\b/g)].map((m) => m[1].replace(/\s/g, ''));
  const any = [...t.matchAll(/(?<!\d)(\d{9})(?!\d)/g)].map((m) => m[1]);
  return { labelled: [...new Set(labelled)], any: [...new Set(any)] };
}

/** "Acme Robotics, Lda." → "acme robotics" — what two spellings of one company name share. */
export function normalizeName(name: string): string {
  return fold(name).replace(/[.,;:()'"“”]/g, ' ').replace(/\b(lda|limitada|unipessoal|sa|s\.a|sgps|sociedade|anonima|ltd|llc|inc|gmbh|corp)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Whole months between two YYYY-MM-DD days (a → b), counting a month once the day of the month has been reached. */
export function monthsBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number); const [by, bm, bd] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
}

// --- The checks ----------------------------------------------------------------------------------------------------------------------------------------

/** A file that cannot be analysed at all: a scanned PDF (image only), or one that is damaged. Always a person's job — never a failure of the applicant. */
export function unreadableResult(ruleId: string, d: DocText): RuleResult | null {
  if (d.scanned) return res(ruleId, { outcome: 'validate', reason: SCANNED_REASON, evidence: { fileName: d.fileName } });
  if (d.unreadable) return res(ruleId, { outcome: 'validate', reason: `The file could not be read automatically (${d.unreadable}): a person should check it.`, evidence: { fileName: d.fileName } });
  if (!d.pages || fullText(d).trim().length < 20) return res(ruleId, { outcome: 'validate', reason: 'No text could be read from the file: a person should check it.', evidence: { fileName: d.fileName } });
  return null;
}

/** "Right document": does the text carry the wording the recipe expects? Fails only when it clearly looks like ANOTHER known kind of document. */
export function analyzeRight(ruleId: string, recipe: DocRecipe, d: DocText): RuleResult {
  const unreadable = unreadableResult(ruleId, d); if (unreadable) return unreadable;
  if (!recipe.docType) return res(ruleId, { outcome: 'validate', reason: 'The platform has no automatic check for this kind of document: a person will validate it.', evidence: { fileName: d.fileName } });
  if (recipe.headers.length === 0) return res(ruleId, { outcome: 'pass', reason: `A readable file was attached (${recipe.docTypeLabel} has no fixed wording to check).`, evidence: { fileName: d.fileName } });
  const pages = foldedPages(d); const all = pages.join('\n');
  const matched = recipe.headers.filter((h) => all.includes(h));
  const need = Math.min(2, recipe.headers.length);
  if (matched.length >= need) {
    const q = findQuote(d, matched[0]);
    return res(ruleId, { outcome: 'pass', reason: `It reads as a ${recipe.docTypeLabel}: found “${matched.slice(0, 3).join('”, “')}”.`, evidence: { fileName: d.fileName, page: q?.page ?? null, quote: q?.quote } });
  }
  // Clearly another document? (two or more of its characteristic expressions, and not this one's)
  const other = DOC_TYPES.filter((t) => t.key !== recipe.docType && t.headers.length >= 2)
    .map((t) => ({ t, n: t.headers.filter((h) => all.includes(h)).length })).sort((a, b) => b.n - a.n)[0];
  if (other && other.n >= 2 && matched.length === 0) {
    const first = other.t.headers.find((h) => all.includes(h))!; const q = findQuote(d, first);
    return res(ruleId, { outcome: 'fail', reason: `It looks like a ${other.t.label}, not a ${recipe.docTypeLabel}.`, evidence: { fileName: d.fileName, page: q?.page ?? null, quote: q?.quote } });
  }
  return res(ruleId, { outcome: 'validate', reason: `We could not recognise it as a ${recipe.docTypeLabel}: a person should check it.`, evidence: { fileName: d.fileName } });
}

/** "Valid document": age, validity date, tax ID and company name. `today` is the day of the evaluation, `refDay` the day the age is counted to (the submission). */
export function analyzeValid(ruleId: string, recipe: DocRecipe, d: DocText, declared: Declared, refDay: string): RuleResult {
  const unreadable = unreadableResult(ruleId, d); if (unreadable) return unreadable;
  const text = fullText(d);
  const parts: Part[] = [];
  const ev = (needle: string): RuleResult['evidence'] => { const q = findQuote(d, fold(needle)); return { fileName: d.fileName, page: q?.page ?? null, quote: q?.quote }; };

  const until = validUntil(text);
  if (until && until < refDay) parts.push({ outcome: 'fail', reason: `The document says it was valid until ${until}, before the application was submitted.`, evidence: ev(until.split('-').reverse().join('/')) });
  if (recipe.maxAgeMonths) {
    const issued = issueDate(text);
    if (!issued) parts.push({ outcome: 'validate', reason: 'The issue date could not be found in the document: a person should check its age.', evidence: { fileName: d.fileName } });
    else {
      const months = monthsBetween(issued, refDay);
      parts.push(months > recipe.maxAgeMonths
        ? { outcome: 'fail', reason: `Issued on ${issued}: older than the ${recipe.maxAgeMonths} month${recipe.maxAgeMonths === 1 ? '' : 's'} allowed.`, evidence: ev(issued.split('-').reverse().join('/')) }
        : { outcome: 'pass', reason: `Issued on ${issued}, within the last ${recipe.maxAgeMonths} month${recipe.maxAgeMonths === 1 ? '' : 's'}.`, evidence: ev(issued.split('-').reverse().join('/')) });
    }
  }
  for (const c of recipe.compare) {
    if (c.what === 'tax_id') {
      const want = (declared.taxId ?? '').replace(/\D/g, '');
      if (!want) { parts.push({ outcome: 'validate', reason: 'No tax ID was declared to compare with: a person should check it.' }); continue; }
      const ids = taxIdsIn(text);
      if (ids.labelled.includes(want) || ids.any.includes(want)) parts.push({ outcome: 'pass', reason: `The tax ID ${want} appears in the document.`, evidence: ev(want) });
      else if (ids.labelled.length > 0) parts.push({ outcome: 'fail', reason: `The tax ID in the document (${ids.labelled[0]}) is not the declared one (${want}).`, evidence: ev(ids.labelled[0]) });
      else parts.push({ outcome: 'validate', reason: 'No tax ID could be found in the document: a person should check it.', evidence: { fileName: d.fileName } });
    } else if (c.what === 'legal_name') {
      const want = normalizeName(declared.legalName ?? '');
      if (!want) { parts.push({ outcome: 'validate', reason: 'No company name was declared to compare with: a person should check it.' }); continue; }
      if (normalizeName(text).includes(want)) parts.push({ outcome: 'pass', reason: `The company name “${declared.legalName}” appears in the document.`, evidence: ev(want) });
      else parts.push({ outcome: 'validate', reason: `“${declared.legalName}” was not found in the document (it may be a trade name rather than the registered name): a person should check it.`, evidence: { fileName: d.fileName } });
    }
  }
  if (parts.length === 0) return res(ruleId, { outcome: 'pass', reason: 'A readable document was attached and nothing was set to compare it with.', evidence: { fileName: d.fileName } });
  const worst = parts.find((p) => p.outcome === 'fail') ?? parts.find((p) => p.outcome === 'validate');
  if (worst) return res(ruleId, { ...worst, reason: parts.filter((p) => p.outcome === worst.outcome).map((p) => p.reason).join(' ') });
  return res(ruleId, { outcome: 'pass', reason: parts.map((p) => p.reason).join(' '), evidence: parts[0].evidence });
}

/** "Authentic document": ALWAYS a person. Shows what helps them: the access code printed on it and the official portal. */
export function analyzeAuthentic(ruleId: string, recipe: DocRecipe, d: DocText): RuleResult {
  const unreadable = unreadableResult(ruleId, d);
  const code = recipe.accessCodePattern && d.pages ? fullText(d).match(new RegExp(recipe.accessCodePattern))?.[0] ?? null : null;
  const portal = recipe.verification ? ` Confirm it at the ${recipe.verification.portalName}: ${recipe.verification.portal}` : '';
  const sig = d.hasSignature ? ' The file carries a digital signature; its validity is not verified automatically.' : '';
  const reason = code ? `Authenticity cannot be verified automatically. Access code on the document: ${code}.${portal}${sig}` : unreadable ? `${unreadable.reason} Authenticity cannot be verified automatically.` : `Authenticity cannot be verified automatically.${portal}${sig}`;
  return res(ruleId, { outcome: 'validate', reason, evidence: { fileName: d.fileName, ...(code ? { quote: code } : {}) } });
}
