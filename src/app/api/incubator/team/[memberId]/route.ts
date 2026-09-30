// Prompt I-01 §C.3 — remove a member (owner only; the last owner stays).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { incubatorErrorText } from '@/lib/incubators';

export async function DELETE(_req: Request, { params }: { params: { memberId: string } }) {
  const gate = await requireIncubatorMember({ ownerOnly: true });
  if ('error' in gate) return gate.error;
  const { data, error } = await gate.sb.rpc('incubator_remove_member', { p_member_id: params.memberId });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
