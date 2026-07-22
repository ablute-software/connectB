// IRM_SPEC §8d — resolves the caller's own Gmail connection, transparently
// refreshing the access token when it's near expiry. Runs on the caller's
// own session (serverClient) — email_connections' RLS already scopes every
// row to user_id = auth.uid(), so no service role is needed here.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, decryptToken } from './crypto';
import { refreshAccessToken } from './google-oauth';

export interface EmailConnection {
  emailAddress: string;
  accessToken: string;
}

export async function getEmailConnection(sb: SupabaseClient, userId: string): Promise<EmailConnection | null> {
  const { data: row } = await sb.from('email_connections').select('*').eq('user_id', userId).eq('provider', 'gmail').maybeSingle();
  if (!row) return null;

  const expiresAt = new Date(row.token_expires_at).getTime();
  if (expiresAt - Date.now() > 60_000) {
    return { emailAddress: row.email_address, accessToken: decryptToken(row.access_token_enc) };
  }

  // Access token expired or about to — refresh and persist the new one.
  const refreshed = await refreshAccessToken(decryptToken(row.refresh_token_enc));
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await sb.from('email_connections').update({
    access_token_enc: encryptToken(refreshed.access_token), token_expires_at: newExpiresAt,
  }).eq('user_id', userId).eq('provider', 'gmail');

  return { emailAddress: row.email_address, accessToken: refreshed.access_token };
}
