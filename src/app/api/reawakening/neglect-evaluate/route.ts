// Prompt 271 §3 / Prompt 272 / Prompt 273 — Sherlock evaluates a stand_by
// frozen entity ON DEMAND ("Ask Sherlock" — individual or "evaluate all"), never
// a cron or automatic per-render call. Feeds the SAME reawakening_proposals
// queue as the other two origins (fact-triggered F, rejection-code-
// triggered Bloc B/C) — never a parallel system, per the 251 rule. Reuses
// the SAME approve/reject machinery (approveReawakening/rejectReawakening,
// ReawakeningQueue.tsx) unchanged — confirmed while building this that
// both are already fully origin-agnostic.
//
// Prompt 272 — upgraded from a single rationale paragraph to the 5
// elements of real adviser-quality advice (acknowledge, respond to what's
// pending, the new hook or an honest "not yet", channel+person+timing).
// person is resolved HERE (nextContactPerson's own rule — seniority,
// never do_not_contact — reimplemented against the service-role query
// this route already has, since relationship.ts's version takes a full
// client-shaped Db), never left to the model to invent.
//
// Privacy (§3): the AI prompt is built ONLY from this org's own
// interactions/company_facts with each entity — every query below is
// org-scoped, no cross-org data ever enters it.
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { reawakeningNeglectAvailable } from '@/lib/reawakening-neglect-capability';
import { reawakeningAdviceAvailable } from '@/lib/reawakening-advice-capability';
import { classifyFrozen } from '@/lib/frozen-classifier';
import {
  buildNeglectEvaluationPrompt, entityToNeglectCase, neglectProposalPayload,
  type NeglectCase, type NeglectOutcome, type NeglectVerdict,
} from '@/lib/neglect-evaluation';
import { neglectAskState, type NeglectProposalRecord } from '@/lib/neglect-history';
import { chunk } from '@/lib/reawakening';
import { DOCUMENT_CONTENT_INSTRUCTION } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { logAiCall } from '@/lib/ai-cost-log';
import type { Entity, Interaction, Person } from '@/lib/types';

interface RawVerdict {
  entity_id: string; outcome: NeglectOutcome; rationale: string;
  acknowledge?: string; respond_to?: { question: string; answer: string }[];
  new_hook?: string; hold_reason?: string; channel?: string; timing?: string;
}

