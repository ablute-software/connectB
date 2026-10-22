// Prompt 917 (Adenda 1, Part B) — the platform's OWN reader of application forms: deterministic, no AI, from the text the platform already extracts.
//
// It turns a numbered form ("1.1 Nome…", "2.2 … (selecione) - a; - b", "4.4 …? Sim ou não. Quanto (em euros)?", "6.4 … currículo … / 6.4.1 Nome, idade, cargo…") into the
// questions of a call: their kinds, options, conditions, pages (the numbered top-level sections) and — said openly — what it did with them. It also MEASURES itself:
//   · coverage      — of the numbered items of the document, how many became a question (or a section, or part of a question);
//   · type confidence — of the questions, how many got their kind from a clear rule and not from the "everything else is short text" fallback;
//   · unresolved structures — blocks it could not read (a table, a template, text with no numbering).
// What those numbers decide (internal only / internal + AI for the parts that failed / AI for everything) lives in decide.ts, not here.
//
// Pure: text in, proposal items out. It never throws on odd text; whatever it cannot read it reports as unresolved.
import { type AttentionItem, type ProposalFieldItem, type ProposalGeneral } from '../proposal';
import { defaultGroupConfig, newSubField, parseSimpleValidations } from '../../field-config';
import { readTemplateTable } from './table';
import type { FileFormatKey, GroupConfig, SimpleKind, SubField } from '../../types';
import {
  ACCESS_CODE, AGE_OF_COMPANY, FRESHNESS_HINT, explicitDocumentAgeMonths, ATTACHMENTS_SECTION, CHOICE_CUE, COMPANY_CONSTITUTED, CV_CUE, DATE_CUE, EMAIL_CUE, FILE_NOUN, FILE_VERB, FOLLOW_UP_INLINE, FORMAT_WORDS, IF_NO, IF_YES,
  LIMIT_CUE, LONG_TEXT_CUE, MULTIPLE_CUE, NUMBER_CUE, OPTIONAL_CUE, OTHER_DOCUMENTS, PEOPLE_NOUNS, PER_PERSON, REQUIRED_CUE, SHORT_TEXT_CUE, STRUCTURE_MARKER, TOPICS_PARENT,
  URL_CUE, WH_WORD, YES_NO_CUE, YES_NO_CUE_RAW, YES_NO_THEN_AMOUNT, fold,
} from './cues';

export interface ReaderDoc { name?: string; pages: string[] }
export interface UnresolvedBlock {
  title: string; page: number; text: string; reason: 'table' | 'unnumbered' | 'spreadsheet';
  /** The number of the last numbered item before the block: where what is made of it is placed. */
  afterNumber: string | null;
}
export interface SectionInfo { number: string; title: string; page: number; firstField: number; lastField: number; text: string }
export interface ReaderQuality {
  /** Items of the document that look like questions (numbered; or lines ending in "?" or ":" when nothing is numbered). */
  candidates: number;
  /** Of those, how many became a question, a section or part of a question. */
  resolved: number;
  coverage: number;
  questions: number;
  clearTypes: number;
  typeConfidence: number;
  unresolved: UnresolvedBlock[];
  /** Numbers of the questions whose kind came from the fallback or from a weak guess: the ones an AI second opinion is for. */
  weak: string[];
}
export interface ReaderResult {
  fields: ProposalFieldItem[];
  attention: AttentionItem[];
  general: ProposalGeneral;
  quality: ReaderQuality;
  sections: SectionInfo[];
}

interface Line { text: string; page: number }
interface Item {
  num: string; depth: number; lines: string[]; bullets: string[]; page: number; isSection: boolean; section: number; absorbed: boolean; promptOnly: boolean;
}

const NUMBERED = /^((?:\d+\.)+\d+|\d+\.)\s+(\S.*)$/;       // "1.1 …", "2.10.1 …", "1. …"
const LETTERED = /^([a-z])\)\s+(\S.*)$/i;
const BULLET = /^[-–—•▪▫□☐✓◦]\s*(.*)$/;
const CLEAN_TAIL = /[\s;,.:]+$/;

