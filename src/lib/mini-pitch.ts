// Prompt 334 — the mini-pitch: 5 auto-generated slides synthesized from the
// claims registry (Prompt 219, src/lib/company-claims.ts). This file is the
// SELECTION layer only, and it is deliberately pure and mechanical, same
// discipline as classifyEvidence itself: "escolher 2-3 claims da classe mais
// alta DISPONÍVEL" is code, not a model call. The AI (wired in the API
// route, not here) only ever writes short copy OVER claims this file has
// already picked — it never decides which claims matter.
import type { ClaimCategory, ClaimSpecificity, ClaimStatus, EvidenceClass, DocumentRef, ClaimSourceKind } from './types';

export type MiniPitchClaim = {
  id: string;
  category: ClaimCategory;
  statement: string;
  evidenceClass: EvidenceClass;
  specificity: ClaimSpecificity;
  status: ClaimStatus;
  sourceKind: ClaimSourceKind;
  sourceRef?: string | null;
  documentRefs?: DocumentRef[];
};

// The lightest Vault sharing level — see supabase/migrations/0100 (rename
// of doc_visibility's old 'link_anyone' to 'open'). Only claims backed
// EXCLUSIVELY by documents at this level are eligible; a claim citing even
// one due_diligence/on_grant document as evidence is excluded entirely
// (evidence is all-or-nothing — never drop just the restricted reference
// and keep the claim, that would silently change what the claim means).
const LIGHTEST_VAULT_VISIBILITY = 'open';

function claimDocumentIds(claim: MiniPitchClaim): string[] {
  const ids = (claim.documentRefs ?? []).map((d) => d.documentId);
  if (claim.sourceKind === 'vault_doc' && claim.sourceRef) ids.push(claim.sourceRef);
  return ids;
}

// Only claims with `status === 'accepted'` ever reach an investor-facing
// surface (company_claims' own table comment) — profile/roadmap/founder-
// answer-sourced claims carry no document at all and are never restricted
// by this check; only claims backed by a Vault document are.
export function filterEligibleClaims(claims: MiniPitchClaim[], documentVisibilityById: Record<string, string>): MiniPitchClaim[] {
  return claims.filter((c) => {
    if (c.status !== 'accepted') return false;
    const docIds = claimDocumentIds(c);
    if (docIds.length === 0) return true;
    return docIds.every((id) => documentVisibilityById[id] === LIGHTEST_VAULT_VISIBILITY);
  });
}

const SPECIFICITY_ORDER: Record<ClaimSpecificity, number> = { high: 0, medium: 1, low: 2 };

function byStrength(a: MiniPitchClaim, b: MiniPitchClaim): number {
  return a.evidenceClass - b.evidenceClass || SPECIFICITY_ORDER[a.specificity] - SPECIFICITY_ORDER[b.specificity];
}

// Slide 2 — "Why now": market/timing claims. Never invents a market: with
// no `mercado_timing` claim at all, collapses to the problem/solution
// mechanism instead (still real, founder-stated content) — never both
// absent unless there's truly nothing to say.
export function selectWhyNowClaims(claims: MiniPitchClaim[]): MiniPitchClaim[] {
  const timing = claims.filter((c) => c.category === 'mercado_timing').sort(byStrength);
  if (timing.length > 0) return timing.slice(0, 2);
  return claims.filter((c) => c.category === 'problema' || c.category === 'solucao').sort(byStrength).slice(0, 2);
}

// Slide 3 — "Proof", the adaptive heart of the pitch: 2-3 claims from the
// HIGHEST evidence class actually available. Class 5 (decoration) never
// leads — if nothing stronger than decoration exists, there is no proof to
// show yet (the slide collapses; a pitch that opens with an award instead of
// a customer is fabricating credibility it hasn't earned). `exclude` keeps a
// claim already used on the Why-now slide from being repeated here.
export function selectProofClaims(claims: MiniPitchClaim[], exclude: Set<string> = new Set()): MiniPitchClaim[] {
  const pool = claims.filter((c) => !exclude.has(c.id) && c.category !== 'mercado_timing' && c.category !== 'funding' && c.category !== 'ask');
  const usable = pool.filter((c) => c.evidenceClass < 5);
  if (usable.length === 0) return [];
  const topClass = Math.min(...usable.map((c) => c.evidenceClass)) as EvidenceClass;
  const primary = usable.filter((c) => c.evidenceClass === topClass).sort(byStrength);
  const picked = primary.slice(0, 3);
  if (picked.length < 3) {
    const pickedIds = new Set(picked.map((c) => c.id));
    // Decoration only ever fills a remaining seat next to a real claim,
    // never occupies one alone — `usable.length === 0` above already
    // guarantees `picked` is non-empty by the time filler is considered.
    const filler = pool.filter((c) => !pickedIds.has(c.id)).sort(byStrength);
    picked.push(...filler.slice(0, 3 - picked.length));
  }
  return picked;
}

// Slide 4 — "Team": why these founders, specifically.
export function selectTeamClaims(claims: MiniPitchClaim[]): MiniPitchClaim[] {
  return claims.filter((c) => c.category === 'equipa').sort(byStrength).slice(0, 2);
}

