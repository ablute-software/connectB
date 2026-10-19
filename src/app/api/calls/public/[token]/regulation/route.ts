// Prompt 907 (I1) — the regulation PDF of a call, for anyone who has its link: only a PDF of kind "regulation" that the team marked
// "show to applicants". A short-lived signed URL, never the storage path. Everything else about the call stays behind the team.
import { NextResponse } from 'next/server';
import { resolvePublicCall, serviceClient } from '@/lib/calls/applicant/link';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const admin = serviceClient();
  if (!admin) return NextResponse.json({ ok: false }, { status: 404 });
  const found = await resolvePublicCall(admin, params.token);
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  const { data } = await admin.from('call_source_documents').select('storage_path, file_name')
    .eq('call_id', found.call.id).eq('kind', 'regulation').eq('public_to_applicants', true).eq('mime_type', 'application/pdf')
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  const row = data as { storage_path: string; file_name: string } | null;
  if (!row) return NextResponse.json({ ok: false }, { status: 404 });
  const { data: signed } = await admin.storage.from('data-room').createSignedUrl(row.storage_path, 300, { download: false });
  if (!signed?.signedUrl) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, 302);
}
