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
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { matchdealPhotoScanAvailable } from '@/lib/upload-security-capability';

export const maxDuration = 30;

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

  // Prompt 305 §A — real content validation, not just the client-supplied
  // file.type checked above (as spoofable as a filename extension).
  // detectAllowedKind's allowlist has no 'svg' entry at all — deliberate:
  // an SVG can embed <script>, and while every renderer of this photo_url
  // in this codebase only ever uses <img src> (sandboxed, confirmed by
  // grep), the signed URL below is a plain HTTPS link nothing stops
  // someone from opening directly, where a top-level SVG document's script
  // WOULD run. See upload-security.ts's own header for the full reasoning.
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = detectAllowedKind(bytes, file.name);
  if (!kind) {
    return NextResponse.json({
      ok: false,
      error: 'This image type isn’t allowed (jpg/png/gif/webp only — no SVG), or its content doesn’t match its extension.',
    }, { status: 400 });
  }
  const verdict = await scanWithVirusTotal(bytes, file.name);
  if (verdict.status === 'flagged') {
    return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
  }

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
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

  // Prompt 305 §A — written here (not client-side, where photo_url itself
  // gets saved) since this route already has the service-role client and
  // the real verdict; a photo uploaded but never actually Saved by the
  // founder just leaves a harmless orphaned status, never a security gap.
  if (await matchdealPhotoScanAvailable()) {
    await admin.from('matchdeal_profiles').update({
      photo_malware_scan_status: verdict.status, photo_scan_checked_at: new Date().toISOString(),
      photo_content_sha256: sha256Hex(bytes), photo_storage_path: storagePath,
    }).eq('id', profile.id);
  }

  const { data: signed, error: signError } = await admin.storage.from('data-room')
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, error: signError?.message ?? 'Could not create a link for the photo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, photoUrl: signed.signedUrl });
}
