// Prompt 602 — server-side composition for the account-security flows.
// Rules are in account-security.ts; this file is the auth calls, the DB
// writes, the emails and the Stripe cancellation.
import 'server-only';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendTransactionalEmail } from './resend';
import { BRAND_NAME, APP_URL } from './brand';
import { stripeConfigured, stripeSecret } from './stripe-env';
import { describeOrigin, NOT_ME_TOKEN_TTL_HOURS, type SecurityEventKind } from './account-security';

export function serviceAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return null;
  return createClient(url, service, { auth: { persistSession: false } });
}

export function requestOrigin(req: Request): { ip: string | null; userAgent: string | null } {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip');
  return { ip: ip ? ip.split(',')[0].trim() : null, userAgent: req.headers.get('user-agent') };
}

/**
 * §A — "pedir a palavra-passe actual antes de aceitar a nova". Verified the
 * only way that never touches a stored hash: a sign-in attempt with the anon
 * key and no persisted session. Wrong password → false. Nothing is written.
 */
export async function verifyCurrentPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !password) return false;
  const probe = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // The probe session is discarded, never stored: sign it out so it is not a
  // live refresh token lying around for a credential check.
  await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return true;
}

/** The caller's own session id (JWT claim), so "end the other sessions" can keep this one. */
export async function currentSessionId(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { session_id?: string };
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}

export async function terminateSessions(admin: SupabaseClient, userId: string, keepSessionId: string | null): Promise<number> {
  const { data, error } = await admin.rpc('account_terminate_sessions', { p_user_id: userId, p_keep_session_id: keepSessionId });
  if (error) { console.error('[account-security] terminate sessions failed:', error.message); return 0; }
  return Number(data ?? 0);
}

