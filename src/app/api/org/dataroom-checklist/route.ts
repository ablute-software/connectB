// Investor Workspace Fase 2 (prompt 55) — "your data room through the
// investor's eyes": per-section fill status + last-activity telemetry, for
// the founder's own Company tab. Reads document_views directly — no
// filtering for @ablute.pt needed here, because QA portal sessions never
// write a document_views row in the first place (see /api/portal/view's
// own comment), so there is nothing to exclude.
import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase-server';
import { PORTAL_SECTIONS } from '@/lib/dataroom-sections';

export async function GET() {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  const { data: folders } = await sb.from('folders').select('id, portal_section').eq('org_id', orgId);
  const sectionByFolderId = new Map((folders ?? []).map((f) => [f.id as string, f.portal_section as string | null]));

  const { data: docs } = await sb.from('documents').select('id, folder_id').eq('org_id', orgId);
  const docCountBySection = new Map<string, number>();
  for (const d of docs ?? []) {
    const section = sectionByFolderId.get(d.folder_id as string);
    if (section) docCountBySection.set(section, (docCountBySection.get(section) ?? 0) + 1);
  }

  const { data: views } = await sb.from('document_views')
    .select('document_id, viewed_at, seconds')
    .eq('org_id', orgId)
    .order('viewed_at', { ascending: false })
    .limit(200);
  const docToFolder = new Map((docs ?? []).map((d) => [d.id as string, d.folder_id as string | null]));

  const sections = PORTAL_SECTIONS.map((s) => {
    const sectionViews = (views ?? []).filter((v) => {
      const folderId = docToFolder.get(v.document_id as string);
      return folderId && sectionByFolderId.get(folderId) === s.key;
    });
    const totalSeconds = sectionViews.reduce((sum, v) => sum + ((v.seconds as number | null) ?? 0), 0);
    return {
      key: s.key, label: s.label, documentCount: docCountBySection.get(s.key) ?? 0,
      viewCount: sectionViews.length,
      lastViewedAt: sectionViews[0]?.viewed_at ?? null,
      totalMinutes: totalSeconds > 0 ? Math.round(totalSeconds / 60) : null,
    };
  });

  // Most recent activity across all sections, for the one-line summary.
  const lastActive = sections.filter((s) => s.lastViewedAt).sort((a, b) =>
    new Date(b.lastViewedAt as string).getTime() - new Date(a.lastViewedAt as string).getTime())[0] ?? null;

  return NextResponse.json({ sections, lastActive });
}
