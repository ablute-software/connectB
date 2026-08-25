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

// Prompt 379 §A — every gate link used to be the identical
// '/settings?tab=company', which lands on the top of the Company tab and, in
// the founder's own words, "does precisely nothing". Each now points at the
// section anchor (Prompt 377) AND names the exact field to flash, via the
// `?flash=` parameter settings/page.tsx reads.
//
// NO `#section` fragment here, deliberately — and this is the opposite of
// what it looks like it should be. The flash already scrolls to the exact
// FIELD, which lives inside the right section, so the anchor adds nothing;
// and when both are present the browser's own native jump to the anchor
// fires LATE (after hydration, after the cards finish loading) and undoes
// the flash scroll, leaving the highlighted field hundreds of pixels below
// the fold. Measured directly in live verification: with the anchor the
// field ended at top=747 in a 720px viewport every time, across three
// different scroll strategies; without it, top=344, in view. The anchor
// links used elsewhere (OverviewPanel/TodayPanel/RoadmapCard →
// #settings-round / #settings-identity) are unaffected — they carry no
// `flash` and still scroll by anchor exactly as before.
//
// Destinations verified by reading the cards, not assumed: `stage` and
// `round_target_eur` are edited in RoundCard, NOT in Identity —
// `identity.current_phase` is a different field (product maturity). The
// flash ids are CompletenessField ids, not org column names.
function settingsFlash(fieldId: string): string {
  return `/settings?flash=${fieldId}`;
}

export function checkMiniPitchGate(org: MiniPitchOrgInput, eligibleClaims: MiniPitchClaim[]): MiniPitchGateResult {
  const missing: MiniPitchGateMissingField[] = [];
  if (!org.oneLiner?.trim()) missing.push({ key: 'one_liner', label: 'One-liner', href: settingsFlash('identity.one_liner') });
  if (!org.sectors || org.sectors.length === 0) missing.push({ key: 'sectors', label: 'Sector', href: settingsFlash('identity.sectors') });
  if (!org.stage) missing.push({ key: 'stage', label: 'Stage', href: settingsFlash('round.stage') });
  if (org.roundTargetEur == null) missing.push({ key: 'round_target_eur', label: 'Round target', href: settingsFlash('round.target') });
  if (!org.introProblem?.trim() || !org.introSolution?.trim()) {
    missing.push({ key: 'intro_pitch', label: 'Intro pitch (problem & solution)', href: settingsFlash('identity.intro_pitch') });
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
export interface StoredMiniPitchSlide {
  kind: MiniPitchSlideKind; title?: string; body: string; claimIds?: string[];
  // Prompt 379 §C — the founder rewrote this slide's text by hand. Marks it
  // as work worth protecting: a regeneration must ASK before replacing it,
  // never overwrite silently. Kept alongside claimIds on purpose —
  // provenance survives an edit (§C.2).
  founderEdited?: boolean;
  // Prompt 379 §D — one optional image per slide, stored as a company_media
  // id and resolved to a signed URL at render time. NEVER a URL in the
  // jsonb: a deleted image must degrade the slide to text, not leave a
  // broken link behind (§D.4).
  mediaId?: string;
}
export interface MiniPitchSlideProjected {
  kind: MiniPitchSlideKind; title?: string; body: string;
  // mediaId is present on the projection ONLY between projectMiniPitchForInvestor
  // and the server-side media resolution in dossier-fetch.ts; it is stripped
  // there and replaced by the resolved fields below, so an investor never
  // receives a raw media id to enumerate.
  mediaId?: string;
  imageUrl?: string | null;
  imageCaption?: string | null;
}

export function projectMiniPitchForInvestor(slides: StoredMiniPitchSlide[]): MiniPitchSlideProjected[] {
  // Prompt 379 §C.4 — `founderEdited` is internal bookkeeping about HOW the
  // slide was produced; an investor must never see which slides the founder
  // rewrote by hand. Explicitly not spread: this builds the projected object
  // field by field precisely so a new internal field added to the stored
  // shape can never leak by default.
  return slides.map((s) => ({
    kind: s.kind,
    ...(s.title ? { title: s.title } : {}),
    body: s.body,
    // mediaId IS investor-facing (it's how the deck shows the image), but
    // it's only ever an id the server resolves — never a URL from the jsonb.
    ...(s.mediaId ? { mediaId: s.mediaId } : {}),
  }));
}

// Prompt 379 §C.3 — regeneration must respect the founder's own edits. This
// decides, per slide, what a fresh generation should do; the ROUTE never
// silently overwrites. `keepKinds` is what the founder explicitly chose to
// keep (empty on a first regeneration, when the UI hasn't asked yet).
export interface MiniPitchRegenChoice { kind: MiniPitchSlideKind; hadFounderEdit: boolean; kept: boolean }

export function mergeRegeneratedSlides(
  existing: StoredMiniPitchSlide[], regenerated: StoredMiniPitchSlide[], keepKinds: MiniPitchSlideKind[],
): { slides: StoredMiniPitchSlide[]; choices: MiniPitchRegenChoice[] } {
  const keep = new Set(keepKinds);
  const existingByKind = new Map(existing.map((s) => [s.kind, s]));
  const choices: MiniPitchRegenChoice[] = [];

  const slides = regenerated.map((fresh) => {
    const prior = existingByKind.get(fresh.kind);
    const hadFounderEdit = !!prior?.founderEdited;
    const kept = hadFounderEdit && keep.has(fresh.kind);
    choices.push({ kind: fresh.kind, hadFounderEdit, kept });
    if (!kept) return fresh;
    // Keeping the founder's text, but taking the FRESH provenance: the
    // claims behind the slide may legitimately have changed even when the
    // wording the founder wrote is still the wording they want.
    return { ...prior!, claimIds: fresh.claimIds, founderEdited: true };
  });

  return { slides, choices };
}

// ---------------------------------------------------------------------------
// Prompt 339 §B — the Level 0 "pitch available, express interest to unlock"
// teaser. Fail-closed by construction: true only at Level 0 (once level >=
// 1 the real slides render instead — never both at once) AND only when the
// founder actually activated a mini-pitch. Extracted as its own pure
// function purely so this exact gating logic is unit-testable without
// mounting DossierOverviewSections.
export function shouldShowMiniPitchTeaser(level: number, hasMiniPitch: boolean | undefined): boolean {
  return level === 0 && !!hasMiniPitch;
}
