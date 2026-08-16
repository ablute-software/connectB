// Prompt 212 §B.4 + §B.5 — detectar uma ronda passada escrita no roadmap, e
// dizer ao founder onde um número da ronda vai aparecer antes de o gravar.
//
// O princípio, nas palavras do Nuno: corrige-se num só local e aplica-se a
// todo o lado; qualquer alteração com efeitos em várias superfícies pede
// confirmação explícita. Só existe UM lado porque as superfícies leem todas
// da mesma fonte — o popup não sincroniza nada, apenas mostra o alcance do
// que já está prestes a acontecer.

// ---------------------------------------------------------------------------
// §B.4 — ronda passada escrita como milestone
//
// A armadilha: um milestone de roadmap é NORMALMENTE sobre o futuro
// ("Raise €300k seed" é o plano, não uma ronda fechada). Sugerir "registar
// como ronda anterior" a cada plano de fundraising seria um alarme constante
// e treinava o founder a fechá-lo sem ler — o mesmo erro que evitámos no
// aviso do 204(b).
//
// Por isso exige TRÊS sinais, não dois: montante + termo de ronda + prova de
// que já aconteceu (verbo no passado, ou um ano anterior ao corrente). Na
// dúvida não sugere: o custo de falhar uma sugestão é o founder escrever a
// linha à mão; o de sugerir a mais é ninguém voltar a ler os avisos.
const FUNDING_TERM = /\b(raise[sd]?|raising|round|seed|pre-?seed|ronda|levantad[oa]s?|angel|grant|bridge)\b/i;
const PAST_TENSE = /\b(raised|closed|secured|completed|levantad[oa]s?|fechad[oa]s?|concluíd[oa]s?|concluid[oa]s?)\b/i;

// €100k · 100k€ · €1.3M · 100,000 · 100.000
const AMOUNT = /(?:€\s*)?(\d[\d.,]*)\s*(k|m|mil|milh(?:ão|ao|ões|oes))?\s*(?:€|eur|euros)?/i;

export function parseAmountEur(text: string): number | null {
  const m = text.match(AMOUNT);
  if (!m) return null;
  const raw = m[1];
  const suffix = (m[2] ?? '').toLowerCase();

  // "100.000" é cem mil em PT, "1.3" é um vírgula três. Distingue-se pelo
  // número de dígitos depois do separador: 3 dígitos = milhares.
  let n: number;
  if (/[.,]\d{3}(?:\D|$)/.test(raw) || /^\d{1,3}([.,]\d{3})+$/.test(raw)) {
    n = Number(raw.replace(/[.,]/g, ''));
  } else {
    n = Number(raw.replace(',', '.'));
  }
  if (!Number.isFinite(n) || n <= 0) return null;

  if (suffix === 'k' || suffix === 'mil') n *= 1_000;
  else if (suffix.startsWith('m')) n *= 1_000_000;
  return Math.round(n);
}

export interface PastRoundHint { amountEur: number; suggestedLabel: string }

export function detectPastRound(
  text: string, opts: { periodYear?: number; currentYear: number },
): PastRoundHint | null {
  if (!FUNDING_TERM.test(text)) return null;

  const amountEur = parseAmountEur(text);
  if (amountEur == null) return null;

  const looksPast = PAST_TENSE.test(text)
    || (opts.periodYear != null && opts.periodYear < opts.currentYear);
  if (!looksPast) return null;

  // Rótulo sugerido: o termo que o founder usou, não uma categoria nossa.
  const term = text.match(FUNDING_TERM)?.[0] ?? 'Previous round';
  const label = term.charAt(0).toUpperCase() + term.slice(1).toLowerCase();
  return { amountEur, suggestedLabel: label };
}

// ---------------------------------------------------------------------------
// §B.5 — onde é que este número vai aparecer
//
// Lista curta e verdadeira, não um ensaio. Depende do estado real: com o
// toggle do progresso desligado (212 §A), o portal do investidor NÃO é
// destino do valor garantido, e dizer que era seria mentir no ecrã que
// existe para dizer a verdade.
export type RoundField = 'round_target_eur' | 'round_secured_eur' | 'funding_rounds';

export function propagationTargets(
  field: RoundField, opts: { progressVisibleToInvestors: boolean },
): string[] {
  const investorPortal = 'Investor portal (people you granted access to)';

  if (field === 'round_target_eur') {
    // O alvo é o pitch: sai sempre, e não depende do toggle (que protege o
    // progresso CONTRA o alvo, não o alvo).
    return ['Your company profile', investorPortal, 'Archive cards investors kept', 'Your next readiness review'];
  }

  if (field === 'round_secured_eur') {
    return [
      'Your company profile',
      ...(opts.progressVisibleToInvestors ? [investorPortal] : []),
      'Your next readiness review',
    ];
  }

  // funding_rounds — capital já levantado. Não entra no progresso desta
  // ronda nem na barra; entra onde se descreve a empresa.
  return ['Your company profile', 'Investor dossier (as company history)', 'Your next readiness review'];
}