const sentenceCase = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const joinLines = (ls: string[]): string => ls.join(' ').replace(/\s+/g, ' ').trim();

// --- 1. Lines, without what repeats on every page ---------------------------------------------------------------------------------------------------

/** The title lines that repeat on the pages of a document (headers and footers): dropped from the lines, kept as candidates for the call's name. */
function pageFurniture(pages: string[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of [...p.slice(0, 4), ...p.slice(-2)]) { const k = fold(l).trim(); if (k && !seen.has(k)) { seen.add(k); counts.set(k, (counts.get(k) ?? 0) + 1); } }
  }
  const need = Math.max(2, Math.ceil(pages.length * 0.6));
  return pages.length < 2 ? new Set() : new Set([...counts].filter(([, n]) => n >= need).map(([k]) => k));
}

function buildLines(docs: ReaderDoc[]): { lines: Line[]; furniture: string[] } {
  const lines: Line[] = []; const furniture: string[] = [];
  let pageBase = 0;
  for (const d of docs) {
    const pages = d.pages.map((p) => p.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ {2,}/g, ' ').trim()).filter((l) => l !== ''));
    const repeated = pageFurniture(pages);
    pages.forEach((p, i) => {
      for (const l of p) {
        if (repeated.has(fold(l).trim())) { if (!furniture.includes(l)) furniture.push(l); continue; }
        if (/^\d{1,3}$/.test(l)) continue;                                  // a page number on its own
        lines.push({ text: l, page: pageBase + i + 1 });
      }
    });
    pageBase += pages.length;
  }
  return { lines, furniture };
}

// --- 2. Items: what starts at a number, what continues it ----------------------------------------------------------------------------------------------

function parseItems(lines: Line[]): { items: Item[]; blocks: UnresolvedBlock[]; numberedCount: number } {
  const items: Item[] = []; const blocks: UnresolvedBlock[] = [];
  let cur: Item | null = null; let block: UnresolvedBlock | null = null; let section = 0; let lastNumbered: Item | null = null;
  const numberedCount = lines.filter((l) => NUMBERED.test(l.text)).length;
  const numbered = numberedCount >= 3;
  const closeBlock = () => { if (block) { blocks.push(block); block = null; } };
  for (const l of lines) {
    const n = NUMBERED.exec(l.text);
    const le = n ? null : LETTERED.exec(l.text);
    const b = BULLET.exec(l.text);
    if (n || le) {
      closeBlock();
      const prev: Item | null = lastNumbered;
      const num: string = n ? n[1].replace(/\.$/, '') : `${prev?.num ?? ''}${(le as RegExpExecArray)[1].toLowerCase()}`;
      const depth: number = n ? num.split('.').length : (prev?.depth ?? 1) + 1;
      const text = n ? n[2] : (le as RegExpExecArray)[2];
      const isSection = !!n && depth === 1 && !/[?:]\s*$/.test(text) && text.length <= 90;
      if (isSection) section++;
      cur = { num, depth, lines: [text], bullets: [], page: l.page, isSection, section: Math.max(1, section), absorbed: false, promptOnly: false };
      items.push(cur); lastNumbered = cur;
      continue;
    }
    // A block the reader does not read: a template, a table, an example — from its title to the next numbered item.
    if (!block && cur && STRUCTURE_MARKER.test(fold(l.text)) && l.text.length <= 90 && !/[?]\s*$/.test(l.text)) {
      block = { title: l.text, page: l.page, text: l.text, reason: 'table', afterNumber: lastNumbered?.num ?? null };
      continue;
    }
    if (block) { block.text += `\n${l.text}`; continue; }
    if (b && cur && /^[-–—•▪▫□☐✓◦]/.test(l.text)) { cur.bullets.push(b[1].replace(CLEAN_TAIL, '').trim()); continue; }
    // In a form with no numbering at all the questions are the lines that end in "?" or ":" (or "? (Yes or No)"): each starts a new item, whatever came before.
    const asksHere = !numbered && (/[?:]\s*$/.test(l.text) || /\?\s*\([^()]{1,40}\)\s*$/.test(l.text)) && l.text.length <= 300;
    if (cur && !asksHere) { cur.lines.push(l.text); continue; }
    // Text before the first numbered item: an intro, a title — or the questions themselves.
    if (asksHere) {
      const it: Item = { num: '', depth: 2, lines: [l.text], bullets: [], page: l.page, isSection: false, section: 1, absorbed: false, promptOnly: true };
      items.push(it); cur = it;
    }
  }
  closeBlock();
  return { items, blocks, numberedCount };
}

