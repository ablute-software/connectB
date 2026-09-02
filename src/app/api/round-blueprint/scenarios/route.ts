// Prompt 534 Phase 1 — the founder's Round Blueprint scenarios.
//
// FOUNDER-ONLY, enforced here and not merely by convention: every handler
// resolves the caller's own org from org_members and scopes every read and
// write to it. There is no orgId parameter to pass, so there is no shape of
// request that reaches another org's scenarios.
//
// Stores INPUTS only. Nothing computed is persisted — the panel recomputes
// from src/lib/round-blueprint.ts on every read, so there can never be a
// stored runway that disagrees with the live one.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { roundBlueprintAvailable } from '@/lib/round-blueprint-capability';

export const dynamic = 'force-dynamic';

async function context(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return { error: NextResponse.json({ available: false, scenarios: [] }) };
  if (!(await roundBlueprintAvailable())) return { error: NextResponse.json({ available: false, scenarios: [] }) };

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ available: true, scenarios: [], error: 'Sign in first.' }, { status: 401 }) };
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  const orgId = member?.org_id as string | undefined;
  if (!orgId) return { error: NextResponse.json({ available: true, scenarios: [], error: 'No org.' }, { status: 403 }) };

  return { orgId, admin: createClient(url, service, { auth: { persistSession: false } }) };
}

export async function GET(req: Request) {
  if (!authEnabled) return NextResponse.json({ available: false, scenarios: [] });
  const ctx = await context(req);
  if ('error' in ctx) return ctx.error;

  const { data } = await ctx.admin.from('round_blueprint_scenarios')
    .select('id, name, inputs, is_active, created_at, updated_at')
    .eq('org_id', ctx.orgId).order('created_at', { ascending: true });

  return NextResponse.json({ available: true, scenarios: data ?? [] });
}

export async function POST(req: Request) {
  if (!authEnabled) return NextResponse.json({ ok: false, error: 'not configured' });
  const ctx = await context(req);
  if ('error' in ctx) return ctx.error;

  const body = await req.json().catch(() => ({})) as {
    id?: string; name?: string; inputs?: unknown; isActive?: boolean; deleteId?: string;
  };

  if (body.deleteId) {
    const { error } = await ctx.admin.from('round_blueprint_scenarios')
      .delete().eq('id', body.deleteId).eq('org_id', ctx.orgId);
    return error
      ? NextResponse.json({ ok: false, error: error.message }, { status: 500 })
      : NextResponse.json({ ok: true });
  }

  // One active scenario per org: clearing first means a crash between the two
  // writes leaves none active (recoverable, the panel just picks the first)
  // rather than two, which would make "the active scenario" ambiguous.
  if (body.isActive) {
    await ctx.admin.from('round_blueprint_scenarios').update({ is_active: false }).eq('org_id', ctx.orgId);
  }

  const now = new Date().toISOString();
  if (body.id) {
    const patch: Record<string, unknown> = { updated_at: now };
    if (body.name !== undefined) patch.name = body.name;
    if (body.inputs !== undefined) patch.inputs = body.inputs;
    if (body.isActive !== undefined) patch.is_active = body.isActive;
    const { data, error } = await ctx.admin.from('round_blueprint_scenarios')
      .update(patch).eq('id', body.id).eq('org_id', ctx.orgId).select('id').maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: 'Scenario not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, id: data.id });
  }

  const { data, error } = await ctx.admin.from('round_blueprint_scenarios').insert({
    org_id: ctx.orgId,
    name: (body.name ?? 'Base').slice(0, 120),
    inputs: body.inputs ?? {},
    is_active: body.isActive ?? false,
    created_at: now, updated_at: now,
  }).select('id').single();

  return error
    ? NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    : NextResponse.json({ ok: true, id: data.id });
}
