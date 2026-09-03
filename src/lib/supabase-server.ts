// Server-only Supabase helpers (uses next/headers). Import from route handlers / server components only.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON, shareableCookieDomain, type Role } from './supabase';

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
  if (admin) return 'developer';
  // Prompt 556 §D — a member of a CLOSED org is not a founder. An org is
  // closed when its last member was deleted (orgs.closed_at, migration
  // 0303), so this can only be reached if a member row was created against
  // an already-closed org — which is exactly the case worth refusing:
  // re-creating a user with the same email must not silently reattach them
  // to the account that ended. They fall through to the investor/none
  // branches below, and provisioning gives them a fresh org.
  if (member) {
    const { data: org } = await sb.from('orgs').select('closed_at').eq('id', member.org_id).maybeSingle();
    if (!org?.closed_at) return 'founder';
  }
  // An explicit access_grants row (a deliberate act — a founder sharing
  // their data room, or a back-office admin approving an investor access
  // request) outranks the blanket @ablute.pt-domain fallback below. Without
  // this order, a confirmed @ablute.pt account could never resolve as
  // 'investor' no matter what it's been granted — which is exactly what
  // blocked using an @ablute.pt account to test the investor portal.
  if (email) {
    const { data: grant } = await sb.from('access_grants').select('id').eq('grantee_email', email).limit(1).maybeSingle();
    if (grant) return 'investor';
  }
  if (emailConfirmedAt && isAbluteTeamEmail(email)) return 'developer';
  return 'none';
}

// Phase 3 team invitations: owner/admin can invite, others can't — the UI
// needs the org_members.role (owner/admin/manager/member), a finer grain
// than resolveRole's founder/developer/investor/none.
export type OrgMemberRole = 'owner' | 'admin' | 'manager' | 'member';

export async function getOrgRole(userId: string, sb: Awaited<ReturnType<typeof serverClient>>): Promise<OrgMemberRole | null> {
  const { data } = await sb.from('org_members').select('role').eq('user_id', userId).maybeSingle();
  return (data?.role as OrgMemberRole | undefined) ?? null;
}
