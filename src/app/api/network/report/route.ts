// Prompt 321 Pedido C — Report a post or an actor's profile. Reuses
// support_tickets (migration 0036) rather than a parallel moderation
// system, with a first-class category ('network_content_report') so
// back-office can filter and act on these distinctly. context carries a
// machine-parseable "network_post:{id}" or "network_actor:{id}" tag —
// deliberately not free text, so the back-office strike action (Prompt
// 321's own /api/backoffice/support/[id]/action 'strike') can find the
// reported actor without guessing.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { networkAvailable } from '@/lib/network-capability';
import { resolveActorId } from '@/lib/network-db';
import { supportTicketsAvailable } from '@/lib/support-capability';
import { formatNetworkReportContext } from '@/lib/network-content-policy';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  if (!(await networkAvailable())) return NextResponse.json({ ok: false, error: 'Not available in this workspace yet.' });
  if (!(await supportTicketsAvailable())) return NextResponse.json({ ok: false, error: 'Reporting is not available right now.' });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const actor = await resolveActorId(admin, user.id);
  if (!actor) return NextResponse.json({ ok: false, error: 'No network profile found for your account.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { postId?: string; reportedActorId?: string; reason?: string };
  if (!body.postId && !body.reportedActorId) return NextResponse.json({ ok: false, error: 'Missing postId or reportedActorId.' }, { status: 400 });
  if (!body.reason?.trim()) return NextResponse.json({ ok: false, error: 'A short reason is required.' }, { status: 400 });

  let reportedActorId = body.reportedActorId ?? null;
  if (body.postId && !reportedActorId) {
    const { data: post } = await admin.from('network_posts').select('author_actor_id').eq('id', body.postId).maybeSingle();
    reportedActorId = post?.author_actor_id ?? null;
  }
  const context = formatNetworkReportContext({ postId: body.postId, reportedActorId });

  const { data: ticket, error } = await admin.from('support_tickets').insert({
    source: actor.orgId ? 'founder_app' : 'investor_portal',
    org_id: actor.orgId ?? null, user_id: user.id,
    name: user.email.split('@')[0], email: user.email.toLowerCase(),
    category: 'network_content_report', subject: 'My Network content report',
    message: body.reason.trim(), context,
  }).select('id').single();
  if (error || !ticket) return NextResponse.json({ ok: false, error: error?.message ?? 'Could not submit report.' });
  return NextResponse.json({ ok: true });
}
