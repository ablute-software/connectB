// Prompt I-01 §A.3 — create a cohort (turma), through the member's own
// session (RLS incubator_cohorts_insert; auto_promo_code_id stays null
// until I-02).
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';

export async function POST(req: Request) {
  const gate = await requireIncubatorMember();
  if ('error' in gate) return gate.error;
  const b = await req.json().catch(() => ({})) as { name?: string; startsOn?: string; endsOn?: string };
  const name = b.name?.trim();
  if (!name) return NextResponse.json({ ok: false, error: 'The cohort name is required.' }, { status: 400 });
  const { data, error } = await gate.sb.from('incubator_cohorts').insert({
    incubator_id: gate.member.incubatorId, name, starts_on: b.startsOn || null, ends_on: b.endsOn || null,
  }).select('id, name, starts_on, ends_on, archived_at').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, cohort: data });
}
