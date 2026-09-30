// Prompt I-01 §C.4 — the founder changes the sharing level (0–2 in Phase 1;
// 3–4 are refused inside incubator_set_sharing_level()). Owner/admin only
// (I-01b §B), here and again in SQL.
import { NextResponse } from 'next/server';
import { requireProgramManager } from '@/lib/incubator-founder-gate';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireProgramManager(req);
  if ('error' in gate) return gate.error;
  const { level } = await req.json().catch(() => ({})) as { level?: number };
  const { data, error } = await gate.sb.rpc('incubator_set_sharing_level', { p_relationship_id: params.id, p_level: Number(level) });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true, sharingLevel: data.sharing_level });
}
