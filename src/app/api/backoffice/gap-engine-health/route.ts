// Prompt 358 Phase 3.3 — "é como saberemos que a vulnerabilidade está
// fechada, com números." Real counts from the two ledgers Phase 2 built
// (gap_reconciliations, gap_questions), not a proxy metric.
//
// Honest scoping, stated rather than papered over: "mid-session
// abandonment" (a founder opens the interrogation, answers some, leaves
// without finishing) has no signal to compute from yet — there is no
// "question SHOWN to the founder" event, only "question ANSWERED"
// (gap_questions is written at answer time, see /api/blueprint/answer's own
// recordGapQuestion). Reporting a fabricated number here would be worse than
// admitting the gap; this returns null for it rather than a wrong zero.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { gapReconciliationsAvailable, gapQuestionsAvailable } from '@/lib/document-extraction-capability';

interface ReconciliationRow { status: string }
interface QuestionRow { gap_key: string; org_id: string; disposition: string | null }

export async function GET() {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const [reconciliationsAvailable, questionsAvailable] = await Promise.all([
    gapReconciliationsAvailable(), gapQuestionsAvailable(),
  ]);
  if (!reconciliationsAvailable && !questionsAvailable) {
    return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });
  }

  const [{ data: reconciliations }, { data: questions }] = await Promise.all([
    reconciliationsAvailable ? admin.from('gap_reconciliations').select('status') : Promise.resolve({ data: [] as ReconciliationRow[] }),
    questionsAvailable ? admin.from('gap_questions').select('gap_key, org_id, disposition') : Promise.resolve({ data: [] as QuestionRow[] }),
  ]);

  const byStatus = new Map<string, number>();
  for (const r of (reconciliations ?? []) as ReconciliationRow[]) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const autoLinked = byStatus.get('auto_linked') ?? 0;
  const suggested = byStatus.get('suggested') ?? 0;
  const uncovered = byStatus.get('uncovered') ?? 0;
  const dismissed = byStatus.get('dismissed') ?? 0;

  const rows = (questions ?? []) as QuestionRow[];
  // Prompt 358 Phase 2.2 — unique(org_id, gap_key) makes a genuine repeat
  // impossible to WRITE; this count is a live check that the invariant
  // actually holds in the data (it always should be 0), not a metric that
  // could legitimately be non-zero.
  const seen = new Set<string>();
  let repeatedQuestionCount = 0;
  for (const r of rows) {
    const key = `${r.org_id}:${r.gap_key}`;
    if (seen.has(key)) repeatedQuestionCount++;
    seen.add(key);
  }
  const resolvedByQuestion = rows.length;

  return NextResponse.json({
    ok: true,
    resolvedByReconciliation: autoLinked,
    resolvedByQuestion,
    reconciliationSuggestedPending: suggested,
    reconciliationUncovered: uncovered,
    reconciliationDismissed: dismissed,
    repeatedQuestionCount,
    midSessionAbandonment: null,
  });
}
