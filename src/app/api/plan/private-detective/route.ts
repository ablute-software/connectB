// PLAN-02/03 — Private Detective (4th investor plan, no fixed price)
// "Contact the Sherlock Team" lead form. Public, no auth required — the
// card and its CTA appear on both the public landing (/investors) and the
// signed-in investor workspace (/plans). Same shape as /api/support/submit
// and /api/investor-access-request: no public insert policy on the table
// (0079), so this writes through the service role; a dedicated rate-limit
// table; a honeypot; notification email awaited, not fire-and-forget.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME } from '@/lib/brand';

const RATE_LIMIT_PER_HOUR = 5;

function genericOk() {
  return NextResponse.json({
    ok: true,
    message: 'Thank you for contacting the Sherlock Team. We have received your request and will contact you using the email address provided.',
  });
}

function getIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return genericOk();

  const body = await req.json().catch(() => ({}));
  const {
    first_name, last_name, email, investor_type, firm_name, message,
    firm_website, linkedin, website,
  } = body as Record<string, string | undefined>;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  const ip = getIp(req);
  await admin.from('investor_plan_contact_rate_limit').insert({ ip });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin.from('investor_plan_contact_rate_limit')
    .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) > RATE_LIMIT_PER_HOUR) return genericOk();

  // Honeypot — mirrors ContactForm.tsx. A real visitor never fills it.
  if (website) return genericOk();

  if (!first_name || !first_name.trim()) return NextResponse.json({ ok: false, error: 'First name is required.' }, { status: 400 });
  if (!last_name || !last_name.trim()) return NextResponse.json({ ok: false, error: 'Last name is required.' }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  if (!investor_type || !investor_type.trim()) return NextResponse.json({ ok: false, error: 'Investor type is required.' }, { status: 400 });
  if (!firm_name || !firm_name.trim()) return NextResponse.json({ ok: false, error: 'Investment firm or investment group name is required.' }, { status: 400 });
  if (!message || !message.trim()) return NextResponse.json({ ok: false, error: 'A message is required.' }, { status: 400 });
  if (message.length > 5000) return NextResponse.json({ ok: false, error: 'Message must be 5000 characters or fewer.' }, { status: 400 });

  const finalEmail = email.trim().toLowerCase();
  const { error } = await admin.from('investor_plan_contact_requests').insert({
    first_name: first_name.trim(), last_name: last_name.trim(), email: finalEmail,
    investor_type: investor_type.trim(), firm_name: firm_name.trim(), message: message.trim(),
    firm_website: firm_website?.trim() || null, linkedin: linkedin?.trim() || null,
  });
  if (error) { console.error('[plan/private-detective] insert failed', error.message); return genericOk(); }

  // Awaited, deliberately — see support/submit's note: a dangling
  // fire-and-forget promise never actually sends on serverless.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!notifyTo) {
    console.warn('[plan/private-detective] SUPPORT_NOTIFY_EMAIL unset — request saved, no notification sent.');
    return genericOk();
  }
  try {
    const result = await sendTransactionalEmail({
      to: notifyTo,
      subject: `[${BRAND_NAME} investors] Private Detective request — ${firm_name.trim()}`,
      html: transactionalTemplate({
        heading: 'New Private Detective plan request',
        body: `<b>${first_name.trim()} ${last_name.trim()}</b> (${finalEmail})<br>${investor_type.trim()} · ${firm_name.trim()}`
          + `${firm_website ? `<br>Website: ${firm_website.trim()}` : ''}${linkedin ? `<br>LinkedIn: ${linkedin.trim()}` : ''}`
          + `<br><br>${message.trim().replace(/\n/g, '<br>')}`,
      }),
    });
    if (result.sent) console.log('[plan/private-detective] notification email sent, id:', result.id);
    else console.error('[plan/private-detective] notification email not sent:', result.error);
  } catch (e) {
    console.error('[plan/private-detective] notification email threw:', (e as Error).message);
  }

  return genericOk();
}
