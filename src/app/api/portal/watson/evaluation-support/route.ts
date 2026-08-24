// Prompt 349 — Chamber 1: "Get Watson support", on-demand only (never
// automatic). The prompt this route builds is a data flow — audited like a
// select: buildEvaluationSupportPrompt (watson-evaluation-support.ts) is
// the ONE place the model's input is assembled, and it only ever accepts
// this investor's own scorecard/doc-scores/watch state plus the same
// minimal, already-visible summary fields the compact Pipeline card shows.
// Nothing founder-private-derived (pass counts, outreach velocity, pipeline
// stats — none of which exist on this investor's own tables anyway) ever
// has a path into this prompt. Output is ephemeral — returned directly,
// never persisted — Chamber 2's own route is the only place an insight
// becomes durable, and only on the investor's own explicit say-so.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { pipelineEligibleOrgIds } from '@/lib/investor-pipeline';
import { findWatch, getSnapshotData } from '@/lib/investor-watching-db';
import { readSnapshotData } from '@/lib/startup-snapshot';
import { computeSnapshotDelta } from '@/lib/investor-watching';
import { resolveActiveInvestorMember } from '@/lib/investor-membership';
import {
  buildEvaluationSupportPrompt, parseWatsonInsights, WATSON_EVALUATION_SUPPORT_SYSTEM, type EvaluationSupportInput,
} from '@/lib/watson-evaluation-support';
import { logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { assertNotViewer } from '@/lib/developer-viewer';

export const maxDuration = 30;

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey || !apiKey) return NextResponse.json({ ok: false, error: 'Not available yet.' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { orgId?: string };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  const orgId = body.orgId;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);
  if (!investorCatalogEntityId) return NextResponse.json({ ok: false, error: 'No linked investor organization.' }, { status: 403 });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const orgIds = await pipelineEligibleOrgIds(admin, user.id, email, person?.id ?? null);
  if (!orgIds.includes(orgId)) return NextResponse.json({ ok: false, error: 'This startup is not in your Pipeline.' }, { status: 403 });

  const member = await resolveActiveInvestorMember(admin, user.id);

  const [{ data: org }, current] = await Promise.all([
    admin.from('orgs').select('name, one_liner, stage, sectors, round_target_eur').eq('id', orgId).single(),
    readSnapshotData(admin, orgId),
  ]);

  const input: EvaluationSupportInput = {
    orgName: (org?.name as string | undefined) ?? 'This startup',
    visibleSummary: {
      oneLiner: (org?.one_liner as string | null) ?? null, stage: (org?.stage as string | null) ?? null,
      sectors: (org?.sectors as string[] | null) ?? [], roundTargetEur: (org?.round_target_eur as number | null) ?? null,
    },
    scorecard: [], docScores: [],
  };

  if (member) {
    const { data: criteria } = await admin.from('investor_scorecard_criteria').select('id, label, weight').eq('investor_member_id', member.id);
    if (criteria && criteria.length > 0) {
      const { data: scores } = await admin.from('investor_scorecard_scores').select('criteria_id, score, note')
        .eq('startup_org_id', orgId).in('criteria_id', criteria.map((c) => c.id));
      const scoreByCriteria = new Map((scores ?? []).map((s) => [s.criteria_id as string, s as { score: number; note: string | null }]));
      input.scorecard = criteria.map((c) => ({
        label: c.label as string, weight: c.weight as number,
        score: scoreByCriteria.get(c.id as string)?.score ?? null, note: scoreByCriteria.get(c.id as string)?.note ?? null,
      }));
    }
    const { data: docScoreRows } = await admin.from('investor_doc_scores').select('document_id, score, note')
      .eq('investor_member_id', member.id).eq('startup_org_id', orgId);
    if (docScoreRows && docScoreRows.length > 0) {
      const { data: docs } = await admin.from('documents').select('id, name').in('id', docScoreRows.map((r) => r.document_id));
      const nameById = new Map((docs ?? []).map((d) => [d.id as string, d.name as string]));
      input.docScores = docScoreRows.map((r) => ({
        documentName: nameById.get(r.document_id as string) ?? 'Document', score: r.score as number, note: r.note as string | null,
      }));
    }
  }

  const watch = await findWatch(admin, orgId, investorCatalogEntityId);
  if (watch && watch.status === 'active') {
    const baseline = watch.baseline_snapshot_id ? await getSnapshotData(admin, watch.baseline_snapshot_id) : null;
    const changedFields = baseline ? computeSnapshotDelta(baseline, current) : [];
    const since = watch.last_seen_at ?? watch.requested_at;
    const { data: newClaims } = await admin.from('company_claims').select('statement, evidence_class')
      .eq('org_id', orgId).eq('status', 'accepted').in('evidence_class', [1, 2]).gt('updated_at', since);
    input.watching = {
      changedFieldLabels: changedFields.map((f) => f.label),
      newClass1Statements: (newClaims ?? []).filter((c) => c.evidence_class === 1).map((c) => c.statement),
      newClass2Statements: (newClaims ?? []).filter((c) => c.evidence_class === 2).map((c) => c.statement),
    };
  }

  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const tool = {
    name: 'evaluation_insights',
    description: 'Return up to 3 short insights about the investor\'s own evaluation.',
    input_schema: {
      type: 'object',
      properties: {
        insights: {
          type: 'array', maxItems: 3,
          items: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['reading', 'threshold_suggestion', 'alert_reason'] }, text: { type: 'string' } },
            required: ['kind', 'text'],
          },
        },
      },
      required: ['insights'],
    },
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 600, system: WATSON_EVALUATION_SUPPORT_SYSTEM,
        messages: [{ role: 'user', content: buildEvaluationSupportPrompt(input) }],
        tools: [tool], tool_choice: { type: 'tool', name: tool.name },
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: providerErrorMessage('[watson-evaluation-support]', await res.text()) }, { status: 502 });
    const data = await res.json();
    void logAiCall({ route: '/api/portal/watson/evaluation-support', purpose: 'watson_evaluation_support', model, usage: data.usage, orgId });
    const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
    const insights = parseWatsonInsights(toolUse?.input);
    return NextResponse.json({ ok: true, insights });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
