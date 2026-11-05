// Prompt 929 — the link in every email Sherlock Deal sends on its own ("Stop receiving tips from Sherlock Deal"): it needs no login (the person may be reading the email anywhere) and turns the choice off for the
// account the signed token names. Following it again changes nothing; "undo" turns it back on. The page says what happened in one sentence and never reveals anything about the account.
import { NextResponse } from 'next/server';
import { createNoStoreClient } from '@/lib/supabase-no-store';
import { preferenceToken, readPreferenceToken, setPreference } from '@/lib/email-preferences';

export const dynamic = 'force-dynamic';

const WHAT: Record<string, string> = { tips_opt_out: 'tips from Sherlock Deal', announcements_opt_out: 'call announcements from Sherlock Deal' };
const page = (title: string, body: string, status = 200) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>` +
  `<body style="font-family: -apple-system, 'Segoe UI', Arial, sans-serif; background:#F9FAFB; margin:0; padding:48px 16px;"><main style="max-width:480px; margin:0 auto; background:#fff; border-radius:12px; padding:28px; box-shadow:0 1px 3px rgba(0,0,0,.1);">` +
  `<h1 style="font-size:18px; color:#111827; margin:0 0 12px;">${title}</h1><p style="font-size:14px; color:#4B5563; line-height:1.5; margin:0;">${body}</p></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t');
  const read = readPreferenceToken(token);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY; const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!read || !service || !base) return page('This link is not valid', 'It may have been cut when it was copied. Open the email again and use the link in it, or change your choice in your account settings.', 400);
  const admin = createNoStoreClient(base, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const undo = url.searchParams.get('undo') === '1';
  await setPreference(admin, read.userId, read.pref, !undo, undo ? 'link in an email (undo)' : 'link in an email');
  const again = preferenceToken(read.userId, read.pref);
  if (undo) return page('You will receive them again', `You will receive ${WHAT[read.pref]} again. You can stop them at any time from the link in any of those emails.`);
  return page('You will not receive them any more', `You will no longer receive ${WHAT[read.pref]}. The replies of the organisations you apply to are not affected: you always receive those. <a href="/api/email/unsubscribe?t=${encodeURIComponent(again ?? '')}&undo=1" style="color:#0E7490;">Changed your mind? Turn them back on.</a>`);
}
