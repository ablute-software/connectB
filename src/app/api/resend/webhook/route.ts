// Prompt 557 §3 — Resend's delivery events, recorded against the send.
//
// This is the endpoint that makes `email_send_log.status` mean what a human
// reads it to mean. Until now the column stopped at 'sent' = "Resend's API
// returned 200 for our request", which is genuinely all the app could know
// synchronously — and is why six accepted sends to a @hotmail.com address
// could all read 'sent' while none of them arrived.
//
// Public by necessity (the provider has no session) and safe because the
// Svix signature is checked before anything is read: see resend-webhook.ts
// for why an unsigned request must never be trusted here, and why there is
// no development bypass. Add the endpoint in the Resend dashboard and put
// its secret in RESEND_WEBHOOK_SECRET on Vercel; without the secret this
// route rejects everything rather than accepting anything.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseResendEvent, shouldApplyStatus, verifyResendSignature } from '@/lib/resend-webhook';

export async function POST(req: Request) {
  // RAW body, not req.json(): the signature covers the exact bytes Resend
  // sent, so parsing and re-serialising would break every valid signature.
  const rawBody = await req.text();

  const verdict = verifyResendSignature(rawBody, {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  }, process.env.RESEND_WEBHOOK_SECRET);

  if (!verdict.ok) {
    // 401 with the reason in the body, never in a header: Resend surfaces
    // the response body in its own dashboard, which is where whoever is
    // configuring this will be looking. `no_secret` is the one worth
    // logging — it means the endpoint is live and configured on their side
    // but inert on ours, which otherwise looks like silence.
    if (verdict.reason === 'no_secret') console.error('[resend-webhook] RESEND_WEBHOOK_SECRET is not set — every event is being rejected.');
    return NextResponse.json({ ok: false, error: verdict.reason }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, ignored: 'not configured' });

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const parsed = parseResendEvent(event as Parameters<typeof parseResendEvent>[0]);
  // 200, not 4xx, for an event type this app doesn't track: Resend disables
  // an endpoint that keeps erroring, and `email.sent`/`email.opened` are
  // perfectly valid events we simply have no column for.
  if (!parsed) return NextResponse.json({ ok: true, ignored: 'untracked event type' });
  if (!parsed.providerId) return NextResponse.json({ ok: true, ignored: 'no email_id on the event' });

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: row } = await admin.from('email_send_log')
    .select('id, status').eq('provider_id', parsed.providerId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  // A send this app never logged (a Resend dashboard test, a row predating
  // the log table) is not an error — there is simply nothing to update.
  if (!row) return NextResponse.json({ ok: true, ignored: 'no matching send' });

  if (!shouldApplyStatus(row.status as string | null, parsed.status)) {
    return NextResponse.json({ ok: true, ignored: 'later or equal status already recorded' });
  }

  const { error } = await admin.from('email_send_log').update({
    status: parsed.status,
    provider_event_at: parsed.occurredAt ?? new Date().toISOString(),
    // The bounce reason is the whole point of a bounce row. It goes in the
    // same column the synchronous failure path uses, so one screen reads
    // both without knowing which path produced the row.
    ...(parsed.reason ? { provider_error: parsed.reason.slice(0, 500) } : {}),
  }).eq('id', row.id as string);

  if (error) {
    console.error('[resend-webhook] update failed:', error.message);
    return NextResponse.json({ ok: false, error: 'update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, status: parsed.status });
}
