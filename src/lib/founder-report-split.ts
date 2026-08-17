// Prompt 220 §D — separar SWOT (negócio) de diagnóstico de execução de
// angariação, no relatório FOUNDER-ONLY.
//
// O SWOT é do PROJETO: mercado, produto, equipa, competição. Métricas de
// pipeline/outreach ("high pass rate", "116 of 759 contacted") não são
// fraquezas do negócio — são diagnóstico de como está a correr a angariação,
// outra coisa. Isto NÃO é sobre visibilidade a investidores: a regra raiz
// aplica-se por inteiro e nada disto muda o que sai do servidor — é só o
// framing correto dentro do relatório que só o founder vê.
//
// A deteção reutiliza violatesInvestorSafety (termo do funil + número, o
// detetor testado do 211) e acrescenta termos que só fazem sentido a falar
// do funil MESMO sem números ("outreach velocity", "pipeline concentration").
// Trade-off documentado: um falso positivo aqui ("passed EU certification
// in 2025") é um bullet mal arrumado numa página privada — irritante, não
// perigoso. Mantém-se o detetor grosseiro partilhado em vez de inventar um
// segundo, mais fino, que depois divergiria do travão real.
import { violatesInvestorSafety } from './investor-safe-swot';

// Termos inequívocos de execução de angariação mesmo SEM número por perto.
// Deliberadamente curtos de mais não: 'contacted'/'committed'/'pass' sozinhos
// aparecem em frases de negócio ("committed team") — esses só contam via o
// detetor número+termo.
const EXECUTION_TERMS = [
  'outreach', 'pipeline', 'pass rate', 'response rate',
  'investors reached', 'investors contacted', 'soft-circl', 'soft circl',
  'funding gap', 'investor engagement',
];

export function isFundraisingExecution(text: string): boolean {
  const lower = text.toLowerCase();
  if (EXECUTION_TERMS.some((t) => lower.includes(t))) return true;
  return violatesInvestorSafety(text) !== null;
}

// O índice ORIGINAL viaja com o bullet: as clarifications persistidas
// (review_clarifications) são keyed por (category, item_index) no array
// completo — filtrar sem preservar índices desalinharia silenciosamente
// clarifications já gravadas para o bullet errado.
export interface IndexedBullet { text: string; index: number }

export function splitFundraisingExecution(
  weaknesses: string[],
): { business: IndexedBullet[]; execution: IndexedBullet[] } {
  const business: IndexedBullet[] = [];
  const execution: IndexedBullet[] = [];
  weaknesses.forEach((text, index) => {
    (isFundraisingExecution(text) ? execution : business).push({ text, index });
  });
  return { business, execution };
}
