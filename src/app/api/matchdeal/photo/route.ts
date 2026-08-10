// Prompt 161 D — file upload for the MatchDeal profile photo (photo_url
// was URL-paste only + "Use your Sherlock Deal logo"). Server-side upload
// with the service-role client, same pattern and reasoning as
// /api/portal/investor-profile/upload-document: the 'data-room' bucket's
// RLS (0008) requires org membership on the path's first folder, which an
// INVESTOR-kind profile owner never has — a direct browser upload works
// for startups but 403s for investors, so one server route serves both
// kinds identically instead of two divergent client paths.
//
// Returns a long-lived signed URL (same 10-year TTL and trade-off as
// ProfilePanel.tsx's LOGO_SIGNED_URL_TTL_SECONDS — the URL is stored
// verbatim in matchdeal_profiles.photo_url and read by CardFace/deck
// renderers as-is). The client sets it into local form state; the normal
// Save is what persists it — same contract as "Use your Sherlock Deal
// logo", nothing here writes matchdeal_profiles.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

const SIGNED_URL_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const profileId = form?.get('profileId');
  if (!file || !(file instanceof File) || typeof profileId !== 'string' || !profileId) {
    return NextResponse.json({ ok: false, error: 'A file and profileId are required.' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) return NextResponse.json({ ok: false, error: 'Only images are accepted.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'File too large (10MB max).' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Ownership check — the caller must actually own this profile. Same
  // membership resolution the profile's own RLS write policy
  // (matchdeal_profiles_write_own) applies: startup kind -> membership_id
  // is an org the caller belongs to; investor kind -> membership_id is the
  // caller's own matchdeal_investor_members row.
  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('id, kind, membership_id').eq('id', profileId).maybeSingle();
  if (!profile) return NextResponse.json({ ok: false, error: 'Profile not found.' }, { status: 404 });
  if (profile.kind === 'startup') {
    const { data: member } = await admin.from('org_members').select('org_id')
      .eq('user_id', user.id).eq('org_id', profile.membership_id).maybeSingle();
    if (!member) return NextResponse.json({ ok: false, error: 'Not your profile.' }, { status: 403 });
  } else {
    const member = await resolveActiveInvestorMember(admin, user.id);
    if (!member || member.id !== profile.membership_id) {
      return NextResponse.json({ ok: false, error: 'Not your profile.' }, { status: 403 });
    }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storagePath = `_matchdeal_photos/${profile.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, file);
  if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { data: signed, error: signError } = await admin.storage.from('data-room')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, error: signError?.message ?? 'Could not create a link for the photo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, photoUrl: signed.signedUrl });
}
