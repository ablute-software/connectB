// Contact & Support — public ticket intake. No auth required (this is the
// only support channel we have; it must work for an anonymous visitor on
// /contact), but reads a session when one exists to trust its email/org
// over anything the client claims. Never blocks or errors visibly for a
// bot — honeypot hits, rate-limited IPs, and a not-yet-migrated database
// all return the same generic "thanks" a real submission gets, so nothing
// about the anti-spam mechanics is observable from the response.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { supportTicketsAvailable } from '@/lib/support-capability';
import { sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';
import { BRAND_NAME } from '@/lib/brand';

const SOURCES = ['landing', 'landing_investors', 'founder_app', 'investor_portal'] as const;
const CATEGORIES = ['question', 'problem', 'billing', 'data_correction', 'claim_profile', 'other'] as const;
const RATE_LIMIT_PER_HOUR = 5;

// A function, not a shared constant — a Response body can only be read
// once, so returning the SAME NextResponse instance across multiple
// requests serves an empty body on every call after the first.
function genericOk() {
  return NextResponse.json({ ok: true, message: "Thanks — we'll get back to you." });
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
    name, email, category, subject, message, source, context, website,
  } = body as Record<string, string | undefined>;

  const admin = createClient(url, service, { auth: { persistSession: false } });

  // Rate limit — record every attempt (honeypot hits included, so a bot
  // retrying still burns its own budget), then check the last hour.
  const ip = getIp(req);
  await admin.from('support_rate_limit').insert({ ip });
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin.from('support_rate_limit')
    .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since);
  if ((count ?? 0) > RATE_LIMIT_PER_HOUR) return genericOk();

  // Honeypot — a real visitor never sees or fills this field (see
  // ContactForm.tsx). Silent success, nothing written.
  if (website) return genericOk();

  // Everything past here is a plausible real submission — validate for
  // real, so a genuine visitor gets a useful error instead of a silent drop.
  if (!name || !name.trim()) return NextResponse.json({ ok: false, error: 'Your name is required.' }, { status: 400 });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 });
  if (!category || !(CATEGORIES as readonly string[]).includes(category)) return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 });
  if (!subject || !subject.trim() || subject.length > 200) return NextResponse.json({ ok: false, error: 'Subject must be 1–200 characters.' }, { status: 400 });
  if (!message || message.trim().length < 10 || message.length > 5000) return NextResponse.json({ ok: false, error: 'Message must be 10–5000 characters.' }, { status: 400 });
  if (!source || !(SOURCES as readonly string[]).includes(source)) return NextResponse.json({ ok: false, error: 'Invalid source.' }, { status: 400 });

  if (!(await supportTicketsAvailable())) return genericOk();

  // A signed-in caller's own session always wins over whatever the client
  // sent — never trust a body-supplied identity when a real one exists.
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  let finalEmail = email.trim().toLowerCase();
  let orgId: string | null = null;
  if (user) {
    finalEmail = (user.email ?? finalEmail).toLowerCase();
    const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
    orgId = member?.org_id ?? null;
  }

  const { error } = await admin.from('support_tickets').insert({
    source, org_id: orgId, user_id: user?.id ?? null,
    name: name.trim(), email: finalEmail, category, subject: subject.trim(),
    message: message.trim(), context: context?.trim() || null,
  });
  if (error) { console.error('[support/submit] insert failed', error.message); return genericOk(); }

  // Best-effort — a notification failure never blocks the visitor's
  // response; the ticket is already saved and visible in the back-office
  // either way.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (notifyTo) {
    sendTransactionalEmail({
      to: notifyTo,
      subject: `[${BRAND_NAME} support] ${subject.trim()}`,
      html: transactionalTemplate({
        heading: 'New support ticket',
        body: `<b>${name.trim()}</b> (${finalEmail}) · ${category} · via ${source}<br><br>${subject.trim()}<br><br>${message.trim().replace(/\n/g, '<br>')}`,
      }),
    }).catch(() => { /* logged inside sendTransactionalEmail; never blocks */ });
  }

  return genericOk();
}
