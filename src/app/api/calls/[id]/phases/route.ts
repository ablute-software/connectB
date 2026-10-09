// Prompt 905 — the Phases tab's autosave: the whole ordered list, replaced under optimistic concurrency.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parsePhasesPayload } from '@/lib/calls/mappers';
import { bumpConfig, replacePhases } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { baseVersion?: number; phases?: unknown };

  if (auth.call.status !== 'draft') {
    return NextResponse.json({ ok: false, code: 'locked', error: 'This call is confirmed. Use “Edit configuration” to change it.' }, { status: 409 });
  }
  const parsed = parsePhasesPayload(body.phases);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (!Number.isInteger(body.baseVersion)) return NextResponse.json({ ok: false, error: 'Missing baseVersion.' }, { status: 400 });

  // Claim the new version first: if somebody saved in between, nothing is written.
  const updated = await bumpConfig(auth.admin, auth.call, body.baseVersion as number);
  if (!updated) {
    return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload to see their changes.' }, { status: 409 });
  }
  await replacePhases(auth.admin, auth.call.id, parsed.phases);
  return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
}
