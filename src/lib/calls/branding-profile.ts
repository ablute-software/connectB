// Prompt 918 (Adenda 1, C) — "the logo uploaded here is kept in the profile too, with confirmation": when the person confirmed it, and only when the entity's profile has no logo yet, the
// uploaded logo also becomes the profile's. Never overwrites a logo the profile already has. A firm's logo lives on the profile of one of its members (the caller's own); an incubator's on
// the incubator. The profile keeps an ADDRESS, so a long-lived signed one is made (the same trade-off, and the same ten years, as the Match Deal photo).
import type { SupabaseClient } from '@supabase/supabase-js';
import { MEDIA_BUCKET, profileLogos } from './branding';
import type { Call } from './types';

const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

export async function saveLogoToProfile(admin: SupabaseClient, call: Call, userId: string, path: string): Promise<'saved' | 'already_has_one' | 'not_possible'> {
  const existing = await profileLogos(admin, [call]);
  if (existing.has(`${call.promoterKind}:${call.promoterId}`)) return 'already_has_one';
  const { data: signed } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(path, TEN_YEARS, { download: false });
  const url = signed?.signedUrl;
  if (!url) return 'not_possible';
  if (call.promoterKind === 'incubator') {
    const { data } = await admin.from('incubators').update({ logo_url: url }).eq('id', call.promoterId).is('logo_url', null).select('id');
    return (data ?? []).length > 0 ? 'saved' : 'not_possible';
  }
  const { data: member } = await admin.from('matchdeal_investor_members').select('id').eq('catalog_entity_id', call.promoterId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  const membershipId = (member as { id?: string } | null)?.id;
  if (!membershipId) return 'not_possible';
  const { data } = await admin.from('matchdeal_profiles').update({ entity_logo_url: url }).eq('membership_id', membershipId).select('membership_id');
  return (data ?? []).length > 0 ? 'saved' : 'not_possible';
}
