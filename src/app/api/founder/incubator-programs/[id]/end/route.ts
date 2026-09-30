// Prompt I-01 §C.4/§C.5 — the founder ends a relationship (reason optional).
// The incubator's access drops in the same statement (D6); its owners and
// managers are told, without a reason if the founder gave none.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { incubatorErrorText } from '@/lib/incubators';
import { APP_URL } from '@/lib/brand';
import { relationshipEndedByFounderEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { reason } = await req.json().catch(() => ({})) as { reason?: string };
  const { data, error } = await sb.rpc('incubator_end_relationship', { p_relationship_id: params.id, p_reason: reason ?? '' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });

  let notified = 0;
  if (!data.already && data.ended_by === 'founder') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      const admin = createClient(url, service, { auth: { persistSession: false } });
      const [{ data: org }, { data: members }] = await Promise.all([
        admin.from('orgs').select('name').eq('id', data.org_id).maybeSingle(),
        admin.from('incubator_members').select('user_id').eq('incubator_id', data.incubator_id).eq('status', 'active'),
      ]);
      const email = relationshipEndedByFounderEmail({ startupName: org?.name ?? 'A startup', reason: data.reason ?? null, url: `${APP_URL}/incubator` });
      for (const m of members ?? []) {
        if (!m.user_id) continue;
        const { data: u } = await admin.auth.admin.getUserById(m.user_id);
        if (!u?.user?.email) continue;
        const sent = await sendIncubatorEmail(u.user.email, email, { kind: 'incubator_relationship_ended', orgId: data.org_id });
        if (sent.sent) notified++;
      }
    }
  }
  return NextResponse.json({ ok: true, notified });
}
