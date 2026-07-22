import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { googleOAuthConfigured } from '@/lib/google-oauth';

export async function GET() {
  if (!googleOAuthConfigured()) return NextResponse.json({ configured: false, connected: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ configured: true, connected: false });

  const { data } = await sb.from('email_connections').select('email_address').eq('user_id', user.id).eq('provider', 'gmail').maybeSingle();
  return NextResponse.json({ configured: true, connected: !!data, email: data?.email_address ?? null });
}
