// Prompt I-01 §A.3 — archive/unarchive a cohort (a state, never a delete).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const b = await req.json().catch(() => ({})) as { archived?: boolean };
  const { data, error } = await gate.sb.from('incubator_cohorts')
    .update({ archived_at: b.archived ? new Date().toISOString() : null })
    .eq('id', params.id).eq('incubator_id', gate.member.incubatorId)
    .select('id').maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
