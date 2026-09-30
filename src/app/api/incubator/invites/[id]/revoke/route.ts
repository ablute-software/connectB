// Prompt I-01 §A.8 — revoke a pending invite (incubator side only).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { data, error } = await gate.sb.rpc('incubator_revoke_invite', { p_invite_id: params.id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
