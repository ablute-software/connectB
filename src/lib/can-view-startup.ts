// Prompt 742 §B.1 — the relationship check /api/portal/document-picker never
// had: any signed-in user (a founder of another org, a brand-new self-serve
// account) could pass ANY orgId and read back that org's on_grant/due_diligence
// document NAMES — founder data ("Term sheet — Fundo X.pdf") — with nothing
// between the session check and the query. Found 26/09/2026 while reading the
// route for Part A; still open on main until this landed.
//
// "Related" is the union the dossier itself runs on, nothing narrower or wider:
//  - an ACTIVE data-room grant to that org (not revoked, not expired, an invite
//    already confirmed, org not closed) — the cheap answer, and the only one a
//    grantee who never completed an investor profile can give; or
//  - the org is in this investor's eligible set (published profile matching the
//    mandate, a recorded decision, an accepted referral, a portfolio
//    investment) — resolveInvestorOrgEligibility, Prompt 750's read-only Stage 1.
//
// NOT getPipelineWaves: that is the full Pipeline board — a dozen-plus queries
// AND a `reserve_pipeline_admissions` WRITE — and Prompt 750's own review caught
// exactly that mistake on the media route (one call per photo in a gallery).
// This answers a yes/no question and must not touch admissions.
import type { SupabaseClient } from '@supabase/supabase-js';
import { activeGrantOrgIds } from './portal-access';
import { resolveInvestorOrgEligibility } from './investor-pipeline';

export async function canViewStartup(
  admin: SupabaseClient, userId: string, email: string, personId: string | null, orgId: string,
): Promise<boolean> {
  if ((await activeGrantOrgIds(admin, email, personId)).includes(orgId)) return true;
  return (await resolveInvestorOrgEligibility(admin, userId, email, orgId)).eligible;
}