async function callSherlock(
  apiKey: string, model: string, cases: NeglectCase[], now: Date,
  companyFacts: { id: string; statement: string; category: string }[], orgId: string,
): Promise<RawVerdict[]> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 3000,
      system: 'You are a startup fundraising adviser, evaluating investor threads that went cold for a founder\'s CRM — cases where nobody ever passed '
        + 'and no reopen condition was ever set, the conversation just went quiet. You never invent facts about what was said or about the company; you '
        + 'only reason from the exact last message given and the confirmed company facts provided. Real advice always acknowledges the gap honestly, '
        + 'answers what is actually pending, and only proposes reopening now when there is a genuine new reason to — otherwise it says so plainly. '
        + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: buildNeglectEvaluationPrompt(cases, now, companyFacts) }],
      tools: [{
        name: 'evaluate_neglect',
        description: 'Return one adviser verdict per case.',
        input_schema: {
          type: 'object',
          properties: {
            verdicts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  entity_id: { type: 'string' },
                  outcome: { type: 'string', enum: ['reactivate', 'hold_for_hook', 'not_worth_it'] },
                  rationale: { type: 'string', description: 'One-line summary, always present.' },
                  acknowledge: { type: 'string', description: 'One honest line naming the gap. Only for reactivate/hold_for_hook.' },
                  respond_to: {
                    type: 'array',
                    description: 'One entry per real pending question/point from their last message. Only for reactivate/hold_for_hook.',
                    items: {
                      type: 'object',
                      properties: { question: { type: 'string' }, answer: { type: 'string' } },
                      required: ['question', 'answer'],
                    },
                  },
                  new_hook: { type: 'string', description: 'The genuine new reason to reopen, citing a confirmed company fact. Only for reactivate.' },
                  hold_reason: { type: 'string', description: 'What would have to happen first. Only for hold_for_hook.' },
                  channel: { type: 'string', description: 'Suggested channel. Only for reactivate.' },
                  timing: { type: 'string', description: 'Suggested timing. Only for reactivate.' },
                },
                required: ['entity_id', 'outcome', 'rationale'],
              },
            },
          },
          required: ['verdicts'],
        },
      }],
      tool_choice: { type: 'tool', name: 'evaluate_neglect' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[reawakening/neglect-evaluate]', await res.text()));
  const data = await res.json();
  // Prompt 469 §B — awaited: ai_call_log is used as an ACCEPTANCE
  // CRITERION (a missing entry has, more than once, been read as proof a
  // pipeline never ran), so losing an entry to a frozen serverless
  // instance invalidates a proof, not just a cost number. logAiCall
  // already swallows its own errors (ai-cost-log.ts) — awaiting it can
  // never fail this route, only add a Supabase insert's tens of
  // milliseconds against a model call that just took seconds. Do not
  // "optimize" this back to void.
  await logAiCall({ route: '/api/reawakening/neglect-evaluate', purpose: 'neglect_evaluate', model, usage: data.usage, orgId });
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

  // Prompt 513 §2 — `force` is the founder's explicit per-row "Ask
  // Sherlock again". It is a REQUEST for the override, never the grant:
  // the decision is re-derived below from the stored history, and a
  // proposal still sitting `pending` in the queue is never overridable.
  const body = await req.json().catch(() => ({})) as { entityIds?: string[]; force?: boolean };
  const force = body.force === true;
  if (!Array.isArray(body.entityIds) || body.entityIds.length === 0) return NextResponse.json({ ok: true, results: [] });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  if (!(await reawakeningNeglectAvailable())) return NextResponse.json({ ok: true, results: [] });
  const withAdvice = await reawakeningAdviceAvailable();

  const admin: SupabaseClient = createClient(url, service, { auth: { persistSession: false } });

  // Re-derive everything server-side rather than trust the client's claim
  // that these entities are stand_by — same non-clobbering/trust-but-
  // verify posture as every other bulk backoffice/AI action in this
  // codebase. Only dormant entities in the caller's OWN org qualify.
  const { data: entitiesRaw } = await admin.from('entities').select('*').eq('org_id', orgId).eq('status', 'dormant').in('id', body.entityIds);
  const entities = (entitiesRaw ?? []) as Entity[];
  if (entities.length === 0) return NextResponse.json({ ok: true, results: [] });

  const [{ data: interactionsRaw }, { data: priorRaw }, { data: peopleRaw }, { data: factsRaw }] = await Promise.all([
    admin.from('interactions').select('*').eq('org_id', orgId).in('entity_id', entities.map((e) => e.id)),
    // Prompt 513 §2 — every prior neglect verdict, not just the pending
    // ones. A dismissed verdict IS an answer; treating it as "never asked"
    // is what let the same entities be re-evaluated (and re-billed) on
    // every visit to the page.
    admin.from('reawakening_proposals')
      // Two literal column lists rather than one template string: the
      // supabase-js select parser is type-level and can't read an
      // interpolated one. `advice` is omitted entirely where migration
      // 0193 isn't applied — same "never name an unknown column"
      // discipline the insert below already follows.
      .select(withAdvice
        ? 'entity_id, trigger_kind, reopens, status, created_at, advice'
        : 'entity_id, trigger_kind, reopens, status, created_at')
      .eq('org_id', orgId).eq('trigger_kind', 'neglect').in('entity_id', entities.map((e) => e.id)),
    admin.from('people').select('*').eq('org_id', orgId).in('entity_id', entities.map((e) => e.id)),
    // created_at/confirmed_at are for the re-ask rule below (a newly
    // confirmed fact is exactly what turns a hold_for_hook into a real
    // hook); the prompt itself still only ever sees id/statement/category.
    admin.from('company_facts').select('id, statement, category, created_at, confirmed_at').eq('org_id', orgId).eq('status', 'confirmed'),
  ]);
  const interactions = (interactionsRaw ?? []) as Interaction[];
  const people = (peopleRaw ?? []) as Person[];
  const companyFacts = (factsRaw ?? []) as {
    id: string; statement: string; category: string; created_at: string; confirmed_at?: string;
  }[];
  // App-level dedup (§3 — no DB uniqueness for neglect, see migration 0192).
  // Prompt 513 §2 replaces the original "pending only" rule, which never
  // actually deduped anything for the two common outcomes: hold_for_hook
  // and not_worth_it are written straight to `dismissed`, so they were
  // re-askable on the very next visit, forever. Now a dismissed verdict
  // also blocks — until something could plausibly change it (a new
  // interaction, a newly confirmed company fact, or 30 days), or until the
  // founder explicitly asks again. `pending` still blocks unconditionally.
  // `as unknown as` on purpose: supabase-js resolves the row type from the
  // select string at TYPE level, and the string here is chosen at runtime
  // (advice column present or not), which its parser can only report as an
  // error type. The shape is verified by the two literals above, not by
  // the inference.
  const priorProposals = (priorRaw ?? []) as unknown as NeglectProposalRecord[];
  const askNow = new Date();

  const byEntity = new Map<string, Interaction[]>();
  for (const it of interactions) {
    if (!it.entity_id) continue;
    byEntity.set(it.entity_id, [...(byEntity.get(it.entity_id) ?? []), it]);
  }
  // nextContactPerson's own rule (relationship.ts): most senior contactable
  // (never do_not_contact) person, reimplemented against this route's own
  // service-role query rather than importing the Db-shaped version.
  const peopleByEntity = new Map<string, Person[]>();
  for (const p of people) {
    if (!p.entity_id) continue;
    peopleByEntity.set(p.entity_id, [...(peopleByEntity.get(p.entity_id) ?? []), p]);
  }
  function nextContactPerson(entityId: string): Person | undefined {
    return (peopleByEntity.get(entityId) ?? [])
      .filter((p) => !p.do_not_contact)
      .sort((a, b) => a.seniority_rank - b.seniority_rank)[0];
  }

  const cases: NeglectCase[] = [];
  for (const e of entities) {
    const its = byEntity.get(e.id) ?? [];
    const ask = neglectAskState(priorProposals, e.id, { interactions: its, confirmedFacts: companyFacts, now: askNow });
    // Never asked → always allowed. Verdict still current → only on the
    // founder's explicit "Ask again". Pending in the queue → never.
    if (!ask.autoAskable && !(force && ask.manualAskable)) continue;
    // Server-side re-classification (§ non-clobbering): only genuinely
    // stand_by entities are ever evaluated (Prompt 273 — frozen_cold, e.g.
    // Alter VP's 2-outbound-zero-reply shape, is NOT this list — they
    // never replied, we didn't drop anything), regardless of which button
    // the client called this from.
    if (classifyFrozen(e, its) !== 'stand_by') continue;
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
      verdicts = await callSherlock(apiKey, model, group, now, companyFacts, orgId);
    } catch (e) {
      // Fail-open, same as every other AI step in this reawakening family:
      // a flaky call just means these cases weren't evaluated this time —
      // no proposal written, nothing surfaced, the founder can ask again.
      // Prompt 307 §A — still logged (was silently swallowed before).
      console.error('[reawakening/neglect-evaluate] AI evaluation failed (fail-open):', (e as Error).message);
      continue;
    }
    for (const v of verdicts) {
      const c = byCase.get(v.entity_id);
      if (!c || !group.some((g) => g.entityId === v.entity_id)) continue;
      // Safety net (§ anti-hallucination, mirrors compose's own provenance
      // gate): "reactivate" with no confirmed facts on file at all is
      // impossible by construction (the prompt tells the model so), but a
      // model slip is downgraded rather than trusted — never surface a
      // reopen with a hook that can't actually be grounded.
      const outcome: NeglectOutcome = v.outcome === 'reactivate' && companyFacts.length === 0 ? 'hold_for_hook' : v.outcome;
      const verdict: NeglectVerdict = {
        outcome, rationale: v.rationale, acknowledge: v.acknowledge, respondTo: v.respond_to,
        newHook: v.new_hook, holdReason: v.hold_reason ?? (outcome === 'hold_for_hook' ? 'No confirmed company fact to lead with yet.' : undefined),
        channel: v.channel, timing: v.timing,
      };
      results.push({ entityId: v.entity_id, verdict });
      rows.push(neglectProposalPayload(c.entityId, verdict, nextContactPerson(c.entityId)));
    }
  }

  if (rows.length > 0) {
    const nowIso = new Date().toISOString();
    // advice omitted entirely (not just left null) until migration 0193 is
    // applied — same "never send an unknown column" discipline as
    // trigger_kind's own rollout in the rejection-code path.
    const insertRows = rows.map((r) => {
      const { advice, ...rest } = r;
      return { ...rest, ...(withAdvice ? { advice } : {}), org_id: orgId, created_at: nowIso };
    });
    const { error } = await admin.from('reawakening_proposals').insert(insertRows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, results });
}
