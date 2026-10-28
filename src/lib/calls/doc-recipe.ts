// Prompt 918 (I2) — the "recipe" of a document rule: what the platform looks for in a file to decide whether it is the right document, and what it reads from it. The admin does NOT confirm recipes
// (decision of Nuno, 16/10/2026): the platform prepares one when the rule is saved, from the TEXT THE ENTITY WROTE (the question, its instruction, the rule's note — all of it also read by applicants),
// and shows it read-only under "How we check this document". Pure and deterministic: it never calls an AI and never looks at an applicant's data. A recipe belongs to ONE call, one question and one
// version of the rules — it is never shared between calls (a duplicated call gets a copy of its own).
import type { EligibilityRule } from './eligibility';
import type { FormField } from './types';

export type ExtractKey = 'legal_name' | 'tax_id' | 'issue_date' | 'valid_until' | 'access_code' | 'registered_office' | 'period';

export interface DocType {
  key: string;
  label: string;
  /** What the entity may write for this document (Portuguese and English), matched case- and accent-insensitively in the entity's text. */
  detect: RegExp;
  /** Other names the document goes by. */
  alternativeNames: string[];
  /** Words and headings that appear in the text of the real document (lowercase, without accents): the "right document" check looks for them in the extracted text. */
  headers: string[];
  issuer: string | null;
  extract: ExtractKey[];
  /** A code printed on the document that lets someone confirm it with the issuer (shown to the person who validates, with the portal). */
  accessCode: RegExp | null;
  verification: { portal: string; portalName: string } | null;
}

export const DOC_TYPES: DocType[] = [
  {
    key: 'permanent_certificate', label: 'Permanent Certificate (Certidão Permanente)',
    detect: /certidao\s+permanente|permanent\s+(commercial\s+)?(registry\s+)?certificate|commercial\s+regist(ry|ration)\s+certificate|certidao\s+de\s+registo\s+comercial/,
    alternativeNames: ['Certidão Permanente', 'Certidão Permanente de Registo Comercial', 'Permanent Certificate', 'Commercial Registry Certificate'],
    headers: ['certidao permanente', 'registo comercial', 'conservatoria do registo comercial', 'matricula', 'codigo de acesso'],
    issuer: 'Conservatória do Registo Comercial (Portal da Empresa)', extract: ['legal_name', 'tax_id', 'registered_office', 'access_code', 'valid_until', 'issue_date'],
    accessCode: /\b\d{4}-\d{4}-\d{4}\b/, verification: { portal: 'https://www.portaldaempresa.pt/', portalName: 'Portal da Empresa' },
  },
  {
    key: 'ies', label: 'Simplified Business Information (IES)',
    detect: /informacao\s+empresarial\s+simplificada|\bIES\b|simplified\s+business\s+information/i,
    alternativeNames: ['IES', 'Informação Empresarial Simplificada'], headers: ['informacao empresarial simplificada', 'ies', 'anexo a'],
    issuer: 'Autoridade Tributária e Aduaneira', extract: ['legal_name', 'tax_id', 'period', 'issue_date'], accessCode: null, verification: null,
  },
  {
    key: 'tax_clearance', label: 'Tax clearance (Declaração de não dívida às Finanças)',
    detect: /nao\s+divida.{0,40}(financas|tribut)|situacao\s+tributaria|tax\s+(clearance|compliance)|no\s+tax\s+debt/,
    alternativeNames: ['Declaração de não dívida às Finanças', 'Certidão de situação tributária regularizada', 'Tax clearance certificate'],
    headers: ['autoridade tributaria', 'situacao tributaria', 'nao e devedor', 'divida'], issuer: 'Autoridade Tributária e Aduaneira',
    extract: ['legal_name', 'tax_id', 'issue_date', 'access_code'], accessCode: null, verification: { portal: 'https://www.portaldasfinancas.gov.pt/', portalName: 'Portal das Finanças' },
  },
  {
    key: 'social_security_clearance', label: 'Social security clearance (Declaração de não dívida à Segurança Social)',
    detect: /seguranca\s+social|social\s+security/,
    alternativeNames: ['Declaração de não dívida à Segurança Social', 'Social security statement'], headers: ['seguranca social', 'situacao contributiva', 'nao e devedor'],
    issuer: 'Instituto da Segurança Social', extract: ['legal_name', 'tax_id', 'issue_date', 'access_code'], accessCode: null, verification: { portal: 'https://www.seg-social.pt/', portalName: 'Segurança Social Direta' },
  },
  {
    key: 'articles_of_association', label: 'Articles of association (Pacto social / Escritura)',
    detect: /pacto\s+social|articles\s+of\s+association|escritura\s+de\s+constituicao|memorandum\s+of\s+association|company\s+statutes/,
    alternativeNames: ['Pacto Social', 'Escritura de Constituição', 'Articles of Association'], headers: ['pacto social', 'estatutos', 'denominacao', 'capital social'],
    issuer: null, extract: ['legal_name', 'tax_id', 'registered_office'], accessCode: null, verification: null,
  },
  {
    key: 'financial_statements', label: 'Financial statements',
    detect: /demonstracoes\s+financeiras|financial\s+statements|balance\s+sheet|balancete|annual\s+accounts|profit\s+and\s+loss/,
    alternativeNames: ['Demonstrações financeiras', 'Balanço', 'Balance sheet', 'Annual accounts'], headers: ['balanco', 'demonstracao de resultados', 'ativo', 'passivo', 'balance sheet', 'profit and loss'],
    issuer: null, extract: ['legal_name', 'period'], accessCode: null, verification: null,
  },
  {
    key: 'pitch_deck', label: 'Pitch deck',
    detect: /pitch\s*deck|investor\s+(deck|presentation)|apresentacao\s+(a\s+)?investidores/,
    alternativeNames: ['Pitch deck', 'Investor presentation'], headers: [], issuer: null, extract: [], accessCode: null, verification: null,
  },
  {
    key: 'business_plan', label: 'Business plan',
    detect: /plano\s+de\s+negocio|business\s+plan/,
    alternativeNames: ['Plano de negócio', 'Business plan'], headers: ['plano de negocio', 'business plan', 'executive summary', 'sumario executivo'], issuer: null, extract: [], accessCode: null, verification: null,
  },
  {
    key: 'cap_table', label: 'Cap table',
    detect: /cap(italization)?\s*table|tabela\s+de\s+capital|composicao\s+do\s+capital/,
    alternativeNames: ['Cap table', 'Tabela de capital'], headers: ['cap table', 'capital', 'shareholder', 'acionista', 'socio'], issuer: null, extract: ['legal_name'], accessCode: null, verification: null,
  },
];

