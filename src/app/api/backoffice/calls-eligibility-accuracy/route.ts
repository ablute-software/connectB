// Prompt 918 (I3) — back office: how the internal eligibility engine is doing, from what people corrected (spec §7.6). By kind of rule and by kind of document: how many verdicts the engine gave, how many a person
// overruled (an exception of one call is NOT counted as an engine error), and the hit rate; plus the queue (how many tasks are waiting, running, done, and in technical failure) and the cost: none
// (the engine uses no external AI). Platform admin only; read only; it only reads counts and kinds — never an applicant's content.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { accuracy } from '@/lib/calls/eligibility-review';

export const dynamic = 'force-dynamic';
type Row = Record<string, unknown>;

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;
  try {
    const [ev, co, tk] = await Promise.all([
      admin.from('call_application_eligibility').select('rule_results, source').eq('source', 'engine').order('created_at', { ascending: false }).limit(5000),
      admin.from('call_eligibility_corrections').select('rule_kind, doc_type, engine_outcome, human_outcome, is_call_exception').order('created_at', { ascending: false }).limit(5000),
      admin.from('call_processing_tasks').select('status').limit(20000),
    ]);
    if (ev.error || co.error || tk.error) return NextResponse.json({ ok: true, available: false });
    const results = ((ev.data ?? []) as Row[]).flatMap((r) => ((Array.isArray(r.rule_results) ? r.rule_results : []) as Row[]).map((x) => ({ ruleKind: String(x.kind), docType: (x.docType as string | null | undefined) ?? null, outcome: x.outcome as 'pass' | 'fail' | 'validate' })));
    const corrections = ((co.data ?? []) as Row[]).map((r) => ({ ruleKind: (r.rule_kind as string | null) ?? null, docType: (r.doc_type as string | null) ?? null, engineOutcome: (r.engine_outcome as string | null) ?? null, humanOutcome: String(r.human_outcome), callException: r.is_call_exception === true }));
    const queue: Record<string, number> = { queued: 0, processing: 0, done: 0, technical_failure: 0 };
    for (const t of (tk.data ?? []) as Row[]) { const s = String(t.status); if (s in queue) queue[s]++; }
    return NextResponse.json({
      ok: true, available: true, ...accuracy(results, corrections), corrections: { total: corrections.length, callExceptions: corrections.filter((c) => c.callException).length, applicationLevel: corrections.filter((c) => !c.ruleKind).length }, queue,
    });
  } catch { return NextResponse.json({ ok: true, available: false }); }
}