// --- 3. Reading one item ------------------------------------------------------------------------------------------------------------------------------

function splitOptions(raw: string): string[] {
  let s = raw.trim();
  const colon = /^([^:|]{1,24}):\s*(.+)$/.exec(s);                      // "NUTs III: a | b | c"
  if (colon && /\|/.test(colon[2])) s = colon[2];
  const parts = s.split('|').map((p) => p.replace(CLEAN_TAIL, '').trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // "Região Autónoma dos Açores, Região Autónoma da Madeira": a part that is itself a list of capitalised names
    const sub = p.split(/,\s+/);
    if (sub.length > 1 && sub.every((x) => /^\p{Lu}/u.test(x)) && !/^\W*\d/.test(p)) out.push(...sub); else out.push(p);
  }
  return out;
}

interface Read { label: string; options: string[]; multiple: boolean; yesNo: boolean; choiceCue: boolean }

/** The label of an item, its options (bullets, "(selecione) a | b | c", "(… | … | …)") and whether it says yes/no. */
function readText(item: Item): Read {
  let text = joinLines(item.lines);
  let options: string[] = [];
  const f = fold(text);
  const multiple = MULTIPLE_CUE.test(f);
  const choiceCue = CHOICE_CUE.test(f);
  // (a) "…? (selecione) a | b | c"
  const cue = /\(\s*(?:selecion\w*|escolh\w*|select\w*|choose\w*|assinale\w*)\s*\)/i.exec(text);
  if (cue) {
    const after = text.slice(cue.index + cue[0].length).trim();
    if (after && (after.includes('|') || after.split(/\s+/).length >= 2)) options = after.includes('|') ? splitOptions(after) : [];
    text = text.slice(0, cue.index).trim();
  }
  // (b) a parenthesis holding a "|" list: "(NUTs III: a | b | c)"
  if (options.length === 0) {
    const par = /\(([^()]*\|[^()]*)\)/.exec(text);
    if (par && par[1].split('|').length >= 3) { options = splitOptions(par[1]); text = (text.slice(0, par.index) + text.slice(par.index + par[0].length)).replace(/\s+/g, ' ').trim(); }
  }
  // (c) bullets under the item
  if (options.length === 0 && item.bullets.length >= 2) options = item.bullets.map((x) => x.replace(CLEAN_TAIL, '').trim()).filter(Boolean);
  // (d) a "|" list on its own after the question: "? a | b | c"
  if (options.length === 0) {
    const m = /\?\s+([^?]*\|[^?]*)$/.exec(text);
    if (m && m[1].split('|').length >= 3) { options = splitOptions(m[1]); text = text.slice(0, m.index + 1).trim(); }
  }
  const yesNo = YES_NO_CUE.test(fold(text));
  const label = text.replace(YES_NO_CUE_RAW, '').replace(/\s*\(\s*\)\s*/g, ' ').replace(/\s+/g, ' ').replace(CLEAN_TAIL, (m) => (m.includes('?') ? m : '')).trim();
  return { label: label || text, options, multiple, yesNo, choiceCue };
}