export type MiniPitchSlideKind = 'hook' | 'whyNow' | 'proof' | 'team' | 'ask';

export interface MiniPitchSlidePlan {
  kind: MiniPitchSlideKind;
  claims: MiniPitchClaim[];
}

// The full 5-slide skeleton, minus whichever slides collapse for lack of
// material. `hook` and `ask` carry no claims — they're built straight from
// org profile/round fields (see the API route), never claims.
export function buildMiniPitchPlan(eligibleClaims: MiniPitchClaim[]): MiniPitchSlidePlan[] {
  const slides: MiniPitchSlidePlan[] = [{ kind: 'hook', claims: [] }];
  const used = new Set<string>();

  const whyNow = selectWhyNowClaims(eligibleClaims);
  if (whyNow.length > 0) {
    slides.push({ kind: 'whyNow', claims: whyNow });
    whyNow.forEach((c) => used.add(c.id));
  }

  const proof = selectProofClaims(eligibleClaims, used);
  if (proof.length > 0) {
    slides.push({ kind: 'proof', claims: proof });
    proof.forEach((c) => used.add(c.id));
  }

  const team = selectTeamClaims(eligibleClaims);
  if (team.length > 0) slides.push({ kind: 'team', claims: team });

  slides.push({ kind: 'ask', claims: [] });
  return slides;
}

// ---------------------------------------------------------------------------
// Minimum gate — the mechanical, verifiable floor to activate MatchDeal's
// mini-pitch. Reuses fields the app already tracks (one_liner, sectors,
// stage, round_target_eur, intro_problem/intro_solution from migration
// 0218) rather than inventing a parallel completeness formula.
export interface MiniPitchOrgInput {
  oneLiner?: string | null;
  sectors?: string[] | null;
  stage?: string | null;
  roundTargetEur?: number | null;
  introProblem?: string | null;
  introSolution?: string | null;
}

export interface MiniPitchGateMissingField { key: string; label: string; href: string }
export interface MiniPitchGateResult { eligible: boolean; missing: MiniPitchGateMissingField[] }

export function checkMiniPitchGate(org: MiniPitchOrgInput, eligibleClaims: MiniPitchClaim[]): MiniPitchGateResult {
  const missing: MiniPitchGateMissingField[] = [];
  if (!org.oneLiner?.trim()) missing.push({ key: 'one_liner', label: 'One-liner', href: '/settings?tab=company' });
  if (!org.sectors || org.sectors.length === 0) missing.push({ key: 'sectors', label: 'Sector', href: '/settings?tab=company' });
  if (!org.stage) missing.push({ key: 'stage', label: 'Stage', href: '/settings?tab=company' });
  if (org.roundTargetEur == null) missing.push({ key: 'round_target_eur', label: 'Round target', href: '/settings?tab=company' });
  if (!org.introProblem?.trim() || !org.introSolution?.trim()) {
    missing.push({ key: 'intro_pitch', label: 'Intro pitch (problem & solution)', href: '/settings?tab=company' });
  }
  if (selectProofClaims(eligibleClaims).length === 0) {
    missing.push({ key: 'proof_claim', label: 'At least one usable claim for the Proof slide', href: '/readiness' });
  }
  return { eligible: missing.length === 0, missing };
}

// ---------------------------------------------------------------------------
// Staleness — a plain snapshot string, not a hash: cheap to compute, and a
// string compare is exactly as correct as a hash compare for "did any of
// these inputs change since the last generation", with no collision surface
// to reason about. Only fields that actually feed the generator belong here.
export function computeMiniPitchInputSnapshot(org: MiniPitchOrgInput & { roundUseOfFunds?: string | null }, eligibleClaims: MiniPitchClaim[]): string {
  return JSON.stringify({
    org: {
      oneLiner: org.oneLiner ?? null, sectors: [...(org.sectors ?? [])].sort(), stage: org.stage ?? null,
      roundTargetEur: org.roundTargetEur ?? null, introProblem: org.introProblem ?? null, introSolution: org.introSolution ?? null,
      roundUseOfFunds: org.roundUseOfFunds ?? null,
    },
    claims: [...eligibleClaims].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ id: c.id, statement: c.statement, evidenceClass: c.evidenceClass, status: c.status })),
  });
}

// ---------------------------------------------------------------------------
// Investor-facing projection — strips everything internal (claim ids, the
// evidence-class taxonomy itself, which category a slide's claims came
// from) before this ever reaches an investor. The founder's own preview
// reads the richer stored shape directly; only this projected shape is
// what dossier-fetch.ts forwards toward an investor.
export interface StoredMiniPitchSlide { kind: MiniPitchSlideKind; title?: string; body: string; claimIds?: string[] }
export interface MiniPitchSlideProjected { kind: MiniPitchSlideKind; title?: string; body: string }

export function projectMiniPitchForInvestor(slides: StoredMiniPitchSlide[]): MiniPitchSlideProjected[] {
  return slides.map((s) => ({ kind: s.kind, ...(s.title ? { title: s.title } : {}), body: s.body }));
}