export async function recordSecurityEvent(admin: SupabaseClient, ev: {
  userId: string | null; orgId: string | null; kind: SecurityEventKind; actorUserId?: string | null;
  ip?: string | null; userAgent?: string | null; detail?: unknown; tokenHash?: string | null; tokenExpiresAt?: string | null;
}): Promise<string | null> {
  const { data, error } = await admin.from('account_security_events').insert({
    user_id: ev.userId, org_id: ev.orgId, kind: ev.kind, actor_user_id: ev.actorUserId ?? null,
    ip: ev.ip ?? null, user_agent: ev.userAgent ?? null, detail: ev.detail ?? null,
    token_hash: ev.tokenHash ?? null, token_expires_at: ev.tokenExpiresAt ?? null,
  }).select('id').single();
  if (error) { console.error('[account-security] event insert failed:', error.message); return null; }
  return data.id as string;
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function newRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function notMeExpiry(now: Date): string {
  return new Date(now.getTime() + NOT_ME_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function userEmail(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

export async function orgMemberEmails(admin: SupabaseClient, orgId: string): Promise<{ userId: string; role: string; email: string }[]> {
  const { data: members } = await admin.from('org_members').select('user_id, role').eq('org_id', orgId);
  const out: { userId: string; role: string; email: string }[] = [];
  for (const m of members ?? []) {
    const email = await userEmail(admin, m.user_id as string);
    if (email) out.push({ userId: m.user_id as string, role: m.role as string, email });
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendPlain(to: string, orgId: string | null, subject: string, paragraphs: string[], button?: { label: string; href: string }, secondary?: { label: string; href: string }) {
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">`
    + paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')
    + (button ? `<p><a href="${button.href}" style="display:inline-block;background:#0E7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(button.label)}</a></p>` : '')
    + (secondary ? `<p style="font-size:13px"><a href="${secondary.href}" style="color:#B00000">${escapeHtml(secondary.label)}</a></p>` : '')
    + `<p style="color:#6b7280;font-size:12px">${escapeHtml(BRAND_NAME)}</p></div>`;
  const text = paragraphs.concat(button ? [`${button.label}: ${button.href}`] : [], secondary ? [`${secondary.label}: ${secondary.href}`] : []).join('\n\n');
  return sendTransactionalEmail({ to, subject, html, text, context: { orgId, kind: 'other' } });
}

/** §A — "email a avisar que a palavra-passe mudou, com data e origem — sem a palavra-passe lá dentro". */
export async function notifyPasswordChanged(email: string, orgId: string | null, when: Date, ip: string | null, userAgent: string | null) {
  return sendPlain(email, orgId, `Your ${BRAND_NAME} password was changed`, [
    `Your ${BRAND_NAME} password was changed on ${when.toUTCString()} from ${describeOrigin(ip, userAgent)}.`,
    'Every other session on this account was ended at the same time; only the one that made the change stays signed in.',
    `If this was not you, reset your password now from ${APP_URL}/forgot-password and contact support.`,
  ]);
}

/** §B — the owner is told WHO started it, WHEN and FROM WHERE, gets the one-time link, and a "this wasn't me" button. Never a password. */
export async function notifyOwnerResetInitiated(opts: {
  ownerEmail: string; orgId: string; orgName: string; adminEmail: string; when: Date; ip: string | null; userAgent: string | null;
  resetLink: string; notMeLink: string;
}) {
  return sendPlain(opts.ownerEmail, opts.orgId, `${opts.adminEmail} started a password reset on your ${BRAND_NAME} account`, [
    `${opts.adminEmail}, an admin of ${opts.orgName}, started a reset of YOUR ${BRAND_NAME} password on ${opts.when.toUTCString()} from ${describeOrigin(opts.ip, opts.userAgent)}.`,
    'They cannot see or choose your password. Only you can, with the one-time link below — it works once and expires shortly. Until you use it, your current password stays as it is.',
    'You allowed this from Settings → App access. You can switch it off there at any time.',
  ], { label: 'Choose a new password', href: opts.resetLink },
  { label: "This wasn't me — end every session on my account and lock it until I reset", href: opts.notMeLink });
}

/** §B "não fui eu" — after the lock: a fresh link so only the owner can get back in. */
export async function notifyAccountSecured(ownerEmail: string, orgId: string | null, when: Date, resetLink: string) {
  return sendPlain(ownerEmail, orgId, `Your ${BRAND_NAME} account was secured`, [
    `As you asked on ${when.toUTCString()}: every session on your account was ended and the previous password no longer works.`,
    'Use the one-time link below to choose a new password. Nobody else received it.',
  ], { label: 'Choose a new password', href: resetLink });
}

/** §C — every member hears it from us, saying who closed it and what happens next; never "your account expired". */
export async function notifyOrgClosed(opts: {
  to: string; orgId: string; orgName: string; ownerEmail: string; when: Date; purgeAfter: string; isOwner: boolean;
}) {
  const kept = new Date(opts.purgeAfter).toUTCString();
  return sendPlain(opts.to, opts.orgId, `${opts.orgName} was closed on ${BRAND_NAME}`, [
    opts.isOwner
      ? `You closed ${opts.orgName}'s ${BRAND_NAME} account on ${opts.when.toUTCString()}. Access has ended for every member.`
      : `${opts.ownerEmail}, the owner of ${opts.orgName}, closed its ${BRAND_NAME} account on ${opts.when.toUTCString()}. Your access ended at the same moment.`,
    `Nothing has been deleted. The data is kept until ${kept} in case this was a mistake; within that window the owner can ask support to reopen the account. After it, the account can no longer be reopened from the app.`,
    `To ask for the effective deletion of your data (GDPR, Article 17) at any time, use ${APP_URL}/privacy-request.`,
  ]);
}

/** §C — "a subscrição é cancelada", in Stripe, not only on the screen. */
export async function cancelStripeSubscription(subscriptionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!stripeConfigured()) return { ok: false, error: 'Billing not configured.' };
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${stripeSecret()}` },
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
  if (body?.error?.code === 'resource_missing') return { ok: true };
  return { ok: false, error: `${body?.error?.code ?? res.status}: ${body?.error?.message ?? ''}`.trim() };
}

/** A one-time recovery link for `email`, landing on the app's own reset screen. */
export async function generateRecoveryLink(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery', email,
    options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent('/reset-password')}` },
  });
  if (error) { console.error('[account-security] generateLink failed:', error.message); return null; }
  return data?.properties?.action_link ?? null;
}

export async function rotatePasswordToRandom(admin: SupabaseClient, userId: string): Promise<boolean> {
  const random = crypto.randomBytes(24).toString('base64url') + 'Aa1!';
  const { error } = await admin.auth.admin.updateUserById(userId, { password: random });
  if (error) console.error('[account-security] password rotation failed:', error.message);
  return !error;
}
