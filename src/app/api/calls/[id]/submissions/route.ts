// Prompt 907 (I4) — the entity's minimal view of the applicant side (spec §14.4, §20): the SUBMITTED applications of a call — startup, reference,
// time of submission — read-only. THE ENTITY NEVER SEES DRAFTS: only applications with a submitted version are read here, and no draft answer,
// no draft count and no name of a startup that is still filling in is ever returned. Whoever may "View all applications" (the call's team).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { countViews, loadEligibilityRows } from '@/lib/calls/eligibility-lists';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const { data } = await auth.admin.from('call_applications').select('id, startup_org_id, reference, submitted_at, current_submission_id')
    .eq('call_id', auth.call.id).eq('status', 'submitted').order('submitted_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
  const { data: orgs } = orgIds.length ? await auth.admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] };
  const names = new Map(((orgs ?? []) as Row[]).map((o) => [o.id as string, o.name as string]));
  // Prompt 918 (I3): the eligibility of each submitted application (Fit / Not a fit / To validate, or still being checked) and its possible duplicates — only of THIS call.
  const elig = await loadEligibilityRows(auth.admin, auth.call, rows);
  const byApp = new Map(elig.map((e) => [e.applicationId, e]));
  return NextResponse.json({
    ok: true,
    submissions: rows.map((r) => {
      const e = byApp.get(r.id as string)!;
      return {
        applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startup: names.get(r.startup_org_id as string) ?? 'A startup', submittedAt: r.submitted_at as string,
        eligibility: { state: e.info.state, view: e.view, reason: e.info.reason, source: e.info.source }, duplicates: e.duplicates.length,
      };
    }),
    counts: countViews(elig), canCorrect: auth.perms.correct_eligibility,
  });
}
