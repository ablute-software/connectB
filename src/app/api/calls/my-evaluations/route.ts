// Prompt 922 (I3) — "My evaluations": the applications assigned to the person, by call, with how each stands (not started / in progress / submitted), how many remain and the next deadline. The server decides
// what is theirs: a call where they no longer have "Evaluate assigned applications" (or that was deleted or archived) is not listed.
import { NextResponse } from 'next/server';
import { authCalls } from '@/lib/calls/access';
import { evaluationReady } from '@/lib/calls/eval-grid-store';
import { listMine } from '@/lib/calls/eval-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await authCalls();
  if (auth.error) return auth.error;
  if (!(await evaluationReady(auth.admin))) return NextResponse.json({ ok: true, calls: [], remaining: 0 });
  const calls = await listMine(auth);
  return NextResponse.json({ ok: true, calls, remaining: calls.reduce((n, c) => n + c.remaining, 0) });
}
