// Prompt I-01 §C.3 — Definições: the owner edits the incubator's profile
// (name, kind, website, city, logo, description) through
// incubator_update_profile(). The D3 link, NIF, billing and closing stay
// back-office only.
import { NextResponse } from 'next/server';
import { requireIncubatorMember } from '@/lib/incubator-access';
import { incubatorErrorText } from '@/lib/incubators';

export async function PATCH(req: Request) {
  const gate = await requireIncubatorMember({ ownerOnly: true });
  if ('error' in gate) return gate.error;
  const b = await req.json().catch(() => ({})) as Record<string, string | undefined>;
  const { data, error } = await gate.sb.rpc('incubator_update_profile', {
    p_incubator_id: gate.member.incubatorId,
    p_name: b.name ?? '', p_kind: b.kind ?? 'other', p_website: b.website ?? '',
    p_city: b.city ?? '', p_logo_url: b.logo_url ?? '', p_description: b.description ?? '',
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true });
}