export const docTypeByKey = (key: string | null | undefined): DocType | null => DOC_TYPES.find((d) => d.key === key) ?? null;

/** Lowercase and without accents: the entity writes "Certidão", the regular expressions above say "certidao". */
export const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The first document type the entity's text names, or null. */
export function detectDocType(text: string): DocType | null {
  const t = fold(text);
  return DOC_TYPES.find((d) => d.detect.test(t)) ?? null;
}

/** "issued less than 3 months ago" / "há menos de 3 meses" / "within the last 6 months" → 3 / 3 / 6 (years ×12). null when the text says nothing about age. */
export function maxAgeFromText(text: string): number | null {
  const t = fold(text);
  const m = t.match(/(?:menos\s+de|less\s+than|within(?:\s+the\s+last)?|no\s+more\s+than|ate|up\s+to|nao\s+superior\s+a|inferior\s+a)\s+(\d{1,3})\s*(mes(?:es)?|months?|anos?|years?)/)
    ?? t.match(/(\d{1,3})\s*(mes(?:es)?|months?|anos?|years?)\s+(?:atras|ago|old)/);
  if (!m) return null;
  const n = Number(m[1]);
  return /ano|year/.test(m[2]) ? n * 12 : n;
}

export interface DocRecipe {
  /** The key of the document type recognised, or null: then the platform cannot tell the right document by itself and a person validates every one. */
  docType: string | null;
  docTypeLabel: string | null;
  alternativeNames: string[];
  headers: string[];
  issuer: string | null;
  extract: ExtractKey[];
  /** What is compared with what the applicant declared: the field of the declared value (null = nothing to compare with). */
  compare: { what: ExtractKey; fieldId: string | null; label: string }[];
  maxAgeMonths: number | null;
  /** The code printed on the document, and where to confirm it. */
  accessCodePattern: string | null;
  verification: { portal: string; portalName: string } | null;
  /** In plain words, what could not be prepared (so the page says it instead of pretending). */
  notes: string[];
}

