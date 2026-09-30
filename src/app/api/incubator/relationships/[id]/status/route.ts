// Prompt I-01 §A.8 — incubator side: active ⇄ paused, active → graduated
// (graduation drops the level to 1 inside the trigger — D6b).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const { status } = await req.json().catch(() => ({})) as { status?: string };
  const { data, error } = await gate.sb.rpc('incubator_set_status', { p_relationship_id: params.id, p_status: status ?? '' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true, status: data.status, sharingLevel: data.sharing_level });
}
