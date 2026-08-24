// Prompt 353 — Photos & media: a video LINK, strictly YouTube/Vimeo (never
// an arbitrary embed) — validated server-side, same discipline data-room.ts
// already applies to the no-/edit-links rule.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { MEDIA_CATEGORIES, MAX_MEDIA_PER_ORG, isAllowedVideoLink, toEmbedUrl, validateCaption, type MediaCategory } from '@/lib/company-media';

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

  const body = await req.json().catch(() => ({})) as { url?: string; category?: string; caption?: string };
  if (!body.url || !body.category || !body.caption) {
    return NextResponse.json({ ok: false, error: 'url, category and caption are required.' }, { status: 400 });
  }
  if (!CATEGORY_VALUES.has(body.category as MediaCategory)) return NextResponse.json({ ok: false, error: 'Invalid category.' }, { status: 400 });
  const captionErr = validateCaption(body.caption);
  if (captionErr) return NextResponse.json({ ok: false, error: captionErr }, { status: 400 });
  if (!isAllowedVideoLink(body.url) || !toEmbedUrl(body.url)) {
    return NextResponse.json({ ok: false, error: 'Only YouTube and Vimeo video links are accepted.' }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { count } = await admin.from('company_media').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  if ((count ?? 0) >= MAX_MEDIA_PER_ORG) {
    return NextResponse.json({ ok: false, error: `You've reached the ${MAX_MEDIA_PER_ORG}-item limit — remove one to add another.` }, { status: 400 });
  }

  const { data: row, error } = await admin.from('company_media').insert({
    org_id: orgId, kind: 'video_link', category: body.category, caption: body.caption.trim(),
    external_url: body.url, malware_scan_status: 'clean', sort_order: count ?? 0,
  }).select('id').single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: row.id });
}
