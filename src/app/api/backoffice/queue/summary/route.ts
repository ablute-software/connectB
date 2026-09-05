// Prompt 570 §B — every queue's undecided count, in one request.
//
// The Queue opened on whichever tab was first and made you click through
// twelve of them to find the one with work in it. Seven are empty today. This
// is the number that lets the board say so.
//
// The actual row computation lives in src/lib/queue-summary.ts (extracted
// Prompt 576 Fase 2), so Attention's Review badges can cite the exact same
// counts this board shows rather than a second definition of "undecided".
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { getQueueSummaryRows, type QueueSummaryRow } from '@/lib/queue-summary';

export type { QueueSummaryRow };

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const rows = await getQueueSummaryRows(auth.admin);

  return NextResponse.json({ ok: true, rows }, {
    // Short cache: the board is a glance, and twelve counts do not need to be
    // to-the-second. 30s is the prompt's own allowance.
    headers: { 'Cache-Control': 'private, max-age=30' },
  });
}
