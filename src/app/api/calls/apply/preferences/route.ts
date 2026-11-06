// Prompt 929 (B) — the applicant's own choice about the tips from Sherlock Deal: "I don't want to receive feedback from Sherlock Deal about my evaluations". It lives on the ACCOUNT (not on an application), so
// it holds for every call, and it is read again at the moment a tip would be sent. Only the signed-in person's own row is ever read or changed; the choice is recorded with when and how it changed.
import { NextResponse } from 'next/server';
import { withActingOrg, withoutViewer } from '@/lib/acting-org';
import { serverClient } from '@/lib/supabase-server';
import { callsMode } from '@/lib/calls/mode';
import { serviceClient } from '@/lib/calls/applicant/link';
import { hasOptedOut, setPreference } from '@/lib/email-preferences';

export const dynamic = 'force-dynamic';

async function me() {
  if (callsMode() === 'off') return { error: NextResponse.json({ ok: false }, { status: 404 }) } as const;
  const admin = serviceClient();
  if (!admin) return { error: NextResponse.json({ ok: true, tipsOptOut: false }) } as const;
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) } as const;
  return { admin, userId: user.id } as const;
}

export const GET = withActingOrg(async function GET() {
  const w = await me();
  if ('error' in w) return w.error;
  return NextResponse.json({ ok: true, tipsOptOut: await hasOptedOut(w.admin, w.userId, 'tips_opt_out') });
});

export const POST = withoutViewer(async function POST(req: Request) {
  const w = await me();
  if ('error' in w) return w.error;
  const body = (await req.json().catch(() => ({}))) as { tipsOptOut?: unknown };
  if (typeof body.tipsOptOut !== 'boolean') return NextResponse.json({ ok: false, error: 'Choose yes or no.' }, { status: 400 });
  await setPreference(w.admin, w.userId, 'tips_opt_out', body.tipsOptOut, 'account settings');
  return NextResponse.json({ ok: true, tipsOptOut: body.tipsOptOut });
});
