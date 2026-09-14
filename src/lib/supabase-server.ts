// Server-only Supabase helpers (uses next/headers). Import from route handlers / server components only.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON, shareableCookieDomain, type Role } from './supabase';
import { resolveActiveInvestorMember } from './investor-membership';

export { authEnabled } from './supabase';

export async function serverClient() {
  const cookieStore = await cookies();
  const host = (await headers()).get('host');
  const domain = shareableCookieDomain(host);
  return createServerClient(SUPABASE_URL!, SUPABASE_ANON!, {
    cookieOptions: domain ? { domain } : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch { /* called from a Server Component — middleware refreshes instead */ }
      },
    },
  });
}

// @ablute.pt team members are developer/back-office regardless of a
// platform_admins row — see DECISIONS.md "ablute.pt domain admin access".
// Exported so provision-org (a different trust boundary, service-role only)
// can apply the exact same rule when deciding org-join, not just role.
export function isAbluteTeamEmail(email: string | undefined | null): boolean {
  // endsWith, not includes: 'x@notablute.pt' must NOT match. Case-insensitive
  // because email domains aren't case-sensitive in practice.
  return !!email && email.trim().toLowerCase().endsWith('@ablute.pt');
}

// Prompt 680/682 — the actual precedence decision, pulled out of resolveRole
// so it's testable without a Supabase client at all (same "pure half testable,
// read half not" split as investor-billing-access.ts). Order here IS the
// precedence: platform_admins beats everything; a non-closed org_members row
// (founder) beats both investor signals below it — this is deliberately
// UNCHANGED from what resolveRole already did before this prompt (measured:
// 5 of 6 users with an active matchdeal_investor_members row are also
// org_members, all internal QA-ish accounts — this keeps them resolving as
// 'founder', exactly as today, rather than introducing a new ambiguous case);
// either investor signal (access_grants OR an active investor membership)
// resolves to 'investor'; @ablute.pt is the last-resort developer fallback.
export function decideRole(signals: {
  isPlatformAdmin: boolean;
  hasOpenFounderOrg: boolean;
  hasAccessGrant: boolean;
  hasActiveInvestorMembership: boolean;
  isAbluteTeamEmailConfirmed: boolean;
}): Role {
  if (signals.isPlatformAdmin) return 'developer';
  if (signals.hasOpenFounderOrg) return 'founder';
  if (signals.hasAccessGrant || signals.hasActiveInvestorMembership) return 'investor';
  if (signals.isAbluteTeamEmailConfirmed) return 'developer';
  return 'none';
}

export async function resolveRole(
  userId: string,
  email: string | undefined,
  sb: Awaited<ReturnType<typeof serverClient>>,
  // Hard requirement (DECISIONS.md): the @ablute.pt grant below only ever
  // applies to a Supabase-CONFIRMED email. Omitted/undefined = treated as
  // unconfirmed (fail closed) — every call site is expected to pass
  // user.email_confirmed_at from the same auth.getUser() call that produced
  // `email`, never to skip this parameter.
  emailConfirmedAt?: string | null,
): Promise<Role> {
  const [{ data: admin }, { data: member }] = await Promise.all([
    sb.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle(),
  ]);
  // Prompt 556 §D — a member of a CLOSED org is not a founder. An org is
  // closed when its last member was deleted (orgs.closed_at, migration
  // 0305), so this can only be reached if a member row was created against
  // an already-closed org — which is exactly the case worth refusing:
  // re-creating a user with the same email must not silently reattach them
  // to the account that ended. They fall through to the investor/none
  // branches below, and provisioning gives them a fresh org.
  let hasOpenFounderOrg = false;
  if (member) {
    const { data: org } = await sb.from('orgs').select('closed_at').eq('id', member.org_id).maybeSingle();
    hasOpenFounderOrg = !org?.closed_at;
  }
  // An explicit access_grants row (a deliberate act — a founder sharing
  // their data room, or a back-office admin approving an investor access
  // request) outranks the blanket @ablute.pt-domain fallback below. Without
  // this order, a confirmed @ablute.pt account could never resolve as
  // 'investor' no matter what it's been granted — which is exactly what
  // blocked using an @ablute.pt account to test the investor portal.
  let hasAccessGrant = false;
  if (email) {
    const { data: grant } = await sb.from('access_grants').select('id').eq('grantee_email', email).limit(1).maybeSingle();
    hasAccessGrant = !!grant;
  }
  // Prompt 680/682 — access_grants (above) only ever covers the founder-
  // invite path. The newer /claim -> investor_entity_claims -> approved ->
  // matchdeal_investor_members path (catalog claims, Prompt 584+) was never
  // wired into role resolution at all: a claimed-and-approved investor with
  // no separate access_grants row resolved to 'none', which "has no home on
  // the platform" (landing-redirect.ts) — confirmed in production for
  // Portugal Ventures ahead of its pilot (Prompt 680 Fase 1). Reuses the
  // exact active-membership predicate /portal itself already uses
  // (resolveActiveInvestorMember, investor-membership.ts) rather than a
  // second criterion. allowBillingLapsed:true is deliberate: ROLE is coarse
  // routing ("which app do you belong in"), not feature gating — a
  // billing-lapsed investor firm must still resolve as 'investor' and land
  // in /portal to see its own reactivate banner, not bounce to the public
  // landing the way 'none' does.
  let hasActiveInvestorMembership = false;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const investorAdmin = createClient(SUPABASE_URL!, serviceKey, { auth: { persistSession: false } });
    const member2 = await resolveActiveInvestorMember(investorAdmin, userId, { allowBillingLapsed: true });
    hasActiveInvestorMembership = !!member2;
  }
  return decideRole({
    isPlatformAdmin: !!admin,
    hasOpenFounderOrg,
    hasAccessGrant,
    hasActiveInvestorMembership,
    isAbluteTeamEmailConfirmed: !!(emailConfirmedAt && isAbluteTeamEmail(email)),
  });
}

// Phase 3 team invitations: owner/admin can invite, others can't — the UI
// needs the org_members.role (owner/admin/manager/member), a finer grain
// than resolveRole's founder/developer/investor/none.
export type OrgMemberRole = 'owner' | 'admin' | 'manager' | 'member';

export async function getOrgRole(userId: string, sb: Awaited<ReturnType<typeof serverClient>>): Promise<OrgMemberRole | null> {
  const { data } = await sb.from('org_members').select('role').eq('user_id', userId).maybeSingle();
  return (data?.role as OrgMemberRole | undefined) ?? null;
}
