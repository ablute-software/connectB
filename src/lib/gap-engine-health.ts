// Prompt 576 Fase 2 — extracted from /api/backoffice/gap-engine-health so
// the System status row can cite the SAME invariant check rather than a
// second, looser one. unique(org_id, gap_key) makes a genuine repeat
// impossible to WRITE; this is a live check that the invariant actually
// holds in the data (it always should be 0), not a metric that could
// legitimately be non-zero.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gapQuestionsAvailable } from './document-extraction-capability';

interface QuestionRow { gap_key: string; org_id: string }

export async function repeatedQuestionCount(admin: SupabaseClient): Promise<number | null> {
  if (!(await gapQuestionsAvailable())) return null;
  const { data: questions } = await admin.from('gap_questions').select('gap_key, org_id');
  const seen = new Set<string>();
  let repeated = 0;
  for (const r of (questions ?? []) as QuestionRow[]) {
    const key = `${r.org_id}:${r.gap_key}`;
    if (seen.has(key)) repeated++;
    seen.add(key);
  }
  return repeated;
}
