// F — fact-triggered reawakening: the ONLY place the model is consulted, and
// only ever in response to a confirmed canon fact (POST { factId }). Flow:
//   1. mechanical prefilter (no AI): dormant/passed entities with a
//      reopen_trigger, minus (fact_id, entity_id) pairs already evaluated;
//   2. ONE batched AI call per chunk of <=40 — ZERO calls if the shortlist is
//      empty;
//   3. store proposals (reopens → 'pending', else 'dismissed').
// No cron, no periodic scan — this route is reached only from the store's
// fact-confirm/supersede actions. Idempotent: the unique (fact_id, entity_id)
// constraint + upsert(ignoreDuplicates) make re-fires harmless.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { prefilterEntities, priorPassInfo, chunk, proposalStatusForVerdict } from '@/lib/reawakening';
import type { Entity, FitScore, Interaction } from '@/lib/types';

const FITS: FitScore[] = ['high', 'medium_high', 'medium', 'low'];

interface Verdict { entity_id: string; reopens: boolean; rationale?: string; suggested_wave?: number; suggested_fit?: string }

function buildPrompt(fact: string, supersedes: string | undefined, rows: { entity_id: string; name: string; reopen_trigger: string; prior_pass?: string; last_contact?: string }[]): string {
  const delta = supersedes ? `\nThis fact SUPERSEDES an earlier one — the positioning changed.\nEARLIER (now outdated): "${supersedes}"\nThe change itself may be the reason to re-approach.` : '';
  const list = rows.map((r, i) => `${i + 1}. entity_id=${r.entity_id} · ${r.name}\n   why it was set aside / what would have to change: ${r.reopen_trigger}\n   prior pass reason: ${r.prior_pass ?? '(not recorded)'}\n   last contact: ${r.last_contact ?? '(unknown)'}`).join('\n');
  return `A startup founder just CONFIRMED this new company fact:\n"${fact}"${delta}\n\n`
    + `Below are investors this founder previously set aside (passed/dormant), each with the doctrine of what would have to change to re-approach them legitimately. For EACH, decide whether THIS new fact plausibly satisfies (or moves toward) that reopen condition — i.e. whether it's now legitimate to re-approach.\n\n`
    + `Be strict: only reopens=true when the fact genuinely addresses the recorded reason. A generic improvement that doesn't touch the specific objection is reopens=false. One-sentence rationale each. Suggested wave is 1 (highest priority) to 4. Suggested fit is one of high, medium_high, medium, low.\n\n`
    + `INVESTORS:\n${list}`;
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: true, configured: false, proposals: 0 }, { status: 200 });

  const { factId, supersedesStatement } = await req.json() as { factId?: string; supersedesStatement?: string };
  if (!factId) return NextResponse.json({ ok: false, error: 'Missing factId.' }, { status: 400 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  const orgId = member.org_id as string;

  // The confirmed fact that triggered this (scoped to the caller's org by RLS).
  const { data: fact } = await sb.from('company_facts').select('id, statement, status').eq('id', factId).maybeSingle();
  if (!fact || fact.status !== 'confirmed') return NextResponse.json({ ok: true, proposals: 0, evaluated: 0 }, { status: 200 });

  // Step 1 — mechanical prefilter (no AI). Load entities, interactions, and the
  // already-evaluated pairs for this fact.
  const [{ data: entitiesRaw }, { data: interactionsRaw }, { data: evaluatedRaw }] = await Promise.all([
    sb.from('entities').select('*').eq('org_id', orgId),
    sb.from('interactions').select('*').eq('org_id', orgId),
    sb.from('reawakening_proposals').select('entity_id').eq('fact_id', factId),
  ]);
  const entities = (entitiesRaw ?? []) as Entity[];
  const interactions = (interactionsRaw ?? []) as Interaction[];
  const evaluated = new Set(((evaluatedRaw ?? []) as { entity_id: string }[]).map((r) => r.entity_id));
  const shortlist = prefilterEntities(entities, evaluated);
  if (shortlist.length === 0) return NextResponse.json({ ok: true, proposals: 0, evaluated: 0 }, { status: 200 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: true, configured: false, proposals: 0, evaluated: 0 }, { status: 200 });

  // Per-entity context for the model + the prior-pass snapshot to store.
  const byEntity = new Map<string, Interaction[]>();
  for (const it of interactions) {
    if (!it.entity_id) continue;
    byEntity.set(it.entity_id, [...(byEntity.get(it.entity_id) ?? []), it]);
  }
  const passInfo = new Map<string, { reason?: string; category?: string }>();
  const lastContact = new Map<string, string | undefined>();
  for (const e of shortlist) {
    const its = byEntity.get(e.id) ?? [];
    passInfo.set(e.id, priorPassInfo(its));
    const touches = its.filter((i) => i.channel !== 'stage_change').map((i) => i.occurred_at).filter(Boolean).sort();
    lastContact.set(e.id, touches.length ? touches[touches.length - 1] : undefined);
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
  const verdicts: Verdict[] = [];

  // Step 2 — ONE batched call per chunk of <=40.
  for (const group of chunk(shortlist)) {
    const rows = group.map((e) => ({
      entity_id: e.id, name: e.name, reopen_trigger: e.reopen_trigger ?? '',
      prior_pass: passInfo.get(e.id)?.reason, last_contact: lastContact.get(e.id)?.slice(0, 10),
    }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 2000,
        system: 'You judge whether a new company fact legitimately reopens previously set-aside investors, honoring each investor\'s recorded reopen doctrine. You never invent facts; you only reason about whether the given fact addresses the given objection.',
        messages: [{ role: 'user', content: buildPrompt(fact.statement as string, supersedesStatement, rows) }],
        tools: [{
          name: 'evaluate_reawakening',
          description: 'Return one verdict per investor.',
          input_schema: {
            type: 'object',
            properties: {
              verdicts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entity_id: { type: 'string' },
                    reopens: { type: 'boolean' },
                    rationale: { type: 'string' },
                    suggested_wave: { type: 'integer' },
                    suggested_fit: { type: 'string', enum: FITS },
                  },
                  required: ['entity_id', 'reopens', 'rationale'],
                },
              },
            },
            required: ['verdicts'],
          },
        }],
        tool_choice: { type: 'tool', name: 'evaluate_reawakening' },
      }),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'AI evaluation failed.' }, { status: 502 });
    const data = await res.json();
    const input = data.content?.find((b: { type: string }) => b.type === 'tool_use')?.input as { verdicts?: Verdict[] } | undefined;
    for (const v of input?.verdicts ?? []) if (group.some((e) => e.id === v.entity_id)) verdicts.push(v);
  }

  // Step 3 — persist a row per evaluated pair (service-role insert). reopens →
  // 'pending', else 'dismissed'. upsert(ignoreDuplicates) keeps re-fires safe.
  const now = new Date().toISOString();
  const proposalRows = verdicts.map((v) => {
    const pass = passInfo.get(v.entity_id) ?? {};
    const fit = FITS.includes(v.suggested_fit as FitScore) ? v.suggested_fit : null;
    const wave = Number.isFinite(v.suggested_wave) ? Math.round(v.suggested_wave as number) : null;
    return {
      org_id: orgId, fact_id: factId, entity_id: v.entity_id,
      reopens: !!v.reopens, rationale: v.rationale ?? null,
      suggested_wave: wave, suggested_fit: fit,
      prior_pass_reason: pass.reason ?? null, prior_pass_category: pass.category ?? null,
      fact_statement: fact.statement, status: proposalStatusForVerdict(!!v.reopens), created_at: now,
    };
  });
  if (proposalRows.length) {
    const { error } = await admin.from('reawakening_proposals').upsert(proposalRows, { onConflict: 'fact_id,entity_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const pending = proposalRows.filter((r) => r.status === 'pending').length;
  return NextResponse.json({ ok: true, evaluated: proposalRows.length, proposals: pending });
}
