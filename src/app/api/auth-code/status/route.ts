// Prompt 904 Part B — "who am I and do I have a startup yet?", for the step after the code:
// an authenticated user with no startup is sent to create one (name + country).
import { NextResponse } from 'next/server';
import { authCodeMode } from '@/lib/auth-code/mode';
import { serverClient } from '@/lib/supabase-server';

export async function GET() {
  if (authCodeMode() === 'off') return NextResponse.json({ ok: false }, { status: 404 });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: true, authenticated: false, hasStartup: false, userId: null });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  return NextResponse.json({ ok: true, authenticated: true, hasStartup: !!member, userId: user.id });
}
