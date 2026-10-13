// Prompt 900 §A — Startups › "Closed & deleted": every account that ended (closed_at set, or deleted by moderation), the people
// still attached to it and the other hats each holds, how it ended, and whether Reopen account / Release email is available for
// each — with the reason when it is not. Read-only; the two actions have their own routes next to this one.
// Back-office only: outside the Developer Viewer's acting-org rules (it lists every org, by design, like backoffice/startups).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { loadClosedAccounts } from '@/lib/closed-accounts-server';

// A list of live data behind an admin session: never prerendered, whatever the build's environment looks like (a build with the
// Supabase variables blank reports every GET that only reads cookies through requirePlatformAdmin() as static).
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json({ ok: true, accounts: await loadClosedAccounts(auth.admin) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Could not load the closed and deleted accounts.' }, { status: 500 });
  }
}
