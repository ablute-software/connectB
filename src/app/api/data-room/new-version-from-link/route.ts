// Prompt 301 §2 — "new version" via a link/Drive URL, not just disk.
// Decision recorded here (the prompt explicitly asks for one, not a silent
// choice): the linked content is FETCHED server-side and stored as a real
// Storage object, going through the EXACT SAME allowlist + malware-scan
// pipeline as a direct file upload (/api/data-room/verify-upload) — never
// kept as a live external reference the way a brand-new "link" document
// can be (documents/page.tsx's existing docUrl path). Reasoning: Prompt
// 301 §3 built a real upload-security gate specifically because "a link
// the founder controls still delivers bytes from an unverified origin" —
// keeping THIS path as an ungated external reference would reopen exactly
// that gap for the one feature built to close it. The cost is real (a
// browser can't fetch cross-origin Drive/Dropbox content directly — this
// has to be a server round-trip, and it fails for any link that needs the
// visitor's own auth session, e.g. a Drive file not shared "anyone with
// the link") — documented as a known limitation, not hidden.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { malwareScanAvailable } from '@/lib/upload-security-capability';
import { sanitizeStorageKey } from '@/lib/data-room';

export const maxDuration = 30;

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — generous for a pitch deck/data room doc, bounded against abuse.

// Google Drive's own share URL ("…/file/d/FILE_ID/view") serves an HTML
// viewer page, not the file — this is the one host-specific rewrite this
// route does, since "new version via Drive" was named explicitly in the
// prompt. Any other host is fetched as given.
function resolveDirectUrl(rawUrl: string): string {
  const drive = /drive\.google\.com\/file\/d\/([^/]+)/.exec(rawUrl);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return rawUrl;
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    return last && /\.[a-z0-9]+$/i.test(last) ? last : fallback;
  } catch { return fallback; }
}

export async function POST(req: NextRequest) {
  const { docId, url: sourceUrl, fileName: fileNameHint } = await req.json().catch(() => ({})) as {
    docId?: string; url?: string; fileName?: string;
  };
  if (!docId || !sourceUrl) return NextResponse.json({ ok: false, error: 'docId and url are required.' }, { status: 400 });

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

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: doc } = await admin.from('documents').select('id').eq('id', docId).eq('org_id', orgId).maybeSingle();
  if (!doc) return NextResponse.json({ ok: false, error: 'Document not found in your organization.' }, { status: 404 });

  let res: Response;
  try {
    res = await fetch(resolveDirectUrl(sourceUrl), { redirect: 'follow' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: `Could not fetch that link: ${(e as Error).message}` }, { status: 400 });
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: `That link returned an error (${res.status}) — is it shared "anyone with the link"?` }, { status: 400 });
  }
  const contentLength = Number(res.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `File is too large (over ${Math.round(MAX_BYTES / 1024 / 1024)}MB) — download it and upload the file directly instead.` }, { status: 400 });
  }
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: `File is too large (over ${Math.round(MAX_BYTES / 1024 / 1024)}MB) — download it and upload the file directly instead.` }, { status: 400 });
  }
  const bytes = Buffer.from(arrayBuffer);
  const fileName = fileNameHint?.trim() || fileNameFromUrl(sourceUrl, 'document');

  const kind = detectAllowedKind(bytes, fileName);
  if (!kind) {
    return NextResponse.json({
      ok: false,
      error: 'That link doesn’t point at an allowed file type (PDF, Office documents, images, CSV/plain text only), or its content doesn’t match its extension — download it and upload the file directly instead.',
    }, { status: 400 });
  }

  const verdict = await scanWithVirusTotal(bytes, fileName);
  if (verdict.status === 'flagged') {
    return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
  }

  const storagePath = `${orgId}/${crypto.randomUUID()}-${sanitizeStorageKey(fileName)}`;
  const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes);
  if (uploadError) return NextResponse.json({ ok: false, error: `Could not store the fetched file: ${uploadError.message}` }, { status: 500 });

  return NextResponse.json({
    ok: true, storagePath, size: bytes.byteLength,
    malwareScanStatus: (await malwareScanAvailable()) ? verdict.status : 'not_scanned',
    provider: verdict.provider, sha256: sha256Hex(bytes),
  });
}
