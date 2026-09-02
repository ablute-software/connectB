// Prompt 123 Block C.1 — Startups tab, full column rewrite. Aggregates plus
// two computed scores (completeness, visible-pipeline-size) — still no
// entity/person names, interaction content, or pipeline stage read out of
// another org's actual data (the Developer Viewer, not this list, is the
// sanctioned way to look inside one specific org — see backoffice/startups
// page's own header note).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { planAccountsAvailable } from '@/lib/plan-accounts-capability';
import { accountModerationAvailable } from '@/lib/account-moderation-capability';
import { calcCompanyCompleteness, type CompletenessEvidence } from '@/lib/companyCompleteness';
import { computeVisiblePipelineSize } from '@/lib/pipeline-unlock-server';
import type { CompanyPerson, Org } from '@/lib/types';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function startOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
  const monthStart = startOfMonthIso();

  const [
    { data: orgs, error }, { data: members }, { data: recentInteractions }, planManagement, moderationAvailable,
    { data: allPeople }, { data: allDocuments }, { data: allAiReviews },
    { data: allFolders }, { data: allCapTable }, { data: allTraction },
  ] = await Promise.all([
    admin.from('orgs').select('*'),
    admin.from('org_members').select('org_id, user_id'),
    admin.from('interactions').select('org_id').gte('occurred_at', weekAgo),
    planAccountsAvailable(),
    accountModerationAvailable(),
    admin.from('company_people').select('org_id, is_founder'),
    // Prompt 542 §2 — name + folder_id now, not just org_id: the
    // completeness bar counts a deck and a business plan, and Prompt 536 §4
    // recognises those by the folder a file sits in as well as its name.
    admin.from('documents').select('org_id, name, folder_id'),
    admin.from('ai_reviews').select('org_id').gte('created_at', monthStart),
    admin.from('folders').select('id, name'),
    admin.from('cap_table_entries').select('org_id'),
    admin.from('org_traction_metrics').select('org_id'),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Prompt 184 §4 — informative only, never a filter: MatchDeal is an
  // extra tool, not a requirement to be managed here (the same decision
  // that drove eligiblePipelineOrgIds off matchdeal_profiles.is_visible —
  // see portal-access.ts). 'not_started' for an org with zero
  // matchdeal_profiles rows, read straight from is_complete otherwise.
  const { data: matchDealProfiles } = await admin.from('matchdeal_profiles')
    .select('membership_id, is_complete').eq('kind', 'startup');
  const matchDealCompleteByOrg = new Map((matchDealProfiles ?? []).map((p) => [p.membership_id as string, !!p.is_complete]));

  const memberCountByOrg = new Map<string, number>();
  const userIdsByOrg = new Map<string, string[]>();
  for (const m of members ?? []) {
    memberCountByOrg.set(m.org_id, (memberCountByOrg.get(m.org_id) ?? 0) + 1);
    userIdsByOrg.set(m.org_id, [...(userIdsByOrg.get(m.org_id) ?? []), m.user_id]);
  }
  const interactionCountByOrg = new Map<string, number>();
  for (const i of recentInteractions ?? []) interactionCountByOrg.set(i.org_id, (interactionCountByOrg.get(i.org_id) ?? 0) + 1);
  const documentCountByOrg = new Map<string, number>();
  for (const d of allDocuments ?? []) documentCountByOrg.set(d.org_id, (documentCountByOrg.get(d.org_id) ?? 0) + 1);
  // Prompt 542 §2 — the three evidence dimensions, grouped once for the
  // whole list rather than queried per org: this route already reads every
  // org in one pass and must not become N+1 to add a bar input.
  const folderNameById = new Map((allFolders ?? []).map((f) => [f.id as string, f.name as string]));
  const evidenceByOrg = new Map<string, CompletenessEvidence>();
  function evidenceFor(orgId: string): CompletenessEvidence {
    let e = evidenceByOrg.get(orgId);
    if (!e) { e = { documents: [], capTableRows: 0, tractionRows: 0 }; evidenceByOrg.set(orgId, e); }
    return e;
  }
  for (const d of (allDocuments ?? []) as { org_id: string; name: string; folder_id: string | null }[]) {
    evidenceFor(d.org_id).documents.push({ name: d.name, folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? null : null });
  }
  for (const c of (allCapTable ?? []) as { org_id: string }[]) evidenceFor(c.org_id).capTableRows++;
  for (const t of (allTraction ?? []) as { org_id: string }[]) evidenceFor(t.org_id).tractionRows++;

  const aiReviewCountByOrg = new Map<string, number>();
  for (const r of allAiReviews ?? []) aiReviewCountByOrg.set(r.org_id, (aiReviewCountByOrg.get(r.org_id) ?? 0) + 1);
  const peopleByOrg = new Map<string, CompanyPerson[]>();
  for (const p of (allPeople ?? []) as CompanyPerson[]) peopleByOrg.set(p.org_id, [...(peopleByOrg.get(p.org_id) ?? []), p]);

  // last_sign_in_at lives on auth.users, not queryable via a join — one
  // bulk listUsers() call, then take the max across each org's members.
  const lastSignInByUser = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listErr) break;
    for (const u of data.users) lastSignInByUser.set(u.id, u.last_sign_in_at ?? null);
    if (data.users.length < 200) break;
    page++;
  }

  const pipelineSizes = await Promise.all((orgs ?? []).map((org) => computeVisiblePipelineSize(admin, org.id)));
  const pipelineByOrg = new Map((orgs ?? []).map((org, i) => [org.id, pipelineSizes[i]]));

  const result = (orgs ?? []).map((org) => {
    const userIds = userIdsByOrg.get(org.id) ?? [];
    const lastLogins = userIds.map((id) => lastSignInByUser.get(id)).filter(Boolean) as string[];
    const lastLogin = lastLogins.length ? lastLogins.sort().at(-1)! : null;
    const interactionsThisWeek = interactionCountByOrg.get(org.id) ?? 0;
    const daysSinceLogin = lastLogin ? (Date.now() - new Date(lastLogin).getTime()) / (24 * 60 * 60 * 1000) : Infinity;
    // Renamed from 'health' (active/quiet/dormant) to 'status' (active/
    // quiet/inactive) per §C.1 — same 3-way signal, doc's own label for the
    // third state. Distinct from moderation_status (active/suspended/
    // deleted), an orthogonal axis: an org can be moderation-active but
    // status=inactive (nobody's logged in in a month), or vice versa never
    // (a suspended org is excluded from this activity signal entirely by
    // virtue of no one being able to sign in to generate one).
    const status: 'active' | 'quiet' | 'inactive' =
      interactionsThisWeek > 0 && daysSinceLogin < 14 ? 'active' : daysSinceLogin < 30 ? 'quiet' : 'inactive';

    const people = peopleByOrg.get(org.id) ?? [];
    const { pct: completenessPct } = calcCompanyCompleteness(org as unknown as Org, people, evidenceFor(org.id));
    const pipeline = pipelineByOrg.get(org.id);
    const matchDealStatus: 'complete' | 'incomplete' | 'not_started' =
      !matchDealCompleteByOrg.has(org.id) ? 'not_started' : matchDealCompleteByOrg.get(org.id) ? 'complete' : 'incomplete';

    return {
      orgId: org.id, name: org.name, plan: org.plan, createdAt: org.created_at,
      planChangeRequested: (org.plan_change_requested as string | null | undefined) ?? null,
      planChangeRequestedAt: (org.plan_change_requested_at as string | null | undefined) ?? null,
      members: memberCountByOrg.get(org.id) ?? 0,
      completenessPct,
      interactionsThisWeek, lastLogin, status,
      filesInVault: documentCountByOrg.get(org.id) ?? 0,
      visiblePipelineSize: pipeline?.visible ?? 0,
      eligiblePoolSize: pipeline?.eligiblePoolSize ?? 0,
      stage: (org.stage as string | null | undefined) ?? null,
      aiDraftsThisMonth: (org.ai_drafts_used_this_month as number | null | undefined) ?? 0,
      aiReviewsThisMonth: aiReviewCountByOrg.get(org.id) ?? 0,
      matchDealStatus,
      moderationStatus: moderationAvailable ? ((org.moderation_status as string | undefined) ?? 'active') : 'active',
      moderationQuarantineUntil: moderationAvailable ? ((org.moderation_quarantine_until as string | null | undefined) ?? null) : null,
    };
  });

  return NextResponse.json({ ok: true, orgs: result, planManagement, moderationAvailable });
}
