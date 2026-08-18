// Investor Workspace Agenda calendar (Prompt 247 B / 248) — the investor's
// own task/reminder list (investor_tasks, migration 0182), separate table
// from the founder's tasks (see that migration's header for why). Same
// auth/ownership shape as /api/portal/agenda: serverClient for the
// session, service-role admin for the actual reads/writes, ownership
// always re-checked by investor_email server-side.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { eligibleOrgIds } from '@/lib/portal-access';
import { listInvestorTasks, createInvestorTask, updateInvestorTask } from '@/lib/investor-tasks';
import { assertNotViewer } from '@/lib/developer-viewer';
import type { ActionType, TaskKind } from '@/lib/types';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);

  // The "Startup" select in the create-task modal is fed from this SAME
  // eligibleOrgIds() call — never a broader `orgs` query — per the root
  // privacy check in prompt 248: an investor's task modal must not be able
  // to name a startup it has no legitimate access to.
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] };
  const startups = (orgs ?? []).map((o) => ({ id: o.id as string, name: o.name as string }));

  const tasks = await listInvestorTasks(admin, email);
  return NextResponse.json({ tasks, startups });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as {
    title?: string; orgId?: string; kind?: TaskKind; action_type?: ActionType;
    due_at?: string; notes?: string; reminder_at?: string;
  };
  if (!body.title?.trim()) return NextResponse.json({ ok: false, error: 'title is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await eligibleOrgIds(sb, admin, user.id, email, person?.id ?? null);

  const result = await createInvestorTask(admin, {
    investorEmail: email,
    orgId: body.orgId,
    title: body.title,
    kind: body.kind ?? 'meeting',
    action_type: body.action_type ?? 'other',
    due_at: body.due_at,
    notes: body.notes,
    reminder_at: body.reminder_at,
  }, orgIds);
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function PATCH(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as {
    id?: string; done?: boolean; reminder_at?: string | null; snoozed_until?: string | null;
  };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const result = await updateInvestorTask(admin, {
    id: body.id, investorEmail: email, done: body.done, reminder_at: body.reminder_at, snoozed_until: body.snoozed_until,
  });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
