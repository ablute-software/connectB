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
//
// Prompt 714 (Fase 0 do pipeline adaptativo) — every criterion now has THREE
// outcomes, not two:
//   - the INVESTOR declared no preference on this dimension -> full credit
//     (unchanged from above);
//   - the investor declared a preference and the STARTUP's own data
//     contradicts it -> a known incompatibility, zero (unchanged);
//   - the investor declared a preference but the STARTUP hasn't filled that
//     field in yet -> "unknown", not "known incompatibility". This used to
//     be inconsistent per criterion (instrument/ticket silently gave full
//     credit for a blank startup field; stage/country silently gave zero) —
//     neither is "compatibility is known", so neither is right. An unknown
//     criterion is now excluded from BOTH the numerator and the denominator:
//     score is the % of the EVALUABLE weight the startup earned, not the %
//     of the full 100. A startup missing one declared-on dimension no longer
//     loses that dimension's points outright; it also can't inflate its
//     score by "matching" a check nobody could actually verify.
// unknownCriteria/coverage on the result let a caller (the Fase-0 measurement
// script, and eventually the card) show which dimensions are still
// unconfirmed, without penalizing or crediting them. reasons keeps its
// original per-criterion vocabulary but gains a '<criterion> (unconfirmed)'
// entry precisely when that dimension is both investor-declared AND
// startup-missing — the one case Nuno's spec calls "por confirmar"; a
// dimension the investor never declared a preference on never gets marked,
// full credit or not.

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

export type MatchCriterion = 'sector' | 'stage' | 'ticket' | 'geography' | 'instrument';

export interface MatchResult {
  score: number; // 0-100, over the total weight of the EVALUABLE criteria only (see header comment)
  reasons: string[]; // matched criteria, plus '<criterion> (unconfirmed)' — for the "92% match — sector, stage, ticket" label
  unknownCriteria: MatchCriterion[]; // criteria excluded from scoring because the startup hasn't filled that field in yet
  coverage: number; // 0-100, the % of the full 100-point weight that was actually evaluable this time
}

const WEIGHTS: Record<MatchCriterion, number> = { sector: 35, stage: 25, ticket: 20, geography: 10, instrument: 10 };

function overlaps(a: string[], b: string[]): boolean {
  return a.some((x) => b.includes(x));
}

type Outcome = 'earned' | 'zero' | 'missing';

function sectorOutcome(thesis: InvestorThesis, round: StartupRound): Outcome {
  if (thesis.sectors.length === 0) return 'earned'; // no preference declared
  if (round.sectors.length === 0) return 'missing'; // startup hasn't filled sectors in
  return overlaps(thesis.sectors, round.sectors) ? 'earned' : 'zero';
}

function stageOutcome(thesis: InvestorThesis, round: StartupRound): Outcome {
  if (thesis.stagesInvested.length === 0) return 'earned';
  if (round.stage == null) return 'missing';
  return thesis.stagesInvested.includes(round.stage) ? 'earned' : 'zero';
}

function geographyOutcome(thesis: InvestorThesis, round: StartupRound): Outcome {
  // orgs.country is the startup's HQ — the only geography field it has.
  // Prompt 714 checked for a separate "markets of operation" field
  // (orgs.*markets*/geographies, the way entities.invests_in_geographies
  // exists on the founder-side CRM's investor rows) so this could accept HQ
  // OR an operating market: no such field exists on orgs today. Noted here
  // and in the Fase-0 report rather than inventing one — HQ-only stays the
  // full extent of this criterion until a real field exists.
  if (thesis.geographies.length === 0) return 'earned';
  if (round.country == null) return 'missing';
  return thesis.geographies.includes(round.country) ? 'earned' : 'zero';
}

function instrumentOutcome(thesis: InvestorThesis, round: StartupRound): Outcome {
  if (thesis.instruments.length === 0) return 'earned';
  if (round.roundInstruments.length === 0) return 'missing'; // startup hasn't picked round instruments yet
  return overlaps(thesis.instruments, round.roundInstruments) ? 'earned' : 'zero';
}

// Three EUR figures are in play here and they mean different things:
//   - round.roundTargetEur      — the size of the whole round the startup is raising
//   - round.roundMinTicketEur   — the smallest ticket the startup will accept into it
//   - thesis.ticketMin/ticketMax — the check size range the INVESTOR writes
// A check is plausible if the investor's max is at least the round's stated
// minimum ticket (can afford to participate) and the investor's min doesn't
// exceed the whole round target (isn't only writing checks bigger than the
// round itself). Both are about the investor's check relative to the
// startup's OWN stated numbers — never to each other.
function ticketOutcome(thesis: InvestorThesis, round: StartupRound): Outcome {
  if (thesis.ticketMin == null && thesis.ticketMax == null) return 'earned'; // investor declared no check-size preference
  if (round.roundMinTicketEur == null && round.roundTargetEur == null) return 'missing'; // startup hasn't sized its round at all
  if (round.roundMinTicketEur != null && thesis.ticketMax != null && thesis.ticketMax < round.roundMinTicketEur) return 'zero';
  if (round.roundTargetEur != null && thesis.ticketMin != null && thesis.ticketMin > round.roundTargetEur) return 'zero';
  return 'earned';
}

export function computeMatchScore(thesis: InvestorThesis, round: StartupRound): MatchResult {
  // Antes de qualquer peso: uma exclusão elimina, não penaliza. reasons fica
  // com 'excluded' sozinho para quem quiser distinguir "0 porque não bate em
  // nada" de "0 porque o investidor disse explicitamente que não".
  if (isSectorExcluded(round.sectors, thesis.exclusionsSectors, thesis.exclusionsNotes)) {
    return { score: 0, reasons: ['excluded'], unknownCriteria: [], coverage: 100 };
  }

  const criteria: { key: MatchCriterion; declared: boolean; outcome: Outcome }[] = [
    { key: 'sector', declared: thesis.sectors.length > 0, outcome: sectorOutcome(thesis, round) },
    { key: 'stage', declared: thesis.stagesInvested.length > 0, outcome: stageOutcome(thesis, round) },
    { key: 'ticket', declared: thesis.ticketMin != null || thesis.ticketMax != null, outcome: ticketOutcome(thesis, round) },
    { key: 'geography', declared: thesis.geographies.length > 0, outcome: geographyOutcome(thesis, round) },
    { key: 'instrument', declared: thesis.instruments.length > 0, outcome: instrumentOutcome(thesis, round) },
  ];

  const reasons: string[] = [];
  const unknownCriteria: MatchCriterion[] = [];
  let earned = 0;
  let evaluableWeight = 0;

  for (const c of criteria) {
    const weight = WEIGHTS[c.key];
    if (c.outcome === 'missing') {
      unknownCriteria.push(c.key);
      // declared is always true here (an undeclared dimension is always
      // 'earned', never 'missing') but kept explicit rather than assumed.
      if (c.declared) reasons.push(`${c.key} (unconfirmed)`);
      continue; // out of both the numerator and the denominator
    }
    evaluableWeight += weight;
    if (c.outcome === 'earned') {
      earned += weight;
      if (c.declared) reasons.push(c.key);
    }
  }

  const score = evaluableWeight > 0 ? Math.round((earned / evaluableWeight) * 100) : 0;

  return { score, reasons, unknownCriteria, coverage: evaluableWeight };
}
