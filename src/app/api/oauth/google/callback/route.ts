// IRM_SPEC §8d — Gmail OAuth callback: exchange code -> tokens, encrypt,
// upsert the caller's own email_connections row (RLS: user_id = auth.uid()
// covers this, no service role needed).
import { NextRequest, NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { googleOAuthConfigured, exchangeCode, fetchGoogleEmail } from '@/lib/google-oauth';
import { encryptToken } from '@/lib/crypto';

export async function GET(req: NextRequest) {
  const { origin, searchParams } = new URL(req.url);
  if (!googleOAuthConfigured()) return NextResponse.redirect(`${origin}/settings?gmail=not_configured`);

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const expectedState = req.cookies.get('gmail_oauth_state')?.value;
  if (searchParams.get('error')) return NextResponse.redirect(`${origin}/settings?gmail=denied`);
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${origin}/settings?gmail=error`);
  }

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=/settings`);

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.redirect(`${origin}/settings?gmail=error`);

  try {
    const tokens = await exchangeCode(code, origin);
    if (!tokens.refresh_token) {
      // Google omits refresh_token on a re-consent without prompt=consent
      // forcing a fresh grant; we always pass prompt=consent, so this
      // should only happen on a genuine edge case — surface it plainly.
      return NextResponse.redirect(`${origin}/settings?gmail=error`);
    }
    const email = await fetchGoogleEmail(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    const { error } = await sb.from('email_connections').upsert({
      org_id: member.org_id, user_id: user.id, provider: 'gmail', email_address: email,
      access_token_enc: encryptToken(tokens.access_token), refresh_token_enc: encryptToken(tokens.refresh_token),
      token_expires_at: expiresAt,
    }, { onConflict: 'user_id,provider' });
    if (error) throw error;

    const res = NextResponse.redirect(`${origin}/settings?gmail=connected`);
    res.cookies.delete('gmail_oauth_state');
    return res;
  } catch {
    return NextResponse.redirect(`${origin}/settings?gmail=error`);
  }
}
