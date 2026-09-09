// Prompt 626 §D — Article 12(3)'s extension, as an action rather than a field.
//
// The Regulation allows two further months "where necessary, taking into
// account the complexity and number of the requests", and attaches a condition
// that is easy to drop: the person must be INFORMED within the first month,
// and told why. An extension that was never communicated is not an extension;
// it is a missed deadline with a longer number beside it.
//
// So this route does not let you set a date. It takes the reason and the
// number of extra months, computes the date, and records that the person was
// told — because the only honest moment to record that is the moment you do
// it. The database refuses the row otherwise (trigger + check constraint in
// migration 20260909014000), which means this route cannot be bypassed by
// writing the column directly from anywhere else either.
//
// What it deliberately does NOT do is send the email. There is no delivery
// channel to a catalogue person today (5 addresses in 3 472, and none of them
// have been written to), so claiming an automated notification here would be
// the same class of lie as the "30 days" this prompt removed. The admin sends
// it, and records that they did. When outbound mail to a data subject exists,
// this is the one place that has to change.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient, resolveRole } from '@/lib/supabase-server';
import { logAdminAction } from '@/lib/audit';
import { addMonthsClamped, GDPR_MAX_EXTENSION_MONTHS, statutoryDueAt } from '@/lib/gdpr';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const role = await resolveRole(user.id, user.email, sb, user.email_confirmed_at);
  if (role !== 'developer') return NextResponse.json({ ok: false, error: 'Platform admin only.' }, { status: 403 });

  const { reason, months } = await req.json().catch(() => ({})) as { reason?: string; months?: number };
  if (!reason?.trim()) {
    return NextResponse.json({ ok: false, error: 'Article 12(3) requires a reason, and the person has to be given it.' }, { status: 400 });
  }
  const extraMonths = months === 1 || months === 2 ? months : GDPR_MAX_EXTENSION_MONTHS;

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: request, error: reqErr } = await admin
    .from('gdpr_requests').select('id, created_at, status, extended_until').eq('id', params.id).maybeSingle();
  if (reqErr || !request) return NextResponse.json({ ok: false, error: reqErr?.message ?? 'Request not found.' }, { status: 404 });
  if (request.status !== 'pending') return NextResponse.json({ ok: false, error: 'This request is already resolved.' }, { status: 409 });
  if (request.extended_until) return NextResponse.json({ ok: false, error: 'This request has already been extended once.' }, { status: 409 });

  // The extension runs from the statutory date, not from today: two further
  // months means three from the request, whether it is granted on day 2 or
  // day 29.
  const extendedUntil = addMonthsClamped(statutoryDueAt(request.created_at), extraMonths);
  const notifiedAt = new Date();
  if (notifiedAt > statutoryDueAt(request.created_at)) {
    return NextResponse.json({
      ok: false,
      error: 'The first month has already passed. An extension can only be granted while there is still time to tell the person within it — this one is late, and recording it as an extension would hide that.',
    }, { status: 409 });
  }

  const { error } = await admin.from('gdpr_requests').update({
    extended_until: extendedUntil.toISOString(),
    extension_reason: reason.trim(),
    extension_notified_at: notifiedAt.toISOString(),
  }).eq('id', params.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    adminUserId: user.id, action: 'gdpr_extended', subjectType: 'gdpr_request', subjectId: params.id,
    detail: { reason: reason.trim(), months: extraMonths, extendedUntil: extendedUntil.toISOString() },
  });
  return NextResponse.json({ ok: true, extendedUntil: extendedUntil.toISOString() });
}
