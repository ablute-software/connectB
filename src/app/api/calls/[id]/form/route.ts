// Prompt 905 — the Form tab's autosave: the whole ordered list of fields, checked by the server (kinds, option
// ids, validations, platform links, "a condition must point at an earlier question") and replaced under
// optimistic concurrency. Locked once the call is confirmed, and for good once it is open.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { parseFieldsPayload } from '@/lib/calls/form-builder';
import { bumpConfig, replaceFields } from '@/lib/calls/store';
import { buildCallState } from '@/lib/calls/state';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({})) as { baseVersion?: number; fields?: unknown };

  if (auth.call.status !== 'draft') {
    return NextResponse.json({ ok: false, code: 'locked', error: 'The form is locked. Use “Edit configuration” before the call opens; once it is open the questions cannot change.' }, { status: 409 });
  }
  const parsed = parseFieldsPayload(body.fields);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (!Number.isInteger(body.baseVersion)) return NextResponse.json({ ok: false, error: 'Missing baseVersion.' }, { status: 400 });

  const updated = await bumpConfig(auth.admin, auth.call, body.baseVersion as number);
  if (!updated) {
    return NextResponse.json({ ok: false, code: 'conflict', error: 'Someone else changed this call. Reload to see their changes.' }, { status: 409 });
  }
  await replaceFields(auth.admin, auth.call.id, parsed.fields);
  return NextResponse.json(await buildCallState(auth.admin, updated, auth.promoter));
}
