// Prompt 349 — Chamber 3: the k-anonymous "what investors think" aggregate,
// founder-facing (Readiness & Train). Regenerated at most once/day, checked
// here at read time — never a cron of its own (Hobby-plan constraint,
// CLAUDE.md). The k>=3 gate (canPublishDigest) is enforced BEFORE anything
// about contributor count reaches the response: below the threshold this
// returns { available: false } and nothing else, never a partial count.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { canPublishDigest, computeScoreStats, buildFeedbackDigestPrompt, WATSON_FEEDBACK_DIGEST_SYSTEM } from '@/lib/watson-investor-feedback-digest';
import { logAiCall } from '@/lib/ai-cost-log';

const STALE_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ available: false });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ available: false });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const [{ data: scoreRows }, { data: docNoteRows }] = await Promise.all([
    admin.from('investor_scorecard_scores').select('score, note, criteria_id, investor_scorecard_criteria!inner(investor_member_id, weight)').eq('startup_org_id', orgId),
    admin.from('investor_doc_scores').select('note, investor_member_id').eq('startup_org_id', orgId),
  ]);

  type ScoreRow = { score: number; note: string | null; investor_scorecard_criteria: { investor_member_id: string; weight: number } };
  const rows = (scoreRows ?? []) as unknown as ScoreRow[];
  const byMember = new Map<string, { totalWeighted: number; totalWeight: number }>();
  for (const r of rows) {
    const memberId = r.investor_scorecard_criteria.investor_member_id;
    const weight = r.investor_scorecard_criteria.weight;
    const cur = byMember.get(memberId) ?? { totalWeighted: 0, totalWeight: 0 };
    cur.totalWeighted += r.score * weight;
    cur.totalWeight += weight;
    byMember.set(memberId, cur);
  }
  const contributorIds = new Set<string>([...byMember.keys(), ...((docNoteRows ?? []) as { investor_member_id: string }[]).map((d) => d.investor_member_id)]);
  const contributorCount = contributorIds.size;

  if (!canPublishDigest(contributorCount)) return NextResponse.json({ available: false });

  const { data: existing } = await admin.from('watson_investor_feedback_digests').select('*').eq('org_id', orgId).maybeSingle();
  const isStale = !existing || (Date.now() - new Date(existing.generated_at as string).getTime()) > STALE_MS;

  if (!isStale) {
    return NextResponse.json({
      available: true,
      digest: { contributorCount: existing!.contributor_count, scoreAvg: existing!.score_avg, scoreMin: existing!.score_min, scoreMax: existing!.score_max, themes: existing!.themes, generatedAt: existing!.generated_at },
    });
  }

  const perInvestorAverages = [...byMember.values()].filter((v) => v.totalWeight > 0).map((v) => v.totalWeighted / v.totalWeight);
  const stats = computeScoreStats(perInvestorAverages);

  const notes = [
    ...rows.map((r) => r.note).filter((n): n is string => !!n && n.trim().length > 0),
    ...((docNoteRows ?? []) as { note: string | null }[]).map((d) => d.note).filter((n): n is string => !!n && n.trim().length > 0),
  ];

  let themes: string[] = [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && notes.length > 0) {
    const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
    const tool = {
      name: 'feedback_themes',
      description: 'Extract up to 5 general, non-attributable themes.',
      input_schema: { type: 'object', properties: { themes: { type: 'array', maxItems: 5, items: { type: 'string' } } }, required: ['themes'] },
    };
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 500, system: WATSON_FEEDBACK_DIGEST_SYSTEM,
          messages: [{ role: 'user', content: buildFeedbackDigestPrompt(notes) }],
          tools: [tool], tool_choice: { type: 'tool', name: tool.name },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // fire-and-forget-ok: logAiCall's own contract (ai-cost-log.ts) is fire-and-forget by design — errors are swallowed there, and a dropped cost-log entry never corrupts state, unlike reconciliation.
        void logAiCall({ route: '/api/org/watson-investor-digest', purpose: 'watson_investor_feedback_digest', model, usage: data.usage, orgId });
        const toolUse = (data.content as { type: string; input?: { themes?: unknown } }[]).find((b) => b.type === 'tool_use');
        const raw = toolUse?.input?.themes;
        if (Array.isArray(raw)) themes = raw.filter((t): t is string => typeof t === 'string').slice(0, 5);
      }
    } catch {
      // Best-effort — an AI hiccup should not block the score-stats half of the digest.
    }
  }

  const row = {
    org_id: orgId, contributor_count: contributorCount,
    score_avg: stats?.avg ?? null, score_min: stats?.min ?? null, score_max: stats?.max ?? null,
    themes, generated_at: new Date().toISOString(),
  };
  await admin.from('watson_investor_feedback_digests').upsert(row, { onConflict: 'org_id' });

  return NextResponse.json({
    available: true,
    digest: { contributorCount, scoreAvg: row.score_avg, scoreMin: row.score_min, scoreMax: row.score_max, themes, generatedAt: row.generated_at },
  });
}
