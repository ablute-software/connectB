// Prompt 208 §D.2 — classificação de respostas por AI.
//
// Partes puras: construir o pedido e ler a resposta. A chamada HTTP vive na
// rota (/api/classify-interaction) para isto poder ser testado sem rede — e
// porque a chave nunca pode chegar ao browser.
//
// Modelo próprio (AI_CLASSIFY_MODEL, default claude-haiku-4-5) e NÃO o
// AI_REVIEW_MODEL do compose: classificar um email são centenas de tokens,
// não milhares, e o composer é outra decisão de custo. Fora da quota Watson
// pela mesma razão — contar isto contra a quota de *drafts* do founder
// misturava duas coisas diferentes no mesmo contador.
import type { Classification, PassReasonCategory } from './types';

export const CLASSIFY_MODEL_DEFAULT = 'claude-haiku-4-5';

const VALID_CLASSIFICATIONS: Classification[] = [
  'awaiting', 'interested', 'meeting_request', 'question', 'pass', 'out_of_office', 'bounce', 'unclear',
];
const VALID_CATS: PassReasonCategory[] = [
  'valuation', 'check_size', 'geography', 'stage_too_early', 'thesis_mismatch', 'team', 'traction', 'other',
];

export interface ClassifySuggestion {
  classification: Classification;
  passReasonCategory?: PassReasonCategory;
  passReason?: string;
}

export function buildClassifyPrompt(content: string): string {
  return [
    'You are classifying ONE reply an investor sent to a startup founder.',
    'Answer with JSON only, no prose, no code fences.',
    '',
    'Fields:',
    '  classification: one of ' + VALID_CLASSIFICATIONS.join(', '),
    '  passReasonCategory: only when classification is "pass", one of ' + VALID_CATS.join(', '),
    '  passReason: only when classification is "pass" — the reason IN THEIR OWN WORDS,',
    '    quoted from the text. Never invent a reason that is not written there.',
    '    If they declined without giving a reason, use the empty string.',
    '',
    'Meanings that are easy to get wrong:',
    '  "awaiting" = they replied but this is not a decision yet.',
    '  "unclear" = you read it and genuinely cannot tell.',
    '  "pass" = they are declining to invest, however politely it is written.',
    '',
    'The reply:',
    '---',
    content,
    '---',
  ].join('\n');
}

// Tolerante ao que os modelos fazem na prática (cercas de código, texto à
// volta), mas NUNCA tolerante ao conteúdo: um valor fora da lista é rejeitado
// em vez de ser "corrigido" para o mais parecido. Preferimos não sugerir nada
// a sugerir uma classificação inventada — o founder confia no que aparece
// pré-seleccionado.
export function parseClassifyResponse(raw: string): ClassifySuggestion | null {
  const jsonText = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const c = obj.classification;
  if (typeof c !== 'string' || !VALID_CLASSIFICATIONS.includes(c as Classification)) return null;
  const classification = c as Classification;

  if (classification !== 'pass') return { classification };

  const catRaw = obj.passReasonCategory;
  const category = typeof catRaw === 'string' && VALID_CATS.includes(catRaw as PassReasonCategory)
    ? catRaw as PassReasonCategory
    : 'other';
  const reasonRaw = obj.passReason;
  const passReason = typeof reasonRaw === 'string' ? reasonRaw.trim() : '';

  return { classification, passReasonCategory: category, passReason };
}

// Um pass classificado por AI muda o status da entidade para 'passed' — é
// decisão a mais para ficar sem olho humano, mesmo com o founder a ver a
// sugestão. Por isso grava com needs_review: true, e a infra de revisão que
// já existe (needs_review/revertToNeedsReview) trata do resto.
export function aiNeedsReview(s: ClassifySuggestion): boolean {
  return s.classification === 'pass';
}
