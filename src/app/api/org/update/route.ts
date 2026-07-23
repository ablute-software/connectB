// Batch 3 B — edit Organisation data. The orgs table's RLS update policy is
// owner-only (0001), but the founder decision is owner+admin can edit, so
// this route enforces the role itself (via permissions.ts, the same matrix
// the UI uses) and writes with the service-role client. Server-side
// enforcement, not just a hidden button — a non-owner/admin POST is rejected
// here regardless of what the UI shows.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { type OrgRole } from '@/lib/permissions';
import { loadOrgMatrix } from '@/lib/org-matrix-server';
import { canWithMatrix } from '@/lib/org-permissions';

// Only these columns are editable here — never plan/credits/id/bcc_email.
const EDITABLE = ['name', 'sender_email', 'website', 'sector', 'stage', 'round_target_eur', 'country', 'one_liner', 'daily_cap', 'weekly_cap'] as const;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgRole = member.role as OrgRole;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // The org's configured matrix (batch 3 C) is the source of truth; it falls
  // back to the built-in defaults (owner+admin) when unconfigured / pre-0026.
  const matrix = await loadOrgMatrix(admin, member.org_id as string);
  if (!canWithMatrix(matrix, orgRole, 'org_editing')) {
    return NextResponse.json({ ok: false, error: 'Your role can’t edit organisation settings.' }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });

  const { error } = await admin.from('orgs').update(patch).eq('id', member.org_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
