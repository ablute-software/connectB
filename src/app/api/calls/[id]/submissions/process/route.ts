// Prompt 918 (I3) — lets the Applications tab take the queue forward when somebody looks (the daily cron is the safety net, and every submission already gets a first go at once). Whoever may
// "View all applications". It only runs what is queued; a task that fails goes back with a back-off, and nothing here can change a result by itself.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { processQueue } from '@/lib/calls/eligibility-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const run = await processQueue(auth.admin, { limit: 5 });
  return NextResponse.json({ ok: true, ...run });
}
