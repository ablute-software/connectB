// The founder's window onto who has opened their DOCUMENTS (document_views:
// who, when, how long, how many pages). Own org only, resolved from the
// session.
//
// Prompt 886/877 — this used to ALSO surface the Developer Viewer's own
// accesses (admin_audit_log viewer_enter/viewer_exit) as "team access", the
// 603 commitments-3/4 transparency window. Nuno's decision: an authorised
// admin viewing an account is logged internally and is NOT shown to the
// organisation. The enter/exit records are untouched; they are just no longer
// returned here. (Commitments 3/4, which are gated off pending legal review,
// still describe the old behaviour — flagged for that review, not rewritten
// here.)
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

  // Prompt 886/877 — the developer-viewer accesses (admin_audit_log's
  // viewer_enter/viewer_exit) are no longer surfaced to the organisation being
  // viewed. The internal records are untouched — the enter/exit routes still
  // write them; they are simply not returned here any more, so the founder's
  // access log now covers their own DOCUMENT views only. teamAccess stays in
  // the shape as an always-empty array so nothing leaks even to a direct API
  // call and no client needs to change to avoid breaking.
  const [{ data: views }, { data: docs }] = await Promise.all([
    admin.from('document_views').select('id, document_id, viewer_email, viewed_at, seconds, pages').eq('org_id', self.org_id).order('viewed_at', { ascending: false }).limit(300),
    admin.from('documents').select('id, name').eq('org_id', self.org_id),
  ]);
  const nameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));

  return NextResponse.json({
    ok: true, available: true,
    views: (views ?? []).map((v) => ({
      id: v.id, documentName: nameById.get(v.document_id as string) ?? '(document no longer exists)',
      viewerEmail: v.viewer_email, viewedAt: v.viewed_at, seconds: v.seconds, pages: v.pages,
    })),
    teamAccess: [],
  });
}
