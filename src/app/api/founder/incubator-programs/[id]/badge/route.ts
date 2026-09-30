// Prompt I-01 §C.4 — D4: "visible on my public profile", per relationship.
// (The badge's investor-facing surface is I-03; this only stores the choice.)
// Owner/admin only (I-01b §B).
import { NextResponse } from 'next/server';
import { requireProgramManager } from '@/lib/incubator-founder-gate';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireProgramManager(req);
  if ('error' in gate) return gate.error;
  const { value } = await req.json().catch(() => ({})) as { value?: boolean };
  const { data, error } = await gate.sb.rpc('incubator_set_public_badge', { p_relationship_id: params.id, p_value: value !== false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true, publicBadge: data.public_badge });
}
