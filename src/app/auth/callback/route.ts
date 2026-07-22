// OAuth / magic-link callback: exchange the code for a session cookie.
import { NextResponse, type NextRequest } from 'next/server';
import { serverClient, authEnabled } from '@/lib/supabase-server';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';
  if (code && authEnabled) {
    const sb = await serverClient();
    await sb.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
