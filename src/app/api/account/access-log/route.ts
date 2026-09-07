// Prompt 603 commitments 3 and 4 — "you can see every access" and "our team
// does not browse your content… every such access is logged… visible to
// you". Both records already exist (document_views; the Developer Viewer's
// viewer_enter/viewer_exit lines in admin_audit_log); this is the founder's
// window onto them. Own org only, resolved from the session.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { serviceAdmin } from '@/lib/account-security-server';

// Never prerendered: the env early-return precedes the cookie read, and an
// env-less build would otherwise cache this as static (seen in the 603 build
// manifest) — serving an empty log to every founder.
export const dynamic = 'force-dynamic';

export async function GET() {
  const admin = serviceAdmin();
  if (!admin) return NextResponse.json({ ok: true, available: false, views: [], teamAccess: [] });
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: self } = await admin.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!self) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });

  const [{ data: views }, { data: docs }, { data: enters }, { data: exits }] = await Promise.all([
    admin.from('document_views').select('id, document_id, viewer_email, viewed_at, seconds, pages').eq('org_id', self.org_id).order('viewed_at', { ascending: false }).limit(300),
    admin.from('documents').select('id, name').eq('org_id', self.org_id),
    admin.from('admin_audit_log').select('id, created_at, detail').eq('action', 'viewer_enter').eq('subject_id', self.org_id).order('created_at', { ascending: false }).limit(100),
    admin.from('admin_audit_log').select('id, created_at, detail').eq('action', 'viewer_exit').eq('subject_id', self.org_id).order('created_at', { ascending: false }).limit(100),
  ]);
  const nameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  // Pair each entry with the first exit after it (the viewer records one exit
  // per entry; a missing exit means the session is open or was never closed).
  const exitTimes = (exits ?? []).map((e) => ({ at: new Date(e.created_at as string).getTime(), durationMs: (e.detail as { durationMs?: number } | null)?.durationMs ?? null }))
    .sort((a, b) => a.at - b.at);
  const teamAccess = (enters ?? []).map((e) => {
    const at = new Date(e.created_at as string).getTime();
    const exit = exitTimes.find((x) => x.at >= at);
    // Prompt 611 §B — the reason is the half of commitment 4 that was
    // missing: "logged with the reason and the time, WHERE YOU CAN SEE IT
    // TOO". Kept nullable rather than defaulted, so the page can say the
    // entries written before 611 have none instead of inventing one.
    const reason = (e.detail as { reason?: string } | null)?.reason ?? null;
    return { id: e.id, enteredAt: e.created_at, durationMs: exit?.durationMs ?? null, closedBy: (e.detail as { closedBy?: string } | null)?.closedBy ?? null, reason };
  });

  return NextResponse.json({
    ok: true, available: true,
    views: (views ?? []).map((v) => ({
      id: v.id, documentName: nameById.get(v.document_id as string) ?? '(document no longer exists)',
      viewerEmail: v.viewer_email, viewedAt: v.viewed_at, seconds: v.seconds, pages: v.pages,
    })),
    teamAccess,
  });
}