const shorten = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${cut.slice(0, at > 40 ? at : max).replace(CLEAN_TAIL, '')}…`;
};

function formatsOf(text: string): FileFormatKey[] {
  const f = fold(text);
  const found = [...new Set(FORMAT_WORDS.filter((w) => w.re.test(f)).map((w) => w.format))];
  // A presentation / pitch deck asked for in PowerPoint is just as well sent as a PDF (Nuno, 16/10/2026): both by default.
  if (found.length === 1 && found[0] === 'powerpoint' && /apresentac|pitch|deck|presentation|slides?/.test(f)) return ['powerpoint', 'pdf'];
  return found.length > 0 ? found : ['pdf'];
}

type TypeRule = { kind: ProposalFieldItem['kind']; clear: boolean; extra?: Partial<ProposalFieldItem> };

/** The kind of a question, with how it was decided. The order matters: the most specific evidence first. */
function decideKind(read: Read, ctx: { inAttachments: boolean; text: string }): TypeRule {
  const f = fold(read.label);
  const whole = fold(ctx.text);
  if (read.options.length >= 2) return { kind: read.multiple ? 'multiple_choice' : 'single_choice', clear: true };
  if (read.yesNo) return { kind: 'yes_no', clear: true };
  if (URL_CUE.test(f) && !FILE_VERB.test(f.replace(/\b(?:insira|insere)\b/, ''))) return { kind: 'url', clear: true, extra: { validations: parseSimpleValidations('url', { urlHint: /youtube|vimeo|video/.test(f) ? 'video' : /website|web site|site|sitio/.test(f) ? 'website' : undefined }) } };
  if (URL_CUE.test(f) && /\b(?:link|youtube|vimeo)\b/.test(f)) return { kind: 'url', clear: true, extra: { validations: parseSimpleValidations('url', { urlHint: /youtube|vimeo|video/.test(f) ? 'video' : undefined }) } };
  if (OTHER_DOCUMENTS.test(f)) return { kind: 'file', clear: true, extra: { validations: parseSimpleValidations('file', { fileFormats: ['pdf', 'word', 'excel'], maxFiles: 10 }) } };
  if (ACCESS_CODE.test(f)) return { kind: 'short_text', clear: true };
  if ((FILE_VERB.test(f) && FILE_NOUN.test(f)) || (ctx.inAttachments && (FILE_VERB.test(f) || FILE_NOUN.test(f)))) {
    return { kind: 'file', clear: true, extra: { validations: parseSimpleValidations('file', { fileFormats: formatsOf(whole) }) } };
  }
  if (EMAIL_CUE.test(f) && f.length <= 70) return { kind: 'email', clear: true };
  if (DATE_CUE.test(f)) return { kind: 'date', clear: true };
  // a question that asks several things at once is a long answer, not a number
  const asks = (f.match(/\b(?:qual|quais|quem|quanto|quantos|quantas|como|de que forma|quando|onde|what|which|who|how|when|where)\b/g) ?? []).length;
  if (asks >= 2 || LONG_TEXT_CUE.test(f) || LIMIT_CUE.test(f)) return { kind: 'long_text', clear: true };
  if (NUMBER_CUE.test(f)) return { kind: 'number', clear: true, extra: /€|euros?|\bem eur\b/.test(f) ? { validations: { currency: true } } : undefined };
  if (read.choiceCue) return { kind: 'single_choice', clear: false };      // "(selecione)" but no options in the document
  if (SHORT_TEXT_CUE.test(f)) return { kind: 'short_text', clear: true };
  if (/\?\s*$/.test(read.label) && !WH_WORD.test(f) && read.label.length <= 130) return { kind: 'yes_no', clear: false };
  if (read.label.length > 140 && /\?\s*$/.test(read.label)) return { kind: 'long_text', clear: false };
  return { kind: 'short_text', clear: false };
}

// --- 4. The whole form ------------------------------------------------------------------------------------------------------------------------------------

const isOptional = (text: string): boolean => (OPTIONAL_CUE.test(fold(text)) || /^(?:\d+(?:\.\d+)*\.?\s*)?se\s+(?!sim\b|nao\b)\S/i.test(fold(text))) && !REQUIRED_CUE.test(fold(text));

/** "Nome, idade, cargo, habilitações literárias, experiência profissional e e-mail;" -> ["Nome","idade",…]; null when it is not such a list. */
function dataList(text: string): string[] | null {
  const t = text.replace(CLEAN_TAIL, '');
  if (/\?/.test(t) || t.length > 220) return null;
  const parts = t.split(/,\s*|\s+e\s+(?=[^,]+$)/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 4 || parts.some((p) => p.split(/\s+/).length > 5)) return null;
  return parts;
}

function subFieldOf(label: string, first: boolean): SubField {
  const f = fold(label);
  let kind: SimpleKind = 'short_text';
  if (/e-?mail/.test(f)) kind = 'email';
  else if (/\bidade\b|\bage\b/.test(f)) kind = 'number';
  else if (/experiencia|biografia|bio\b|resumo|experience/.test(f)) kind = 'long_text';
  else if (/^data\b|\bdate\b/.test(f)) kind = 'date';
  else if (/linkedin|website|site|link/.test(f)) kind = 'url';
  const s = newSubField(kind);
  s.label = sentenceCase(label.trim());
  s.required = first || kind === 'email';
  return s;
}

export function readForm(docs: ReaderDoc[]): ReaderResult {
  const { lines, furniture } = buildLines(docs);
  const { items, blocks, numberedCount } = parseItems(lines);
  const attention: AttentionItem[] = [];
  const fields: ProposalFieldItem[] = [];
  const weak: string[] = [];
  let seq = 0; let resolved = 0; let clearTypes = 0; let questions = 0;
  const sections: SectionInfo[] = [];
  const sectionTitle = (n: number) => items.find((i) => i.isSection && i.section === n);
  const candidatesCount = items.filter((i) => i.num !== '' || i.promptOnly).length;
  const nextId = () => `n${++seq}`;
  const byNum = new Map<string, ProposalFieldItem>();

  const push = (f: ProposalFieldItem, clear: boolean, countsAsQuestion = true) => {
    fields.push(f); if (f.number) byNum.set(f.number, f);
    if (countsAsQuestion) { questions++; if (clear) clearTypes++; else weak.push(f.number ?? f.label); }
  };

  const descendants = (i: number): Item[] => {
    const me = items[i]; const out: Item[] = [];
    for (let j = i + 1; j < items.length; j++) { if (items[j].num.startsWith(`${me.num}.`) || (items[j].num.startsWith(me.num) && /^[a-z]/.test(items[j].num.slice(me.num.length)))) out.push(items[j]); else break; }
    return out;
  };
  const parentYesNo = (num: string): ProposalFieldItem | null => {
    let p = num.includes('.') ? num.slice(0, num.lastIndexOf('.')) : '';
    while (p) { const f = byNum.get(p); if (f) return f.kind === 'yes_no' ? f : null; p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : ''; }
    return null;
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.absorbed) continue;
    const full = joinLines(it.lines);
    if (it.isSection) { resolved++; continue; }
    const read = readText(it);
    const inAttachments = (() => { const s = sectionTitle(it.section); return !!s && ATTACHMENTS_SECTION.test(fold(joinLines(s.lines))); })();
    const page = it.section;
    const optional = isOptional(full);
    const num = it.num || null;
    const labelOf = (text: string) => `${num ? `${num} ` : ''}${shorten(text, 270)}`;
    const kids = descendants(i);

    // (1) a file with "the following topics": its children are the topics, kept as the instruction
    const asFile = (FILE_VERB.test(fold(full)) && FILE_NOUN.test(fold(full))) || (inAttachments && FILE_VERB.test(fold(full)));
    if (asFile && TOPICS_PARENT.test(fold(full)) && kids.length >= 2) {
      const topics = kids.map((k) => shorten(joinLines(k.lines).replace(CLEAN_TAIL, ''), 160));
      kids.forEach((k) => { k.absorbed = true; resolved++; });
      const instruction = shorten(`It should cover: ${topics.map((t) => t.replace(/^\d+(\.\d+)*\s*/, '')).join('; ')}`, 1000);
      push({ tmpId: nextId(), page, kind: 'file', label: labelOf(read.label), instruction, required: !optional, options: [], expectedType: null, maxAgeMonths: null,
        validations: parseSimpleValidations('file', { fileFormats: formatsOf(full) }), number: num, source: 'internal' }, true);
      attention.push({ kind: 'done', what: `${num} lists ${kids.length} topics for the document`, why: `Kept as the instruction of the question, not as ${kids.length} separate questions. Check that this is what you want.` });
      resolved++; continue;
    }

    // (2) CVs "of each member" with a list of data per person: one repeatable group, a CV in each entry — never a ZIP
    const dl = kids.map((k) => ({ k, list: dataList(joinLines(k.lines)) })).find((x) => x.list);
    if (dl && (CV_CUE.test(fold(full)) || PER_PERSON.test(fold(full)))) {
      const cfg: GroupConfig = defaultGroupConfig();
      cfg.entryLabel = PEOPLE_NOUNS.test(fold(full)) ? 'Team member' : 'Entry';
      cfg.min = 1; cfg.max = 10;
      cfg.subFields = (dl.list as string[]).map((p, ix) => subFieldOf(p, ix === 0));
      if (CV_CUE.test(fold(full))) {
        const cv = newSubField('file'); cv.label = 'CV'; cv.required = !optional; cv.validations = parseSimpleValidations('file', { fileFormats: ['pdf'], maxFileMb: 5 });
        cfg.subFields.push(cv);
      }
      dl.k.absorbed = true; resolved += 2;
      push({ tmpId: nextId(), page, kind: 'group', label: labelOf(`${cfg.entryLabel} details`), instruction: shorten(full.replace(/^pf\.?\s*/i, ''), 600), required: !optional, options: [], expectedType: null, maxAgeMonths: null,
        group: cfg, number: num, source: 'internal' }, true);
      attention.push({ kind: 'done', what: `${num}${/zip/i.test(full) ? ' asked for the CVs in a ZIP' : ' asks for the data of each person'}`,
        why: `It became a “${cfg.entryLabel}” group: ${cfg.subFields.map((s) => s.label).join(', ')}${CV_CUE.test(fold(full)) ? '; each entry has its own CV file (a ZIP is not accepted)' : ''}.` });
      continue;
    }

    // (3) "please include (if available):" followed by documents: one file question per document (an access code is text, not a file)
    const listIntro = /[:]\s*$/.test(full) && asFile && kids.length >= 2 && kids.every((k) => !/\?/.test(joinLines(k.lines)) && joinLines(k.lines).split(/\s+/).length <= 16);
    if (listIntro) {
      const intro = shorten(full.replace(CLEAN_TAIL, ''), 300);
      const constituted = [...fields].reverse().find((f) => f.kind === 'yes_no' && COMPANY_CONSTITUTED.test(fold(f.label)));
      const optionalList = isOptional(full);
      let files = 0; let texts = 0;
      for (const k of kids) {
        const kt = joinLines(k.lines).replace(CLEAN_TAIL, '');
        k.absorbed = true; resolved++;
        const isCode = ACCESS_CODE.test(fold(kt));
        if (isCode) texts++; else files++;
        // The deadline of a document is the one written in ITS OWN line — never the intro's, never a neighbour's.
        const ownAge = isCode ? null : explicitDocumentAgeMonths(kt);
        if (!ownAge && FRESHNESS_HINT.test(fold(kt))) attention.push({ kind: 'done', what: `${k.num} says the document must be up to date`, why: 'No deadline is written, so none was set. If the entity needs one (for example "issued less than 3 months ago"), set it on the question.' });
        push({ tmpId: nextId(), page, kind: isCode ? 'short_text' : 'file', label: `${k.num} ${shorten(kt, 250)}`, instruction: intro, required: !optionalList && !isOptional(kt), options: [], expectedType: null, maxAgeMonths: ownAge,
          ...(isCode ? {} : { validations: parseSimpleValidations('file', { fileFormats: formatsOf(kt) }) }),
          ...(constituted ? { condition: { tmpId: constituted.tmpId, value: 'yes' as const } } : {}), number: k.num, source: 'internal' }, true);
      }
      resolved++;
      attention.push({ kind: 'done', what: `${num} asked for ${kids.length} documents`, why: `Split into ${files} file question${files === 1 ? '' : 's'}${texts ? ` and ${texts} text question${texts === 1 ? '' : 's'} (an access code is typed, not uploaded)` : ''}.` });
      continue;
    }

    // (4) a yes/no and an amount in one question: two questions, the amount shown only if Yes
    const foldedFull = fold(full);
    const ya = YES_NO_THEN_AMOUNT.exec(foldedFull);
    if (ya) {
      const base = full.slice(0, ya.index + 1);
      const amount = full.slice(ya.index + ya[0].length - ya[1].length).trim();
      const yes: ProposalFieldItem = { tmpId: nextId(), page, kind: 'yes_no', label: labelOf(base), instruction: null, required: !optional, options: [], expectedType: null, maxAgeMonths: null, number: num, source: 'internal' };
      push(yes, true);
      push({ tmpId: nextId(), page, kind: 'number', label: `${num} ${sentenceCase(amount)}`, instruction: null, required: true, options: [], expectedType: null, maxAgeMonths: null,
        validations: /€|euros?/i.test(amount) ? { currency: true } : undefined, condition: { tmpId: yes.tmpId, value: 'yes' }, number: `${num}/2`, source: 'internal' }, true);
      resolved++;
      attention.push({ kind: 'done', what: `${num} asked a yes/no and an amount`, why: 'Split into two questions: the yes/no and the amount, shown only if the answer is Yes.' });
      continue;
    }

    // (5) a yes/no with its follow-up in the same item: "Já apresentou…? Se sim, qual?"
    const fu = FOLLOW_UP_INLINE.exec(foldedFull);
    if (fu && fu.index > 5) {
      const base = full.slice(0, fu.index + 1);
      const follow = full.slice(fu.index + fu[0].length - fu[1].length).trim();
      const baseRead = readText({ ...it, lines: [base] });
      const baseKind = decideKind(baseRead, { inAttachments, text: base });
      const parent: ProposalFieldItem = { tmpId: nextId(), page, kind: baseKind.kind === 'yes_no' ? 'yes_no' : baseKind.kind, label: labelOf(baseRead.label), instruction: null, required: !optional, options: [], expectedType: null, maxAgeMonths: null, number: num, source: 'internal' };
      push(parent, baseKind.clear || baseKind.kind === 'yes_no');
      const fk = decideKind({ label: follow, options: [], multiple: false, yesNo: false, choiceCue: false }, { inAttachments, text: follow });
      push({ tmpId: nextId(), page, kind: fk.kind, label: `${num} ${shorten(follow, 250)}`, instruction: null, required: true, options: [], expectedType: null, maxAgeMonths: null,
        ...(parent.kind === 'yes_no' ? { condition: { tmpId: parent.tmpId, value: 'yes' as const } } : {}), number: `${num}/2`, source: 'internal' }, true);
      resolved++;
      attention.push({ kind: 'done', what: `${num} had a follow-up in the same question`, why: 'Split into two questions: the follow-up is shown only if the answer is Yes.' });
      continue;
    }

    // (6) the ordinary question
    const rule = decideKind(read, { inAttachments, text: full });
    const ifYes = IF_YES.test(fold(full)); const ifNo = IF_NO.test(fold(full));
    const ctl = (ifYes || ifNo) && num ? parentYesNo(num) : null;
    const f: ProposalFieldItem = {
      tmpId: nextId(), page, kind: rule.kind, label: labelOf(read.label), instruction: null, required: !(optional || (rule.kind === 'file' && OTHER_DOCUMENTS.test(fold(read.label)))), options: rule.kind === 'single_choice' || rule.kind === 'multiple_choice' ? read.options : [],
      expectedType: null, maxAgeMonths: null, number: num, source: 'internal', ...(rule.extra ?? {}),
      ...(ctl ? { condition: { tmpId: ctl.tmpId, value: ifYes ? ('yes' as const) : ('no' as const) } } : {}),
    };
    if (rule.kind === 'file') {
      // A deadline only when THIS question's text states one ("emitida há menos de 3 meses"); "atualizada" alone is not one — it becomes a note to confirm.
      const age = explicitDocumentAgeMonths(full);
      if (age) f.maxAgeMonths = age;
      else if (FRESHNESS_HINT.test(fold(full))) attention.push({ kind: 'done', what: `${num ?? 'A document'} says the document must be up to date`, why: 'No deadline is written, so none was set. If the entity needs one (for example "issued less than 3 months ago"), set it on the question.' });
      const nounM = /(?:inclua|incluir|anexe|anexar|insira|include|attach|upload)\s+(?:um|uma|o|a|the|your)?\s*([^,.;:()]{6,80})/i.exec(full); if (nounM) f.expectedType = nounM[1].trim();
    }
    // the age brackets of the company: possibly out of date — said once, for this question
    if (AGE_OF_COMPANY.test(fold(read.label)) && f.options.some((o) => /\b(?:anos?|years?)\b/i.test(o))) {
      attention.push({ kind: 'outdated', what: `${num ?? 'A question'}: age brackets of the company`, why: 'Brackets for the age of the company may be out of date. Check them against this edition.' });
    }
    push(f, rule.clear || (!!ctl && rule.kind === 'short_text'));
    resolved++;
    if (kids.length > 0 && !it.absorbed) { /* children are read in their turn */ }
  }

  // sections -> pages, with the text each one covers (for an AI second opinion on just the parts that need it)
  const secItems = items.filter((i) => i.isSection);
  secItems.forEach((s, ix) => {
    const myFields = fields.filter((f) => f.page === s.section);
    const idxs = myFields.map((f) => fields.indexOf(f));
    const next = secItems[ix + 1];
    const startAt = items.indexOf(s); const endAt = next ? items.indexOf(next) : items.length;
    const text = items.slice(startAt, endAt).map((i) => [`${i.num} ${joinLines(i.lines)}`, ...i.bullets.map((b) => `- ${b}`)].join('\n')).join('\n');
    sections.push({ number: s.num, title: joinLines(s.lines), page: s.section, firstField: idxs.length ? Math.min(...idxs) : -1, lastField: idxs.length ? Math.max(...idxs) : -1, text });
  });

  // the name of the call: a header that repeats on every page and is not the generic name of the kind of document
  const generic = /^(?:application form|formulario de candidatura|formulario|candidatura|form|application)$/;
  const nameLine = furniture.find((l) => !generic.test(fold(l).trim()) && l.length <= 80);
  const general: ProposalGeneral = nameLine ? { name: nameLine } : {};

  // template tables with numbered columns ("Competitor #1, #2, …") the reader CAN read: a Table (criteria as rows, competitors as columns); any other structure stays unresolved
  const tableSolved = new Set<number>();
  blocks.forEach((b, bi) => {
    const t = readTemplateTable(b);
    if (!t) return;
    tableSolved.add(bi);
    const an = b.afterNumber;
    const idxs = an ? fields.map((f, i) => (f.number === an || f.number?.startsWith(`${an}.`) || f.number?.startsWith(`${an}/`) ? i : -1)).filter((i) => i >= 0) : [];
    const at = idxs.length ? Math.max(...idxs) + 1 : fields.length;
    const page = fields[Math.max(0, at - 1)]?.page ?? 1;
    fields.splice(at, 0, { tmpId: nextId(), page, kind: 'table', label: t.title, instruction: t.instruction ? shorten(t.instruction, 600) : null, required: false, options: [], expectedType: null, maxAgeMonths: null, table: t.table, number: null, source: 'internal' });
    questions++; clearTypes++;
    attention.push({ kind: 'done', what: `Template table “${t.title}”`, why: `Competitive analysis table: criteria as rows, competitors as columns; applicants can add columns. ${t.note}` });
  });
  // structures that were not read
  const unresolved: UnresolvedBlock[] = blocks.filter((_, bi) => !tableSolved.has(bi)).map((b) => ({ ...b, text: b.text.slice(0, 2000) }));
  const coverage = candidatesCount === 0 ? 0 : Math.min(1, resolved / candidatesCount);
  const typeConfidence = questions === 0 ? 0 : clearTypes / questions;
  void numberedCount;
  return { fields, attention, general, sections, quality: { candidates: candidatesCount, resolved: Math.min(resolved, candidatesCount), coverage, questions, clearTypes, typeConfidence, unresolved, weak } };
}
