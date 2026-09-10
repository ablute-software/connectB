// Prompt 876 §C — delete a single outreach attachment: removes the Storage
// object first, then the row, so a failed storage delete never leaves an
// orphaned DB row pointing at nothing (the opposite order could leave a
// dangling Storage object with no row — harmless but leaked; this order's
// failure mode is the visible, catchable one).
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';

export async function DELETE(req: Request, { params }: { params: { id: string; attachmentId: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: attachment, error: fetchErr } = await admin
    .from('promo_outreach_attachments').select('id, storage_path')
    .eq('id', params.attachmentId).eq('target_id', params.id).maybeSingle();
  if (fetchErr) return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  if (!attachment) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const { error: storageErr } = await admin.storage.from('data-room').remove([attachment.storage_path as string]);
  if (storageErr) return NextResponse.json({ ok: false, error: storageErr.message }, { status: 500 });

  const { error: deleteErr } = await admin.from('promo_outreach_attachments').delete().eq('id', params.attachmentId);
  if (deleteErr) return NextResponse.json({ ok: false, error: deleteErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
