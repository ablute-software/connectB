// Prompt I-01 §C.4 — D4: "visível no meu perfil público", per relationship.
// (The badge's investor-facing surface is I-03; this only stores the choice.)
import { NextResponse } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { incubatorErrorText } from '@/lib/incubators';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!authEnabled) return NextResponse.json({ ok: false, demo: true, error: 'not configured' });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { value } = await req.json().catch(() => ({})) as { value?: boolean };
  const { data, error } = await sb.rpc('incubator_set_public_badge', { p_relationship_id: params.id, p_value: value !== false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.ok) return NextResponse.json({ ok: false, error: data?.error, message: incubatorErrorText(data?.error) }, { status: 400 });
  return NextResponse.json({ ok: true, publicBadge: data.public_badge });
}
