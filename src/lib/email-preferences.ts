import 'server-only';
// Prompt 929 — what an account has chosen about the emails Sherlock Deal sends ON ITS OWN (not the entity's replies, which always go out): the tips after a call, the "this call is full" email, and — later — the
// call announcements. The choice is ON THE ACCOUNT (valid for every call), unchecked by default (nobody has refused anything until they do), changeable at any time, and every change is recorded (when, how).
// Every such email carries a link that turns the same choice off: a signed token (HMAC with a server secret) so nobody can switch somebody else's, and no login is needed to follow it.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailPreference = 'tips_opt_out' | 'announcements_opt_out';
const PREFS: EmailPreference[] = ['tips_opt_out', 'announcements_opt_out'];
type Row = Record<string, unknown>;

const secret = (): string | null => process.env.SUPABASE_SERVICE_ROLE_KEY || null;
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (payload: string, key: string) => createHmac('sha256', key).update(`email-preference:${payload}`).digest('hex').slice(0, 32);

/** The token that goes in the link of an email: who, which preference, and a signature only this server can make. */
export function preferenceToken(userId: string, pref: EmailPreference): string | null {
  const key = secret();
  if (!key) return null;
  const payload = `${userId}|${pref}`;
  return `${b64(payload)}.${sign(payload, key)}`;
}

export function readPreferenceToken(token: unknown): { userId: string; pref: EmailPreference } | null {
  const key = secret();
  if (!key || typeof token !== 'string' || token.length > 300) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let payload: string;
  try { payload = Buffer.from(body, 'base64url').toString('utf8'); } catch { return null; }
  const [userId, pref] = payload.split('|');
  if (!userId || !PREFS.includes(pref as EmailPreference) || !/^[0-9a-fA-F-]{36}$/.test(userId)) return null;
  const expected = Buffer.from(sign(payload, key)); const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId, pref: pref as EmailPreference };
}

/** Has this account refused this kind of email? (Nothing recorded = no.) */
export async function hasOptedOut(admin: SupabaseClient, userId: string, pref: EmailPreference): Promise<boolean> {
  const { data } = await admin.from('user_email_preferences').select('tips_opt_out, announcements_opt_out').eq('user_id', userId).maybeSingle();
  return (data as Row | null)?.[pref] === true;
}

/** Change a choice and record it (what, to what, when, and how: "link in an email", "account settings"). Setting the value it already has records nothing. */
export async function setPreference(admin: SupabaseClient, userId: string, pref: EmailPreference, value: boolean, via: string): Promise<boolean> {
  const { data } = await admin.from('user_email_preferences').select('user_id, tips_opt_out, announcements_opt_out').eq('user_id', userId).maybeSingle();
  const cur = data as Row | null;
  if ((cur?.[pref] === true) === value && cur) return false;
  if (!cur && !value) return false;
  const now = new Date().toISOString();
  if (cur) await admin.from('user_email_preferences').update({ [pref]: value, updated_at: now }).eq('user_id', userId);
  else await admin.from('user_email_preferences').insert({ user_id: userId, [pref]: value, updated_at: now });
  await admin.from('user_email_preference_changes').insert({ user_id: userId, preference: pref, value, via });
  return true;
}
