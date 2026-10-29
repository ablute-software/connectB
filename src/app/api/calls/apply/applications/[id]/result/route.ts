// Prompt 924 (Etapa 4, I2) — the applicant reads the result of THEIR application: the label, the message, the validated grade if the call shares it, and when it was published. Nothing before publishing (null),
// never anything of another startup's application (404, like every applicant route), and never an evaluator's comment or score: what is read here is the text that was built when the results went out.
import { NextResponse } from 'next/server';
import { withActingOrg } from '@/lib/acting-org';
import { authApplication } from '@/lib/calls/applicant/auth';
import { contestInfoFor } from '@/lib/calls/contestations-store';
import type { ResultKey } from '@/lib/calls/results';

export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

export const GET = withActingOrg(async function GET(req: Request, { params }: { params: { id: string } }) {
  const a = await authApplication(req, params.id);
  if (a.error) return a.error;
  const { data } = await a.admin.from('call_results').select('id, label, subject, body_html, grade, result, published_at, phase_id, moved_to_phase_id').eq('application_id', a.app.id).eq('is_current', true);
  const rows = ((data ?? []) as Row[]).sort((x, y) => String(y.published_at).localeCompare(String(x.published_at)));
  const r = rows[0];
  if (!r) return NextResponse.json({ ok: true, result: null });
  return NextResponse.json({
    ok: true,
    result: { label: String(r.label), subject: String(r.subject), html: String(r.body_html), grade: r.grade === null || r.grade === undefined ? null : Number(r.grade), kind: r.result as string, publishedAt: String(r.published_at), movedOn: !!r.moved_to_phase_id },
    // What the applicant may do about it: contest (only a "Not selected", only while the call lets them), or read what became of their contestation.
    contest: await contestInfoFor(a.admin, a.call, a.app.id, { id: String(r.id), kind: r.result as ResultKey, publishedAt: String(r.published_at), phaseId: (r.phase_id as string | null) ?? null }),
  });
});
