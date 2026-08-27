// Prompt 408 §C — the investor's private decision record for one startup.
// Same pattern as /api/portal/berkus and /api/portal/evaluation-snapshots:
// session -> resolveActiveInvestorMember -> service-role read/write scoped
// to that seat. Append-only (migration 0259's own comment) — there is no
// PATCH/PUT/DELETE handler here; "updating" a decision is POSTing a new
// one. GET returns the most recent row as "current" plus the full history,
// so the UI can show "Update decision" without a second endpoint.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

const DECISIONS = ['invest', 'pass', 'watch'] as const;
type Decision = typeof DECISIONS[number];

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ current: null, history: [] });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ current: null, history: [] });

  const { data } = await admin.from('investor_case_decisions')
    .select('id, decision, thesis, premortem, created_at')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId)
    .order('created_at', { ascending: false });
  const history = data ?? [];
  return NextResponse.json({ current: history[0] ?? null, history });
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

  const body = await req.json().catch(() => ({})) as { orgId?: string; decision?: Decision; thesis?: string; premortem?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.decision || !DECISIONS.includes(body.decision)) return NextResponse.json({ ok: false, error: 'A valid decision is required.' }, { status: 400 });
  if (!body.thesis?.trim()) return NextResponse.json({ ok: false, error: 'thesis is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  const { error } = await admin.from('investor_case_decisions').insert({
    investor_member_id: member.id, startup_org_id: body.orgId,
    decision: body.decision, thesis: body.thesis.trim(), premortem: body.premortem?.trim() || null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
