// Prompt 924 (Etapa 4, I3) — the contestations of a call, for whoever has "Handle contestations" (checked here on every request).
//
//   GET                                    the queue: each contestation with its application, the result it contests, the applicant's reason and file, what the evaluations say as NUMBERS (never a comment)
//                                          and the decision, and — once answered — the response and the new result
//   POST { action: 'answer', contestationId, outcome: 'upheld' | 'rejected', newResult?: 'advance' | 'waitlist', response? }
//                                          Upheld: the decision changes (Advance or Waitlist) and the applicant is told with a NEW result (the old one is kept); Rejected: a written response is required and is sent
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { RESULTS_NOT_READY, resultsReady } from '@/lib/calls/results-store';
import { answerContestation, listContestations } from '@/lib/calls/contestations-store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'handle_contestations' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  return NextResponse.json(await listContestations(auth.admin, auth.call));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'handle_contestations' });
  if (auth.error) return auth.error;
  if (!(await resultsReady(auth.admin))) return NextResponse.json(RESULTS_NOT_READY, { status: 503 });
  const body = await req.json().catch(() => ({})) as { action?: string; contestationId?: unknown };
  if (body.action !== 'answer' || typeof body.contestationId !== 'string') return NextResponse.json({ ok: false, error: 'Choose a contestation to answer.' }, { status: 400 });
  const r = await answerContestation(auth.admin, auth.call, body.contestationId, body, auth.userId);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json(await listContestations(auth.admin, auth.call));
}
