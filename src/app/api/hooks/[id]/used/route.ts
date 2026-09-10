// Prompt 585 §F.8 — "Use in draft" marks the suggestion used. Never marks
// anything as sent (there is no send route for a hook — the founder still
// has to press Send on the real message composer themselves).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: suggestion } = await admin.from('hook_suggestions').select('id, org_id').eq('id', params.id).maybeSingle();
  if (!suggestion || suggestion.org_id !== member.org_id) {
    return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }
  await admin.from('hook_suggestions').update({ used_at: new Date().toISOString() }).eq('id', params.id);
  return NextResponse.json({ ok: true });
}
