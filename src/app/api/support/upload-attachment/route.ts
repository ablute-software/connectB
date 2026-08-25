// Prompt 106 §4 — image attachments for the Report-a-problem widget. A
// separate route from /api/support/submit because that one is JSON and
// this needs multipart/form-data; the two share the same table and the
// same storage bucket, per the "one data path" instruction. Reuses the
// exact upload pattern already used in
// investor-profile/upload-document/route.ts: service-role upload to the
// 'data-room' bucket (no new bucket/policy needed), because an anonymous
// or investor caller can't satisfy that bucket's org-membership RLS
// directly.
//
// Deliberately does NOT trust a client-supplied name/email — it only
// needs a ticketId that was just handed back by a real /api/support/submit
// success, and confirms that ticket actually exists before writing
// anything against it.
//
// Prompt 305 §A — this route deliberately does NOT require an authenticated
// session, decided (not just inherited) rather than silently kept: the
// Report-a-problem widget it serves must work for a visitor hitting a bug
// on a public, unauthenticated page (e.g. /login, a broken /guest/[token]
// preview) — requiring an account here would break exactly the case the
// widget exists for. That is also why content validation matters MORE
// here than anywhere else in this file's four siblings: "no account" is
// the lowest-trust caller class in the whole app, not a reason to skip the
// check. Every file is now validated by its REAL content (magic bytes),
// never the client-supplied file.type alone (as spoofable as a filename
// extension — the exact class of check upload-security.ts's own header
// already warns about), and scanned for malware before ever reaching
// Storage.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { detectAllowedKind, scanWithVirusTotal, sha256Hex } from '@/lib/upload-security';
import { supportAttachmentScanAvailable } from '@/lib/upload-security-capability';

export const maxDuration = 30;

const MAX_FILES = 3;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB, same cap as investor document upload

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const form = await req.formData().catch(() => null);
  const ticketId = form?.get('ticketId');
  if (!ticketId || typeof ticketId !== 'string') return NextResponse.json({ ok: false, error: 'ticketId is required.' }, { status: 400 });

  const files = form?.getAll('files').filter((f): f is File => f instanceof File) ?? [];
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'At least one file is required.' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ ok: false, error: `At most ${MAX_FILES} files.` }, { status: 400 });

  // Validate every file BEFORE any upload happens — reject the whole batch
  // on the first bad file, same "nothing partially succeeds" shape the
  // pre-existing size/type loop already had.
  const validated: { file: File; bytes: Buffer; verdict: Awaited<ReturnType<typeof scanWithVirusTotal>> }[] = [];
  for (const f of files) {
    if (f.size > MAX_SIZE) return NextResponse.json({ ok: false, error: `${f.name} is too large (10MB max).` }, { status: 400 });
    const bytes = Buffer.from(await f.arrayBuffer());
    if (!detectAllowedKind(bytes, f.name)) {
      return NextResponse.json({ ok: false, error: `${f.name} isn't an allowed image type, or its content doesn't match its extension.` }, { status: 400 });
    }
    const verdict = await scanWithVirusTotal(bytes);
    if (verdict.status === 'flagged') {
      return NextResponse.json({ ok: false, error: `Upload blocked — ${verdict.detail}` }, { status: 400 });
    }
    validated.push({ file: f, bytes, verdict });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ticket } = await admin.from('support_tickets').select('id, attachment_urls').eq('id', ticketId).maybeSingle();
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const scanTrackingAvailable = await supportAttachmentScanAvailable();
  const newPaths: string[] = [];
  for (const { file, bytes, verdict } of validated) {
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `_support_attachments/${ticketId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, bytes, { contentType: file.type || undefined });
    if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
    newPaths.push(storagePath);
    if (scanTrackingAvailable) {
      await admin.from('support_attachment_scans').insert({
        ticket_id: ticketId, storage_path: storagePath,
        malware_scan_status: verdict.status, malware_scan_checked_at: new Date().toISOString(), content_sha256: sha256Hex(bytes),
      });
    }
  }

  const merged = [...(ticket.attachment_urls as string[] ?? []), ...newPaths];
  const { error: updateError } = await admin.from('support_tickets').update({ attachment_urls: merged }).eq('id', ticketId);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: newPaths.length });
}
