// Investor Workspace Pipeline (prompt 58) — deterministic match score
// between an investor's thesis (matchdeal_profiles kind='investor', the
// Prompt 57 About form) and a startup's round (orgs table). Pure function,
// no I/O, same spirit as rules.ts. Weights below are the whole formula —
// this IS the "show the formula before applying" artifact.
//
// Weights (sum to 100):
//   sector match       35 — investor.sectors ∩ startup.sectors non-empty
//   stage match        25 — startup.stage ∈ investor.stages_invested
//   ticket plausibility 20 — investor can plausibly write a check into this round
//   geography match     10 — startup.country ∈ investor.geographies
//   instrument match    10 — investor.instruments ∩ startup.round_instruments non-empty
// An investor field left blank is treated as "no constraint" (full credit,
// not a penalty) — an incomplete profile shouldn't zero out every startup.
//
// Prompt 200 §C — exclusões são a única excepção a essa regra de "em branco =
// sem restrição": não somam nem tiram pontos, curto-circuitam a 0. Decisão do
// Nuno (2026-08-15): hard filter, porque "does not invest in foodtech" é uma
// declaração, não uma preferência. Ficam opcionais na interface para não
// obrigar cada chamador/teste a preenchê-las — ausente significa "sem
// exclusões", nunca "excluir tudo".

import { isSectorExcluded } from './sector-exclusions';

export interface InvestorThesis {
  sectors: string[];
  stagesInvested: string[];
  geographies: string[];
  instruments: string[];
  ticketMin: number | null;
  ticketMax: number | null;
  exclusionsSectors?: string[] | null;
  exclusionsNotes?: string | null;
}

export interface StartupRound {
  sectors: string[];
  stage: string | null;
  country: string | null;
  roundTargetEur: number | null;
  roundMinTicketEur: number | null;
  roundInstruments: string[];
}

export interface MatchResult {
  score: number; // 0-100
  reasons: string[]; // which weighted components matched, for the "92% match — sector, stage, ticket" label
}

const WEIGHTS = { sector: 35, stage: 25, ticket: 20, geography: 10, instrument: 10 };

function overlaps(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x));
}

// A check is plausible if the investor's max is at least the round's stated
// minimum ticket (can afford to participate) and the investor's min doesn't
// exceed the whole round target (isn't only writing checks bigger than the
// round itself).
function ticketPlausible(thesis: InvestorThesis, round: StartupRound): boolean {
  if (thesis.ticketMin == null && thesis.ticketMax == null) return true;
  if (round.roundMinTicketEur != null && thesis.ticketMax != null && thesis.ticketMax < round.roundMinTicketEur) return false;
  if (round.roundTargetEur != null && thesis.ticketMin != null && thesis.ticketMin > round.roundTargetEur) return false;
  return true;
}

export function computeMatchScore(thesis: InvestorThesis, round: StartupRound): MatchResult {
  // Antes de qualquer peso: uma exclusão elimina, não penaliza. reasons fica
  // com 'excluded' sozinho para quem quiser distinguir "0 porque não bate em
  // nada" de "0 porque o investidor disse explicitamente que não".
  if (isSectorExcluded(round.sectors, thesis.exclusionsSectors, thesis.exclusionsNotes)) {
    return { score: 0, reasons: ['excluded'] };
  }

  let score = 0;
  const reasons: string[] = [];

  if (thesis.sectors.length === 0 || overlaps(thesis.sectors, round.sectors)) {
    score += WEIGHTS.sector;
    if (thesis.sectors.length > 0) reasons.push('sector');
  }
  if (thesis.stagesInvested.length === 0 || (round.stage != null && thesis.stagesInvested.includes(round.stage))) {
    score += WEIGHTS.stage;
    if (thesis.stagesInvested.length > 0) reasons.push('stage');
  }
  if (ticketPlausible(thesis, round)) {
    score += WEIGHTS.ticket;
    if (thesis.ticketMin != null || thesis.ticketMax != null) reasons.push('ticket');
  }
  if (thesis.geographies.length === 0 || (round.country != null && thesis.geographies.includes(round.country))) {
    score += WEIGHTS.geography;
    if (thesis.geographies.length > 0) reasons.push('geography');
  }
  if (thesis.instruments.length === 0 || round.roundInstruments.length === 0 || overlaps(thesis.instruments, round.roundInstruments)) {
    score += WEIGHTS.instrument;
    if (thesis.instruments.length > 0 && round.roundInstruments.length > 0) reasons.push('instrument');
  }

  return { score, reasons };
}
