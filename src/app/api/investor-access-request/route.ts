// Investor landing lead capture (/signup?as=investor) — public intake for
// the "request access" form. Same shape as /api/support/submit (0036):
// no public insert policy on the table (confirmed live via REST before
// building this), so this route writes through the service role; rate
// limiting is a separate table counted the same way; the response never
// reveals whether a submission was rate-limited or genuinely accepted.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME } from '@/lib/brand';

const RATE_LIMIT_PER_HOUR = 5;

// A function, not a shared constant — see the same note in support/submit:
// a Response body can only be read once, so a shared instance serves an
// empty body on every call after the first.
function genericOk() {
  return NextResponse.json({ ok: true, message: 'Request received — we’ll confirm your access by email.' });
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
  const { email, firm_name, note, website } = body as Record<string, string | undefined>;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Rate limit — record every attempt, then check the last hour. Same
  // pattern as support_rate_limit: counted before the honeypot check, so a
  // retrying bot burns its own budget either way.
  const ip = getIp(req);
  await admin.from('investor_access_request_rate_limit').insert({ ip });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin.from('investor_access_request_rate_limit')
    .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) > RATE_LIMIT_PER_HOUR) return genericOk();

  // Honeypot — mirrors ContactForm.tsx's hidden `website` field. A real
  // visitor never fills it. Silent success, nothing written.
  if (website) return genericOk();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  }
  if (firm_name && firm_name.length > 200) {
    return NextResponse.json({ ok: false, error: 'Firm name must be 200 characters or fewer.' }, { status: 400 });
  }
  if (note && note.length > 2000) {
    return NextResponse.json({ ok: false, error: 'Note must be 2000 characters or fewer.' }, { status: 400 });
  }

  const finalEmail = email.trim().toLowerCase();
  const { error } = await admin.from('investor_access_requests').insert({
    email: finalEmail,
    firm_name: firm_name?.trim() || null,
    note: note?.trim() || null,
  });
  // A missing table (migration not yet applied) fails the same way any
  // other insert error would — genericOk() either way, nothing about the
  // database state is observable from the response.
  if (error) { console.error('[investor-access-request] insert failed', error.message); return genericOk(); }

  // Awaited, deliberately — see the note in support/submit: a dangling
  // fire-and-forget promise never actually sends on serverless, because the
  // function freezes the moment the response returns. A provider failure
  // here only logs; the request row is already committed above either way.
  //
  // Reuses SUPPORT_NOTIFY_EMAIL rather than a new env var — same team inbox
  // as every other notification in this codebase, and the house rule
  // (.env.example, next to that var) is explicit: never hard-code the
  // address in code, always read it from this one place.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!notifyTo) {
    console.warn('[investor-access-request] SUPPORT_NOTIFY_EMAIL unset — request saved, no notification sent.');
    return genericOk();
  }
  try {
    const result = await sendTransactionalEmail({
      to: notifyTo,
      subject: `[${BRAND_NAME} investors] New access request${firm_name ? ` — ${firm_name.trim()}` : ''}`,
      html: transactionalTemplate({
        heading: 'New investor access request',
        body: `<b>${finalEmail}</b>${firm_name ? ` · ${firm_name.trim()}` : ''}<br><br>${(note?.trim() || '(no note)').replace(/\n/g, '<br>')}`,
      }),
    });
    if (result.sent) console.log('[investor-access-request] notification email sent, id:', result.id);
    else console.error('[investor-access-request] notification email not sent:', result.error);
  } catch (e) {
    console.error('[investor-access-request] notification email threw:', (e as Error).message);
  }

  return genericOk();
}
