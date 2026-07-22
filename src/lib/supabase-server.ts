// Server-only Supabase helpers (uses next/headers). Import from route handlers / server components only.
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON, type Role } from './supabase';

export { authEnabled } from './supabase';

export async function serverClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_ANON!, {
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

export async function resolveRole(userId: string, email: string | undefined, sb: Awaited<ReturnType<typeof serverClient>>): Promise<Role> {
  const [{ data: admin }, { data: member }] = await Promise.all([
    sb.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle(),
  ]);
  if (admin) return 'developer';
  if (member) return 'founder';
  if (email) {
    const { data: grant } = await sb.from('access_grants').select('id').eq('grantee_email', email).limit(1).maybeSingle();
    if (grant) return 'investor';
  }
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
