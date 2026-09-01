// Prompt 341 — the single source of truth for "which version is current".
// Version and text live together: a future material change to the legal
// text means a NEW file (src/content/terms/v2.ts) plus bumping this
// constant, never a silent edit of v1's own text — TERMS_MARKDOWN_BY_VERSION
// is how getCurrentTermsMarkdown finds the right one without a chain of
// if/else that would need touching at every future bump.
import { TERMS_V1_MARKDOWN } from '../content/terms/v1';
import { TERMS_V2_MARKDOWN } from '../content/terms/v2';
import { TERMS_V3_MARKDOWN } from '../content/terms/v3';

// Prompt 514 — Clause 7.1(d)/(i) broadened (anti-scraping + no use of
// Content to train any AI model, competing or not, paid plan or free).
// A material legal change, so it is a version bump, not an edit of v2's
// text: shouldGateTerms below then requires every signed-in user to
// re-accept, which is the intended effect, not a regression.
// (Prompt 403 §C was the previous bump: new Clause 6.3, Vault security
// scanning.) Every superseded version stays importable/mapped below so
// acceptance rows recorded against it (old history) remain resolvable.
export const TERMS_VERSION = '3.0';

const TERMS_MARKDOWN_BY_VERSION: Record<string, string> = {
  '1.0': TERMS_V1_MARKDOWN,
  '2.0': TERMS_V2_MARKDOWN,
  '3.0': TERMS_V3_MARKDOWN,
};

export function getTermsMarkdown(version: string = TERMS_VERSION): string {
  // An unknown version string falls back to the CURRENT version's text, not
  // permanently to v1 — surfaced by the 403 bump: a hardcoded v1 fallback
  // here would have silently served stale terms for any bad/old lookup
  // forever, one version behind what the doc comment above already promises.
  return TERMS_MARKDOWN_BY_VERSION[version] ?? TERMS_MARKDOWN_BY_VERSION[TERMS_VERSION];
}

// Prompt 341 §B — the gate's own decision, pulled out of both
// /api/terms/status and TermsGateModal's own reasoning into one pure
// function: demo mode (no Supabase configured) never gates — there's no
// real account to record an acceptance against; a signed-out visitor has
// nothing to gate either (public routes like /terms itself, or the login/
// signup forms, are reached before any session exists). Once signed in,
// the row's version must match the CURRENT version exactly — an
// acceptance of an older version (simulating a future bump) is treated
// the same as no acceptance at all, which is what makes a version bump
// require re-acceptance with no extra branching anywhere else.
export function shouldGateTerms(
  params: { supabaseConfigured: boolean; signedIn: boolean; acceptedVersion: string | null },
  currentVersion: string = TERMS_VERSION,
): boolean {
  if (!params.supabaseConfigured || !params.signedIn) return false;
  return params.acceptedVersion !== currentVersion;
}

// The accept route's own idempotency check: a 23505 (unique_violation) on
// the (user_id, version) primary key means "already accepted, exactly the
// state this call is trying to reach" — not an error.
export function isDuplicateAcceptance(errorCode: string | null | undefined): boolean {
  return errorCode === '23505';
}
