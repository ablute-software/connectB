// Prompt 271 §3 — Sherlock evaluates a dropped_by_us frozen entity
// ON DEMAND ("Ask Sherlock" — individual or "evaluate all"), never a cron
// or automatic per-render call. Feeds the SAME reawakening_proposals queue
// as the other two origins (fact-triggered F, rejection-code-triggered
// Bloc B/C) — never a parallel system, per the 251 rule. Reuses the SAME
// approve/reject machinery (approveReawakening/rejectReawakening,
// ReawakeningQueue.tsx) unchanged — confirmed while building this that
// both are already fully origin-agnostic.
//
// Privacy (§3): the AI prompt is built ONLY from this org's own
// interactions with each entity — every query below is org-scoped, no
// cross-org data ever enters it.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { reawakeningNeglectAvailable } from '@/lib/reawakening-neglect-capability';
import { classifyFrozen } from '@/lib/frozen-classifier';
import { buildNeglectEvaluationPrompt, entityToNeglectCase, neglectProposalPayload, type NeglectCase, type NeglectVerdict } from '@/lib/neglect-evaluation';
import { chunk } from '@/lib/reawakening';
import type { Entity, Interaction } from '@/lib/types';

interface RawVerdict { entity_id: string; verdict: 'reactivate' | 'not_worth_it'; rationale: string }

async function callSherlock(apiKey: string, model: string, cases: NeglectCase[], now: Date): Promise<RawVerdict[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 2000,
      system: 'You are evaluating dropped investor-relationship threads for a startup founder\'s CRM — cases where nobody ever passed and no reopen '
        + 'condition was ever set, the conversation just went quiet. You never invent facts about what was said; you only reason from the exact last '
        + 'message given. Default to "reactivate" when the last message shows genuine unanswered interest or an unanswered question — silence from the '
        + 'founder is the more common failure mode than an investor who has truly moved on.',
      messages: [{ role: 'user', content: buildNeglectEvaluationPrompt(cases, now) }],
      tools: [{
        name: 'evaluate_neglect',
        description: 'Return one verdict per case.',
        input_schema: {
          type: 'object',
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entity_id: { type: 'string' },
                  verdict: { type: 'string', enum: ['reactivate', 'not_worth_it'] },
                  rationale: { type: 'string' },
                },
                required: ['entity_id', 'verdict', 'rationale'],
              },
            },
          },
          required: ['verdicts'],
        },
      }],
      tool_choice: { type: 'tool', name: 'evaluate_neglect' },
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const input = data.content?.find((b: { type: string }) => b.type === 'tool_use')?.input as { verdicts?: RawVerdict[] } | undefined;
  return input?.verdicts ?? [];
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, results: [] });

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as { entityIds?: string[] };
  if (!Array.isArray(body.entityIds) || body.entityIds.length === 0) return NextResponse.json({ ok: true, results: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await reawakeningNeglectAvailable())) return NextResponse.json({ ok: true, results: [] });

  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });

  // Re-derive everything server-side rather than trust the client's claim
  // that these entities are dropped_by_us — same non-clobbering/trust-but-
  // verify posture as every other bulk backoffice/AI action in this
  // codebase. Only dormant entities in the caller's OWN org qualify.
  const { data: entitiesRaw } = await admin.from('entities').select('*').eq('org_id', orgId).eq('status', 'dormant').in('id', body.entityIds);
  const entities = (entitiesRaw ?? []) as Entity[];
  if (entities.length === 0) return NextResponse.json({ ok: true, results: [] });

  const [{ data: interactionsRaw }, { data: pendingRaw }] = await Promise.all([
    admin.from('interactions').select('*').eq('org_id', orgId).in('entity_id', entities.map((e) => e.id)),
    admin.from('reawakening_proposals').select('entity_id').eq('org_id', orgId).eq('trigger_kind', 'neglect').eq('status', 'pending').in('entity_id', entities.map((e) => e.id)),
  ]);
  const interactions = (interactionsRaw ?? []) as Interaction[];
  // App-level dedup (§3 — no DB uniqueness for neglect, see migration 0192):
  // never re-ask while a prior ask is still sitting unresolved for this
  // entity. A resolved (approved/rejected/dismissed) one never blocks a
  // fresh ask — the underlying "worth it" state can change over time.
  const alreadyPending = new Set(((pendingRaw ?? []) as { entity_id: string }[]).map((r) => r.entity_id));

  const byEntity = new Map<string, Interaction[]>();
  for (const it of interactions) {
    if (!it.entity_id) continue;
    byEntity.set(it.entity_id, [...(byEntity.get(it.entity_id) ?? []), it]);
  }

  const cases: NeglectCase[] = [];
  for (const e of entities) {
    if (alreadyPending.has(e.id)) continue;
    const its = byEntity.get(e.id) ?? [];
    // Server-side re-classification (§ non-clobbering): only genuinely
    // dropped_by_us entities are ever evaluated, regardless of which
    // button the client called this from.
    if (classifyFrozen(e, its) !== 'dropped_by_us') continue;
    const c = entityToNeglectCase(e, its);
    if (c) cases.push(c);
  }
  if (cases.length === 0) return NextResponse.json({ ok: true, results: [] });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, results: [] });

  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const now = new Date();
  const byCase = new Map(cases.map((c) => [c.entityId, c]));
  const results: { entityId: string; verdict: NeglectVerdict }[] = [];
  const rows: ReturnType<typeof neglectProposalPayload>[] = [];

  for (const group of chunk(cases)) {
    let verdicts: RawVerdict[];
    try {
      verdicts = await callSherlock(apiKey, model, group, now);
    } catch {
      // Fail-open, same as every other AI step in this reawakening family:
      // a flaky call just means these cases weren't evaluated this time —
      // no proposal written, nothing surfaced, the founder can ask again.
      continue;
    }
    for (const v of verdicts) {
      const c = byCase.get(v.entity_id);
      if (!c || !group.some((g) => g.entityId === v.entity_id)) continue;
      const verdict: NeglectVerdict = { verdict: v.verdict, rationale: v.rationale };
      results.push({ entityId: v.entity_id, verdict });
      rows.push(neglectProposalPayload(c, verdict));
    }
  }

  if (rows.length > 0) {
    const now = new Date().toISOString();
    const { error } = await admin.from('reawakening_proposals').insert(rows.map((r) => ({ ...r, org_id: orgId, created_at: now })));
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results });
}
