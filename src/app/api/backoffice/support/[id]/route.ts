// Contact & Support — single ticket + its event timeline. Platform admin only.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { supportAttachmentScanAvailable } from '@/lib/upload-security-capability';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const { data: ticket, error } = await admin.from('support_tickets').select('*').eq('id', params.id).maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!ticket) return NextResponse.json({ ok: false, error: 'Ticket not found.' }, { status: 404 });

  const { data: events, error: evErr } = await admin.from('support_ticket_events')
    .select('*').eq('ticket_id', params.id).order('created_at', { ascending: true });
  if (evErr) return NextResponse.json({ ok: false, error: evErr.message }, { status: 500 });

  // attachment_urls stores storage PATHS, not public URLs — the 'data-room'
  // bucket is private, same as every other document in it. Sign each path
  // here (service role bypasses the org-membership RLS that a normal
  // client-side signed-URL request would need).
  //
  // Prompt 305 §A — same defense-in-depth as investor-identity's own gate:
  // a support attachment the daily scan sweep later flagged never gets a
  // signed URL, even to a platform admin — this is the one path in the app
  // where the uploader might not even have an account, so treating it as
  // the lowest-trust source matters more here, not less.
  const attachmentPaths = (ticket.attachment_urls as string[] | null) ?? [];
  const scanTrackingAvailable = await supportAttachmentScanAvailable();
  const flaggedPaths = new Set<string>();
  if (scanTrackingAvailable && attachmentPaths.length) {
    const { data: scans } = await admin.from('support_attachment_scans')
      .select('storage_path').in('storage_path', attachmentPaths).eq('malware_scan_status', 'flagged');
    for (const s of scans ?? []) flaggedPaths.add(s.storage_path as string);
  }
  const attachments = attachmentPaths.length
    ? await Promise.all(attachmentPaths.map(async (path) => {
      if (flaggedPaths.has(path)) return { path, url: null, malwareFlagged: true };
      const { data: signed } = await admin.storage.from('data-room').createSignedUrl(path, 300);
      return { path, url: signed?.signedUrl ?? null };
    }))
    : [];

  return NextResponse.json({ ok: true, ticket, events: events ?? [], attachments });
}
