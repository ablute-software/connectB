// Prompt 301 §3 — Vault upload security, the server-side gate that did not
// exist before this. Upload itself stays a direct browser→Storage call
// (unchanged, and the only practical option — routing large deck files
// through a Vercel Hobby serverless function's request body would risk
// hitting its size limit); this route is called RIGHT AFTER that upload
// succeeds, BEFORE the document row is created, so nothing becomes a real
// Vault entry — let alone something a grant could ever point at — without
// passing both checks. On rejection the Storage object is deleted
// immediately; the caller must not call addDocument/addDocumentVersion.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { malwareScanAvailable } from '@/lib/upload-security-capability';

// Downloading + hashing + a VirusTotal round-trip can run longer than the
// default — within Hobby-plan's own allowed range, not a paid-tier feature.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const { storagePath, fileName } = await req.json().catch(() => ({})) as { storagePath?: string; fileName?: string };
  if (!storagePath || !fileName) return NextResponse.json({ ok: false, error: 'storagePath and fileName are required.' }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).limit(1).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not an org member.' }, { status: 403 });
  const orgId = member.org_id as string;

  // Defense in depth: the path must actually be this org's own prefix — a
  // client can only ever have uploaded there in the first place (Storage
  // policies are scoped the same way), but never trust a client-supplied
  // path without checking it matches the server-resolved org.
  if (!storagePath.startsWith(`${orgId}/`)) {
    return NextResponse.json({ ok: false, error: 'Path does not belong to your organization.' }, { status: 403 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (!(await malwareScanAvailable())) {
    // Migration not applied yet — degrade to "allowed, unscanned" rather
    // than block every upload; the honest status is recorded once the
    // column exists, never faked as 'clean' meanwhile.
    return NextResponse.json({ ok: true, malwareScanStatus: 'not_scanned', provider: null, sha256: null });
  }

  const { data: fileBlob, error: downloadError } = await admin.storage.from('data-room').download(storagePath);
  if (downloadError || !fileBlob) {
    return NextResponse.json({ ok: false, error: 'Could not read the uploaded file for verification.' }, { status: 500 });
  }
  const bytes = Buffer.from(await fileBlob.arrayBuffer());

  const kind = detectAllowedKind(bytes, fileName);
  if (!kind) {
    await admin.storage.from('data-room').remove([storagePath]);
    return NextResponse.json({
      ok: false,
      error: 'This file type isn’t allowed in the Vault (PDF, Office documents, images, CSV/plain text only) — or its content doesn’t match its extension.',
    }, { status: 400 });
  }

  const verdict = await scanWithVirusTotal(bytes, fileName);
  if (verdict.status === 'flagged') {
    await admin.storage.from('data-room').remove([storagePath]);
    return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
  }

  return NextResponse.json({
    ok: true, malwareScanStatus: verdict.status, provider: verdict.provider, sha256: sha256Hex(bytes), detail: verdict.detail,
  });
}