export interface PreparedRecipe { recipe: DocRecipe; sourceText: string }

/**
 * The recipe of a document rule. `rule` may be a doc_present / doc_right / doc_valid / doc_authentic rule; `fields` lets "compare with the name / tax ID declared" point at the declared question.
 * Prepared ONLY from the entity's own words: the question's label and instruction, what the entity wrote as the expected type, and the rule's note.
 */
export function prepareRecipe(rule: Pick<EligibilityRule, 'kind' | 'params' | 'note'>, field: Pick<FormField, 'label' | 'instruction' | 'expectedType' | 'maxAgeMonths'>, fields: Pick<FormField, 'id' | 'label'>[]): PreparedRecipe {
  const p = rule.params as unknown as Record<string, unknown>;
  const sourceText = [field.label, field.instruction, field.expectedType, rule.note].filter((x): x is string => !!x && x.trim() !== '').join(' · ');
  const chosen = docTypeByKey(typeof p.docType === 'string' ? p.docType : null);
  const dt = chosen ?? detectDocType(sourceText);
  const notes: string[] = [];
  const maxAge = rule.kind === 'doc_valid' && typeof p.maxAgeMonths === 'number' ? p.maxAgeMonths : maxAgeFromText(sourceText) ?? field.maxAgeMonths ?? null;
  const compare: DocRecipe['compare'] = [];
  const declared = (id: unknown, what: ExtractKey, label: string) => {
    if (typeof id !== 'string') return;
    const f = fields.find((x) => x.id === id);
    if (f) compare.push({ what, fieldId: f.id, label: `${label} in the document ↔ “${f.label}”` });
  };
  if (rule.kind === 'doc_valid') { declared(p.matchName, 'legal_name', 'Company name'); declared(p.matchTaxId, 'tax_id', 'Tax ID'); }
  if (!dt && (rule.kind === 'doc_right' || rule.kind === 'doc_valid')) notes.push('The text of this question does not name a kind of document the platform knows: it cannot tell by itself whether a file is the right one, so a person will validate each one.');
  if (dt && dt.headers.length === 0 && rule.kind === 'doc_right') notes.push('This kind of document has no fixed wording to look for: the platform checks that a readable file was attached and a person judges the rest.');
  if (rule.kind === 'doc_valid' && maxAge === null && compare.length === 0) notes.push('No age limit and nothing to compare was set: the platform only checks that the document can be read.');
  return {
    sourceText,
    recipe: {
      docType: dt?.key ?? null, docTypeLabel: dt?.label ?? null, alternativeNames: dt?.alternativeNames ?? [], headers: dt?.headers ?? [], issuer: dt?.issuer ?? null,
      extract: rule.kind === 'doc_present' ? [] : dt?.extract ?? [], compare, maxAgeMonths: rule.kind === 'doc_valid' ? maxAge : null,
      accessCodePattern: dt?.accessCode ? dt.accessCode.source : null, verification: dt?.verification ?? null, notes,
    },
  };
}

/** What "How we check this document" says, line by line (read-only text for the entity). */
export function recipeLines(r: DocRecipe): string[] {
  const out: string[] = [];
  if (r.docTypeLabel) out.push(`We look for: ${r.docTypeLabel}.`);
  if (r.alternativeNames.length > 0) out.push(`Other names we accept: ${r.alternativeNames.join('; ')}.`);
  if (r.headers.length > 0) out.push(`Words we expect in the text of the document: ${r.headers.join(', ')}.`);
  if (r.issuer) out.push(`Issued by: ${r.issuer}.`);
  const labels: Record<ExtractKey, string> = { legal_name: 'company name', tax_id: 'tax ID', issue_date: 'issue date', valid_until: 'validity date', access_code: 'access code', registered_office: 'registered office', period: 'period covered' };
  if (r.extract.length > 0) out.push(`We read from it: ${r.extract.map((k) => labels[k]).join(', ')}.`);
  for (const c of r.compare) out.push(`We compare: ${c.label}.`);
  if (r.maxAgeMonths) out.push(`It must have been issued within the last ${r.maxAgeMonths} month${r.maxAgeMonths === 1 ? '' : 's'}.`);
  if (r.verification) out.push(`Verification: the code printed on it can be confirmed at the ${r.verification.portalName} (${r.verification.portal}).`);
  for (const n of r.notes) out.push(n);
  return out;
}
