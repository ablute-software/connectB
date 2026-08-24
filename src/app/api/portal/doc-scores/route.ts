// Prompt 347 §B — "Track & Evaluate" per-document scoring. Same pattern as
// /api/portal/scorecard/scores: investor-private, per seat
// (matchdeal_investor_members.id), never read by any founder-facing route.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { projectDocScores } from '@/lib/investor-doc-scores';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ scores: {} });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ scores: {} });

  const { data: rows } = await admin.from('investor_doc_scores').select('document_id, score, note')
    .eq('investor_member_id', member.id).eq('startup_org_id', orgId);
  return NextResponse.json({ scores: projectDocScores((rows ?? []) as { document_id: string; score: number; note: string | null }[]) });
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

  const body = await req.json().catch(() => ({})) as { orgId?: string; documentId?: string; score?: number; note?: string };
  if (!body.orgId || !body.documentId) return NextResponse.json({ ok: false, error: 'orgId and documentId are required.' }, { status: 400 });
  if (typeof body.score !== 'number' || body.score < 0 || body.score > 10) {
    return NextResponse.json({ ok: false, error: 'score must be between 0 and 10.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No investor firm linked to this session.' }, { status: 403 });

  // Confirms the document actually belongs to the org being scored, before
  // writing anything against it — the same "resolve, then check ownership
  // before writing" discipline the scorecard scores route uses.
  const { data: doc } = await admin.from('documents').select('id').eq('id', body.documentId).eq('org_id', body.orgId).maybeSingle();
  if (!doc) return NextResponse.json({ ok: false, error: 'Document not found.' }, { status: 404 });

  const { error } = await admin.from('investor_doc_scores').upsert({
    investor_member_id: member.id, startup_org_id: body.orgId, document_id: body.documentId,
    score: body.score, note: body.note?.trim() || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'investor_member_id,document_id' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
