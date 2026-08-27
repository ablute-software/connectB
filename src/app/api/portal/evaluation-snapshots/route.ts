// Prompt 408 §B — evaluation_snapshots read/write. Same pattern as
// /api/portal/berkus (session -> resolveActiveInvestorMember -> service-role
// read/write scoped to that seat; RLS on the table is defense in depth,
// this check is the real boundary) — deliberately replicated rather than
// reinvented, per the prompt's own instruction.
//
// Append-only by construction: there is no PATCH/PUT/DELETE handler here,
// and the table's own RLS has no update/delete policy either (migration
// 0258) — a snapshot can only ever be created or read, never altered.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

// Prompt 412 §B.4/§C.4 — 'bars'/'risks' added (DB constraint already
// widened by migration 0260; this array is the route's own separate gate).
const KINDS = ['berkus', 'scenarios', 'scorecard', 'bars', 'risks'] as const;
type SnapshotKind = typeof KINDS[number];
const HISTORY_LIMIT = 10;

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Prompt 408 §B.4 — demo mode (no Supabase configured) gracefully
  // returns "no history yet" rather than erroring. This mirrors
  // /api/portal/berkus's own existing demo-mode behavior exactly (that
  // route has no separate local-store implementation either) — building
  // a parallel local-store snapshot history that nothing else in this
  // tool family has would be new infrastructure, not a replication of an
  // existing pattern. Documented deviation from the prompt's literal
  // "store local" wording, flagged in the commit.
  if (!url || !serviceKey) return NextResponse.json({ snapshots: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const orgId = params.get('orgId');
  const kind = params.get('kind') as SnapshotKind | null;
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });
  if (!kind || !KINDS.includes(kind)) return NextResponse.json({ error: 'A valid kind is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ snapshots: [] });

  const { data } = await admin.from('evaluation_snapshots')
    .select('id, inputs, outputs, created_at')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId).eq('kind', kind)
    .order('created_at', { ascending: false }).limit(HISTORY_LIMIT);
  return NextResponse.json({ snapshots: data ?? [] });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string; kind?: SnapshotKind; inputs?: unknown; outputs?: unknown };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.kind || !KINDS.includes(body.kind)) return NextResponse.json({ ok: false, error: 'A valid kind is required.' }, { status: 400 });
  if (body.inputs == null || body.outputs == null) return NextResponse.json({ ok: false, error: 'inputs and outputs are required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await admin.from('evaluation_snapshots').insert({
    investor_member_id: member.id, startup_org_id: body.orgId, kind: body.kind,
    inputs: body.inputs, outputs: body.outputs,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
