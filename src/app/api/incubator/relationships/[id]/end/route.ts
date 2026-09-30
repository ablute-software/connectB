// Prompt I-01 §A.8/§C.5 — the incubator ends a relationship (reason
// required; the founder sees it and is e-mailed). The cut is immediate:
// incubator_can_view() is false from the moment the function returns (D6).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { incubatorErrorText } from '@/lib/incubators';
import { APP_URL } from '@/lib/brand';
import { relationshipEndedByIncubatorEmail } from '@/lib/email-templates/incubator-emails';
import { sendIncubatorEmail } from '@/lib/incubator-email-server';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { reason } = await req.json().catch(() => ({})) as { reason?: string };
  const { data, error } = await gate.sb.rpc('incubator_end_relationship', { p_relationship_id: params.id, p_reason: reason ?? '' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });

  // The founder's notice goes to the org's own contact address
  // (orgs.sender_email — the same recipient the portal's founder
  // notifications use). Read with the service role: an incubator member has
  // no read on orgs, and this reads exactly one column for exactly this org.
  let emailSent = false;
  if (!data.already && data.ended_by === 'incubator') {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && service) {
      const admin = createClient(url, service, { auth: { persistSession: false } });
      const { data: org } = await admin.from('orgs').select('sender_email').eq('id', data.org_id).maybeSingle();
      if (org?.sender_email) {
        const sent = await sendIncubatorEmail(org.sender_email, relationshipEndedByIncubatorEmail({
          incubatorName: gate.member.incubatorName, reason: data.reason ?? '', url: `${APP_URL}/settings?tab=programs`,
        }), { kind: 'incubator_relationship_ended', orgId: data.org_id });
        emailSent = sent.sent;
      }
    }
  }
  return NextResponse.json({ ok: true, emailSent });
}
