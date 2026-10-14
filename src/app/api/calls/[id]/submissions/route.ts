// Prompt 907 (I4) — the entity's minimal view of the applicant side (spec §14.4, §20): the SUBMITTED applications of a call — startup, reference,
// time of submission — read-only. THE ENTITY NEVER SEES DRAFTS: only applications with a submitted version are read here, and no draft answer,
// no draft count and no name of a startup that is still filling in is ever returned. Whoever may "View all applications" (the call's team).
import { NextResponse } from 'next/server';
import { authCall } from '@/lib/calls/access';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { need: 'view_applications' });
  if (auth.error) return auth.error;
  const { data } = await auth.admin.from('call_applications').select('id, startup_org_id, reference, submitted_at')
    .eq('call_id', auth.call.id).eq('status', 'submitted').order('submitted_at', { ascending: false });
  const rows = (data ?? []) as Row[];
  const orgIds = [...new Set(rows.map((r) => r.startup_org_id as string | null).filter((x): x is string => !!x))];
  const { data: orgs } = orgIds.length ? await auth.admin.from('orgs').select('id, name').in('id', orgIds) : { data: [] };
  const names = new Map(((orgs ?? []) as Row[]).map((o) => [o.id as string, o.name as string]));
  return NextResponse.json({
    ok: true,
    submissions: rows.map((r) => ({ applicationId: r.id as string, reference: (r.reference as string | null) ?? null, startup: names.get(r.startup_org_id as string) ?? 'A startup', submittedAt: r.submitted_at as string })),
  });
}
