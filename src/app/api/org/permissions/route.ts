// Batch 3 C — read/write the org's role→capability matrix overrides.
// GET returns the raw overrides + the resolved matrix (defaults merged, owner
// forced in) so the config UI can render. POST is OWNER-ONLY (configuring who
// can do what is strictly the owner's call) and stores the overrides jsonb.
// Enforcement of the matrix itself lives in the capability-gated routes
// (/api/org/update, /api/invite/create, …); this route just persists config.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { MATRIX_CAPABILITIES, resolveMatrix, type MatrixCapability, type MatrixOverrides } from '@/lib/org-permissions';
import { ORG_ROLES, type OrgRole } from '@/lib/permissions';

async function context() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 }) };
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };
  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };
  const admin = createClient(url, service, { auth: { persistSession: false } });
  return { admin, orgId: member.org_id as string, role: member.role as OrgRole };
}

export async function GET() {
  const ctx = await context();
  if ('error' in ctx) return ctx.error;
  const { admin, orgId } = ctx;
  const { data: org } = await admin.from('orgs').select('permission_matrix').eq('id', orgId).maybeSingle();
  const overrides = (org?.permission_matrix as MatrixOverrides | null) ?? null;
  return NextResponse.json({ ok: true, overrides: overrides ?? {}, resolved: resolveMatrix(overrides) });
}

export async function POST(req: Request) {
  const ctx = await context();
  if ('error' in ctx) return ctx.error;
  const { admin, orgId, role } = ctx;
  if (role !== 'owner') return NextResponse.json({ ok: false, error: 'Only the owner can configure permissions.' }, { status: 403 });

  const body = await req.json() as { overrides?: MatrixOverrides };
  const validCaps = new Set(MATRIX_CAPABILITIES.map((c) => c.key));
  const validRoles = new Set(ORG_ROLES);
  const clean: MatrixOverrides = {};
  for (const [cap, roles] of Object.entries(body.overrides ?? {})) {
    if (!validCaps.has(cap as MatrixCapability) || !Array.isArray(roles)) continue;
    clean[cap as MatrixCapability] = (roles as OrgRole[]).filter((r) => validRoles.has(r));
  }
  const { error } = await admin.from('orgs').update({ permission_matrix: clean }).eq('id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, resolved: resolveMatrix(clean) });
}
