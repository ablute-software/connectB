// Prompt 353 — Photos & media: file upload (image or short video). Reuses
// the Vault's own upload-security infra (content-sniff allowlist +
// VirusTotal scan) — never a parallel upload path without a scan, same
// requirement the prompt itself states.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { MEDIA_CATEGORIES, MAX_MEDIA_PER_ORG, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, validateCaption, type MediaCategory } from '@/lib/company-media';

export const maxDuration = 30;

const CATEGORY_VALUES = new Set(MEDIA_CATEGORIES.map((c) => c.value));

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const category = form?.get('category');
  const caption = form?.get('caption');
  if (!file || !(file instanceof File) || typeof category !== 'string' || typeof caption !== 'string') {
    return NextResponse.json({ ok: false, error: 'file, category and caption are required.' }, { status: 400 });
  }
  if (!CATEGORY_VALUES.has(category as MediaCategory)) return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 });
  const captionErr = validateCaption(caption);
  if (captionErr) return NextResponse.json({ ok: false, error: captionErr }, { status: 400 });

  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if (!isVideo && !isImage) return NextResponse.json({ ok: false, error: 'Only images and videos are accepted.' }, { status: 400 });
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json({ ok: false, error: `File too large (${Math.round(maxBytes / (1024 * 1024))}MB max).` }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { count } = await admin.from('company_media').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  if ((count ?? 0) >= MAX_MEDIA_PER_ORG) {
    return NextResponse.json({ ok: false, error: `You've reached the ${MAX_MEDIA_PER_ORG}-item limit — remove one to add another.` }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = detectAllowedKind(bytes, file.name);
  if (!kind || (isImage && !['jpg', 'png', 'webp'].includes(kind)) || (isVideo && !['mp4', 'webm'].includes(kind))) {
    return NextResponse.json({
      ok: false,
      error: isVideo
        ? 'This video type isn’t allowed (mp4/webm only), or its content doesn’t match its extension.'
        : 'This image type isn’t allowed (jpg/png/webp only), or its content doesn’t match its extension.',
    }, { status: 400 });
  }
  const verdict = await scanWithVirusTotal(bytes, file.name);
  if (verdict.status === 'flagged') return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storagePath = `_company_media/${orgId}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { data: row, error } = await admin.from('company_media').insert({
    org_id: orgId, kind: isVideo ? 'video_upload' : 'image', category, caption: caption.trim(),
    storage_path: storagePath, content_sha256: sha256Hex(bytes),
    malware_scan_status: verdict.status, malware_scan_checked_at: new Date().toISOString(),
    sort_order: count ?? 0,
  }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: row.id });
}
