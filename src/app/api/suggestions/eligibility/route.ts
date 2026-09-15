// Prompt 605 §B — may this account send a suggestion? Read-only, cheap, and
// the ONE thing the widget asks before showing the second option.
//
// The answer here is display-truth only: /api/support/submit re-runs exactly
// the same gate before writing a suggestion, and that is the enforcement
// point. Same split as `entitlements` in /api/me — a client that lies about
// eligibility gets a 403 from the write path, not a ticket.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { platformBadgesAvailable } from '@/lib/platform-badges-capability';
import { loadOrgPlatformBadges } from '@/lib/platform-badges-server';
import { loadInvestorPlatformBadges } from '@/lib/investor-platform-badges-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { supportSuggestionsAvailable } from '@/lib/support-suggestions-capability';
import { canSuggest, qualifyingBadge } from '@/lib/suggestions-gate';
import { isAmongFirstCompanies, loadRealCompanyCreationRecords } from '@/lib/suggestions-early-access';

const SHUT = { ok: true, canSuggest: false, badge: null as string | null };

export async function GET() {
  if (!authEnabled) return NextResponse.json(SHUT);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json(SHUT);
  if (!(await supportSuggestionsAvailable()) || !(await platformBadgesAvailable())) return NextResponse.json(SHUT);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json(SHUT);

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Founder path — unchanged badge check, per-org.
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (member?.org_id) {
    const badges = (await loadOrgPlatformBadges(admin, member.org_id as string)).map((b) => b.badge);
    const badgeQualified = canSuggest({ activeBadges: badges });
    // TEMPORARY (Prompt 703) — only spend the extra reads when a badge
    // alone doesn't already settle it; the ranking query is skipped entirely
    // for the common "already has a badge" case.
    const earlyAccess = badgeQualified
      ? false
      : isAmongFirstCompanies(await loadRealCompanyCreationRecords(admin), { kind: 'org', id: member.org_id as string });
    return NextResponse.json({
      ok: true, canSuggest: canSuggest({ activeBadges: badges, isAmongFirstCompanies: earlyAccess }), badge: qualifyingBadge(badges),
    });
  }

  // Investor path — no org_members row, so this is either an investor with
  // an active seat or nobody real. resolveActiveInvestorMember is the same
  // single source of truth every other portal route uses (investor-membership.ts).
  const investorMember = await resolveActiveInvestorMember(admin, user.id);
  if (investorMember) {
    const badges = (await loadInvestorPlatformBadges(admin, investorMember.catalog_entity_id)).map((b) => b.badge);
    const badgeQualified = canSuggest({ activeBadges: badges });
    const earlyAccess = badgeQualified
      ? false
      : isAmongFirstCompanies(await loadRealCompanyCreationRecords(admin), { kind: 'investor', id: investorMember.catalog_entity_id });
    return NextResponse.json({
      ok: true, canSuggest: canSuggest({ activeBadges: badges, isAmongFirstCompanies: earlyAccess }), badge: qualifyingBadge(badges),
    });
  }

  return NextResponse.json(SHUT);
}
