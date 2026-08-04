// Identity verification Fase A (prompt 63), Bloco 3 — "we couldn't
// automatically verify your firm, please upload a document." Mirrors the
// nda-upload pattern (src/app/api/data-room/nda-upload/route.ts): a pointer
// row + review state, not a bespoke mechanism. One real difference: the
// 'data-room' Storage bucket's RLS policy requires org membership
// (0008_data_room_storage.sql) — investors are never org members, so the
// browser can't upload there directly the way nda-upload's client does.
// This route accepts the file server-side instead and uploads it with the
// service-role client, which bypasses that RLS entirely — no new bucket,
// no new Storage policy needed.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) return NextResponse.json({ ok: false, error: 'A file is required.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'File too large (10MB max).' }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storagePath = `_investor_verification/${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, file);
  if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { error } = await admin.from('investor_verification_documents').insert({
    user_id: user.id, investor_email: email, catalog_entity_id: member.catalog_entity_id,
    storage_path: storagePath, file_name: file.name,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
