// Prompt 918 (Adenda 2, C) — what deleting this call would remove, in numbers (never who), for the confirmation dialog: submitted applications, applicants with a draft, uploaded files — and
// whether the call is open (deleting closes it). Only for whoever may "Configure call": the same permission that deletes.
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { effectiveStatus } from '@/lib/calls/lifecycle';
import { deletionImpact } from '@/lib/calls/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  const impact = await deletionImpact(auth.admin, auth.call.id);
  return NextResponse.json({ ok: true, name: auth.call.name, isOpen: effectiveStatus(auth.call) === 'open', ...impact });
}
