// Prompt 876 §C — multi-document attachments for an outreach target: proof
// of publicity (required when a code is given as a prize — evidence the
// program credited "SherlockDeal" as sponsor), contracts, and anything else,
// modelled on support_attachment_scans (0207) but as a proper join table
// (migration 20260910100000) rather than an array + side-ledger, since each
// file needs its own label. Same service-role upload to the existing
// 'data-room' bucket as every other secondary upload path in this app — no
// new bucket needed.
//
// requirePlatformAdmin, not the support-widget route's anonymous-allowed
// gate: this is backoffice-only. Content validation is NOT relaxed for
// that reason though — these files still arrive from an external program/
// VC's inbox, untrusted content regardless of who's uploading them here.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';

export const maxDuration = 30;

const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB, same cap as every other document upload route in this app
const LABELS = ['proof_of_publicity', 'contract', 'other'] as const;
type AttachmentLabel = typeof LABELS[number];

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: attachments, error } = await admin
    .from('promo_outreach_attachments')
    .select('id, label, storage_path, original_filename, malware_scan_status, created_at')
    .eq('target_id', params.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, attachments: attachments ?? [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin, userId } = auth;

  const { data: target } = await admin
    .from('promo_outreach_targets').select('id').eq('id', params.id).is('deleted_at', null).maybeSingle();
  if (!target) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const label = form?.get('label');
  if (typeof label !== 'string' || !LABELS.includes(label as AttachmentLabel)) {
    return NextResponse.json({ ok: false, error: 'Invalid label.' }, { status: 400 });
  }

  const files = form?.getAll('files').filter((f): f is File => f instanceof File) ?? [];
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'At least one file is required.' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ ok: false, error: `At most ${MAX_FILES} files at once.` }, { status: 400 });

  // Validate every file BEFORE any upload happens — same "nothing partially
  // succeeds" shape as the support-attachment route: reject the whole batch
  // on the first bad file rather than uploading some and rejecting others.
  const validated: { file: File; bytes: Buffer; verdict: Awaited<ReturnType<typeof scanWithVirusTotal>> }[] = [];
  for (const f of files) {
    if (f.size > MAX_SIZE) return NextResponse.json({ ok: false, error: `${f.name} is too large (10MB max).` }, { status: 400 });
    const bytes = Buffer.from(await f.arrayBuffer());
    if (!detectAllowedKind(bytes, f.name)) {
      return NextResponse.json({ ok: false, error: `${f.name} isn't an allowed document/image type, or its content doesn't match its extension.` }, { status: 400 });
    }
    const verdict = await scanWithVirusTotal(bytes);
    if (verdict.status === 'flagged') {
      return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
    }
    validated.push({ file: f, bytes, verdict });
  }

  const inserted: Record<string, unknown>[] = [];
  for (const { file, bytes, verdict } of validated) {
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `_promo_outreach_attachments/${params.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
    if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });

    const { data: row, error: insertError } = await admin.from('promo_outreach_attachments').insert({
      target_id: params.id,
      label,
      storage_path: storagePath,
      original_filename: file.name,
      content_sha256: sha256Hex(bytes),
      malware_scan_status: verdict.status,
      malware_scan_checked_at: new Date().toISOString(),
      uploaded_by: userId,
    }).select('id, label, storage_path, original_filename, malware_scan_status, created_at').single();
    if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    inserted.push(row);
  }

  return NextResponse.json({ ok: true, attachments: inserted });
}
