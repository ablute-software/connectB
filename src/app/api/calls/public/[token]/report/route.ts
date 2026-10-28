// Prompt 918 (I3) — "Report a problem" on every page of the applicant's journey (spec §14.5), the code page included (so it is public, like the call's header). It reuses the support mechanism that already
// exists (support_tickets, the notification email, the back office queue) with URGENT priority and what the team needs to help: the call, the application (when the person has one), who, the page and
// the deadline. Never a password or a secret; it submits nothing and changes no deadline. The person gets a confirmation on screen and, when we have an address, by email.
import { NextResponse } from 'next/server';
import { resolveActingOrg, withActingOrg } from '@/lib/acting-org';
import { resolvePublicCall, serviceClient } from '@/lib/calls/applicant/link';
import { promoterName } from '@/lib/calls/store';
import { formatInZone } from '@/lib/calls/tz';
import { BRAND_NAME } from '@/lib/brand';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { serverClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const RATE_LIMIT_PER_HOUR = 5;
type Row = Record<string, unknown>;
const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const ip = (req: Request): string => req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';

export const POST = withActingOrg(async function POST(req: Request, { params }: { params: { token: string } }) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, params.token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const message = clip(body.message, 3000);
  if (message.length < 10) return NextResponse.json({ ok: false, error: 'Please tell us a little more (at least 10 characters).' }, { status: 400 });

  // The same anti-spam budget as the support form: every attempt counts.
  const from = ip(req);
  await admin.from('support_rate_limit').insert({ ip: from });
  const { count } = await admin.from('support_rate_limit').select('id', { count: 'exact', head: true }).eq('ip', from).gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if ((count ?? 0) > RATE_LIMIT_PER_HOUR) return NextResponse.json({ ok: false, error: 'Too many reports in a short time. Please wait a few minutes.' }, { status: 429 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  let email = clip(body.email, 200).toLowerCase();
  let name = clip(body.name, 120);
  let orgId: string | null = null;
  let application: { id: string; reference: string | null; status: string } | null = null;
  if (user) {
    email = (user.email ?? email).toLowerCase();
    const acting = await resolveActingOrg(req, user, sb);
    orgId = acting.orgId ?? null;
    if (orgId) {
      const { data: apps } = await admin.from('call_applications').select('id, reference, status').eq('call_id', found.call.id).eq('startup_org_id', orgId).neq('status', 'withdrawn').order('updated_at', { ascending: false }).limit(1);
      const a = ((apps ?? []) as Row[])[0];
      if (a) application = { id: a.id as string, reference: (a.reference as string | null) ?? null, status: a.status as string };
      if (!name) { const { data: o } = await admin.from('orgs').select('name').eq('id', orgId).maybeSingle(); name = String((o as Row | null)?.name ?? ''); }
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'Please give an email address where we can reach you.' }, { status: 400 });
  if (!name) name = email.split('@')[0];

  const call = found.call;
  const promoter = await promoterName(admin, call.promoterKind, call.promoterId);
  const context = JSON.stringify({
    call: { id: call.id, name: call.name, promoter, status: call.status, closesAt: call.closesAt, deadline: formatInZone(call.closesAt, call.timezone) },
    application, userId: user?.id ?? null, page: clip(body.page, 200) || null, userAgent: clip(req.headers.get('user-agent'), 200),
  });
  const subject = `[Calls · urgent] ${call.name}: a problem was reported`.slice(0, 200);
  const { data: ticket, error } = await admin.from('support_tickets').insert({
    source: user ? 'founder_app' : 'landing', org_id: orgId, user_id: user?.id ?? null, name, email, category: 'problem', subject, message, context, area: 'Calls', priority: 'urgent',
  }).select('id').single();
  if (error || !ticket) { console.error('[calls] report a problem not saved:', error?.message); return NextResponse.json({ ok: false, error: 'We could not send your report. Please try again.' }, { status: 500 }); }

  // Awaited (a dangling promise never runs on serverless — see /api/support/submit). A failed email never undoes the ticket.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (notifyTo) {
    await sendTransactionalEmail({
      to: notifyTo, subject: `[${BRAND_NAME} support · URGENT] ${call.name}`,
      html: transactionalTemplate({ heading: 'A problem was reported on a call', body: `<b>${name}</b> (${email}) reported a problem on <b>${call.name}</b> (${promoter})${application ? `, application ${application.reference ?? application.id}` : ''}.<br><br>${message.replace(/</g, '&lt;').replace(/\n/g, '<br>')}` }),
      context: { orgId, kind: 'support' },
    }).catch((e) => console.error('[calls] report notification failed:', (e as Error).message));
  }
  await sendTransactionalEmail({
    to: email, subject: `We received your report — ${call.name}`,
    html: transactionalTemplate({ heading: 'We received your report', body: `Thank you. Your report about “${call.name}” reached our team and was marked urgent. We will get back to you. Reporting a problem does not submit anything and does not change any deadline.` }),
    context: { orgId, kind: 'support' },
  }).catch((e) => console.error('[calls] report confirmation failed:', (e as Error).message));
  return NextResponse.json({ ok: true, ticketId: (ticket as Row).id, message: 'Thank you. Your report reached our team and was marked urgent. It does not submit anything and does not change any deadline.' });
});
