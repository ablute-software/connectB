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
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
  for (const f of files) {
    if (f.size > MAX_SIZE) return NextResponse.json({ ok: false, error: `${f.name} is too large (10MB max).` }, { status: 400 });
    if (!f.type.startsWith('image/')) return NextResponse.json({ ok: false, error: `${f.name} isn't an image.` }, { status: 400 });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: ticket } = await admin.from('support_tickets').select('id, attachment_urls').eq('id', ticketId).maybeSingle();
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const newPaths: string[] = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const storagePath = `_support_attachments/${ticketId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await admin.storage.from('data-room').upload(storagePath, file);
    if (uploadError) return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
    newPaths.push(storagePath);
  }

  const merged = [...(ticket.attachment_urls as string[] ?? []), ...newPaths];
  const { error: updateError } = await admin.from('support_tickets').update({ attachment_urls: merged }).eq('id', ticketId);
  if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: newPaths.length });
}
