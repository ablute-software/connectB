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

const SOURCES = ['landing', 'landing_investors', 'founder_app', 'investor_portal', 'suspended', 'blocked'] as const;
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
    name, email, category, subject, message, source, context, website, area,
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

  let { data: ticket, error } = await admin.from('support_tickets').insert({
    source, org_id: orgId, user_id: user?.id ?? null,
    name: name.trim(), email: finalEmail, category, subject: subject.trim(),
    message: message.trim(), context: context?.trim() || null,
    area: area?.trim() || null,
  }).select('id').single();
  // Item 6 — 'suspended' as a source value needs migration 0143 (widens the
  // source check constraint) applied; until it is, an insert with
  // source='suspended' fails the DB constraint even though this route's own
  // SOURCES list already accepts it. Retrying once with 'founder_app'
  // (already always allowed) means a ticket from a suspended account is
  // never silently lost to a constraint the DB hasn't caught up to yet —
  // it just gets a slightly generic source label until 0143 lands.
  //
  // Prompt 244/245 — 'blocked' (the /blocked page's ContactForm) needs its
  // own companion migration (0181) for the same reason, and it's PROPOSED/
  // NOT APPLIED for the same reason 0143 still is: this repo's convention
  // is that widening support_tickets' source check constraint is left for
  // Nuno to apply by hand, not auto-applied by a Code session. Same
  // fallback, same rationale.
  if (error && (source === 'suspended' || source === 'blocked')) {
    console.warn(`[support/submit] insert with source=${source} failed (companion migration not applied yet?), retrying as founder_app:`, error.message);
    ({ data: ticket, error } = await admin.from('support_tickets').insert({
      source: 'founder_app', org_id: orgId, user_id: user?.id ?? null,
      name: name.trim(), email: finalEmail, category, subject: subject.trim(),
      message: message.trim(), context: context?.trim() || null,
      area: area?.trim() || null,
    }).select('id').single());
  }
  if (error || !ticket) { console.error('[support/submit] insert failed', error?.message); return genericOk(); }

  // AWAITED, deliberately. This was fire-and-forget (a dangling promise with
  // .then/.catch) and the email was never actually sent: on serverless the
  // function is frozen the moment the response is returned, so the fetch to
  // the provider never ran — confirmed in production, where the request's
  // External APIs panel showed 6 calls to Supabase and ZERO to the provider,
  // with no error logged anywhere. A dangling promise isn't "best-effort"
  // here, it's "never".
  //
  // The cost is a few hundred ms added to the visitor's response on a form
  // they submit once. The alternative that keeps the response fast is
  // waitUntil() from @vercel/functions, which would pin this route to Vercel
  // for a trade nobody asked for. Still never blocks the OUTCOME: the ticket
  // is already committed above, and a provider failure only logs.
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!notifyTo) {
    // Was a silent early return — an unset env var looked identical to a
    // successful send in the logs.
    console.warn('[support/submit] SUPPORT_NOTIFY_EMAIL unset — ticket saved, no notification sent.');
  } else {
    try {
      const result = await sendTransactionalEmail({
        to: notifyTo,
        subject: `[${BRAND_NAME} support] ${subject.trim()}`,
        html: transactionalTemplate({
          heading: 'New support ticket',
          body: `<b>${name.trim()}</b> (${finalEmail}) · ${category} · via ${source}<br><br>${subject.trim()}<br><br>${message.trim().replace(/\n/g, '<br>')}`,
        }),
        context: { orgId, kind: 'support' },
      });
      if (result.sent) console.log('[support/submit] notification email sent, id:', result.id);
      else console.error('[support/submit] notification email not sent:', result.error);
    } catch (e) {
      console.error('[support/submit] notification email threw:', (e as Error).message);
    }
  }

  // ticketId is only ever included on this real-success path — every
  // early exit above (rate limit, honeypot, not-configured) returns the
  // plain genericOk() with nothing to attach to.
  return NextResponse.json({ ok: true, message: "Thanks — we'll get back to you.", ticketId: ticket.id });
}
