// Prompt 537 §1 — the writer behind email_send_log (migration 0296).
//
// Why this exists as its own module rather than inline in resend.ts: the
// send path must never fail because the RECORD of it failed. Every function
// here swallows its own errors into a console.error and returns; a broken
// log makes diagnosis harder, a throwing log would stop mail going out.
// That is also why there is no capability probe in front of it — a probe
// would add a round trip to every send to guard against a table that is
// already applied, and the fail-soft insert below degrades identically if
// it ever isn't.
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type EmailKind = 'guest_invite' | 'access_notify' | 'access_grant' | 'support' | 'other';
export type EmailSendStatus = 'sent' | 'failed' | 'not_configured' | 'render_failed';

/**
 * Where an email came from, supplied by the caller. `kind` is required so a
 * row can always be attributed to a path; `orgId` and `relatedGrantId` are
 * optional because some senders (platform support, a claim notification)
 * genuinely have no org or grant behind them.
 */
export interface EmailContext {
  orgId?: string | null;
  kind: EmailKind;
  relatedGrantId?: string | null;
}

export interface EmailSendLogEntry extends EmailContext {
  recipient: string;
  subject?: string | null;
  status: EmailSendStatus;
  providerId?: string | null;
  providerError?: string | null;
  fromAddressUsed?: string | null;
}

// The provider's verbatim text is the whole value of this table, so it is
// truncated rather than dropped — and truncated HERE, in the writer, not by
// a database check constraint: a rejected INSERT would lose the one record
// the row exists to keep.
const PROVIDER_ERROR_MAX = 500;

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function logEmailSend(entry: EmailSendLogEntry): Promise<void> {
  try {
    const admin = adminClient();
    // No service key means no database to write to — and also means no email
    // was sent, which the caller has already handled. Nothing to record.
    if (!admin) return;
    const { error } = await admin.from('email_send_log').insert({
      org_id: entry.orgId ?? null,
      kind: entry.kind,
      recipient: entry.recipient,
      subject: entry.subject ?? null,
      status: entry.status,
      provider_id: entry.providerId ?? null,
      provider_error: entry.providerError ? entry.providerError.slice(0, PROVIDER_ERROR_MAX) : null,
      from_address_used: entry.fromAddressUsed ?? null,
      related_grant_id: entry.relatedGrantId ?? null,
    });
    if (error) console.error('[email-send-log] insert failed:', error.message);
  } catch (e) {
    console.error('[email-send-log] insert threw:', (e as Error).message);
  }
}

/**
 * For the failure that happens BEFORE the provider is ever called — a
 * template that could not be rendered, an unresolved token in the HTML.
 * Without this, a render failure was the one outcome that left no trace at
 * all: no provider response to log, and the send never attempted.
 */
export async function logEmailRenderFailure(
  context: EmailContext, recipient: string, reason: string, subject?: string,
): Promise<void> {
  await logEmailSend({ ...context, recipient, subject, status: 'render_failed', providerError: reason });
}
