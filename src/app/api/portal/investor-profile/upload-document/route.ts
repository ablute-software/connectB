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
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { investorVerificationScanAvailable } from '@/lib/upload-security-capability';

// Prompt 305 §A — reading + scanning bytes server-side can run longer than
// the default; within Hobby-plan's own allowed range.
export const maxDuration = 30;

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

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const member = await resolveActiveInvestorMember(admin, user.id);
  if (!member) return NextResponse.json({ ok: false, error: 'No linked investor entity yet.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) return NextResponse.json({ ok: false, error: 'A file is required.' }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ ok: false, error: 'File too large (10MB max).' }, { status: 400 });

  // Prompt 305 §A — this is the highest-stakes of the four upload paths
  // this prompt found unguarded: an identity-verification document
  // uploaded by an INVESTOR (an external, lower-trust caller by the root
  // privacy rule's own spirit), later opened by a founder/developer via
  // signed URL. The file is still just an in-memory File here (formData,
  // not yet uploaded) — validate BEFORE it ever touches Storage, not
  // after-the-fact like the Vault's browser-direct-upload path had to.
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = detectAllowedKind(bytes, file.name);
  if (!kind) {
    return NextResponse.json({
      ok: false,
      error: 'This file type isn’t allowed (PDF or image only), or its content doesn’t match its extension.',
    }, { status: 400 });
  }
  const verdict = await scanWithVirusTotal(bytes, file.name);
  if (verdict.status === 'flagged') {
    return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
  }
  const scanAvailable = await investorVerificationScanAvailable();

  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const storagePath = `_investor_verification/${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
  if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

  const { error } = await admin.from('investor_verification_documents').insert({
    user_id: user.id, investor_email: email, catalog_entity_id: member.catalog_entity_id,
    storage_path: storagePath, file_name: file.name,
    ...(scanAvailable ? { malware_scan_status: verdict.status, malware_scan_checked_at: new Date().toISOString(), content_sha256: sha256Hex(bytes) } : {}),
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
