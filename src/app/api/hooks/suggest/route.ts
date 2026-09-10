// Prompt 585 §F.1-§F.6 — the hook-suggestion service. Org-member-facing
// (the founder is the one drafting outreach — not a back-office route),
// mirroring the requireOrgMember pattern used by the Phase 3 propose-
// evidence route. Guards before any model cost: org member, entity
// delivered to the org, target eligible and not do_not_contact,
// input_hash already cached → return it, zero new calls. No quota this
// phase — Nuno's own explicit answer ("não aplicar limites para já").
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { computeCostEur, logAiCall } from '@/lib/ai-cost-log';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { buildHookPack, buildHookSystemPrompt, CHANNEL_CHAR_LIMITS, type HookPackEvidence, type HookPackInput } from '@/lib/hook-pack';
import { HOOK_TOOL_SCHEMA, parseHookOutput, validateHookOutput, type ParsedHookOutput } from '@/lib/hook-validate';
import { seniorityRankLabel } from '@/lib/seniority-rank-label';

const CHANNELS = new Set(['platform_message', 'linkedin', 'email', 'form']);

async function requireOrgMember(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { error: NextResponse.json({ ok: false, error: 'not configured' }) };

  const sb = await serverClient();
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return { error: viewerBlock };
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 }) };

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return { error: NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 }) };

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { admin, orgId: member.org_id as string, userId: user.id };
}

function toEvidence(rows: { id: string; kind: string; title: string; published_at: string | null; excerpt: string | null; is_personal: boolean; catalog_evidence_topics?: { topic_taxonomy: { label_en: string } | { label_en: string }[] | null }[] }[]): HookPackEvidence[] {
  return rows.map((e) => ({
    id: e.id, kind: e.kind, title: e.title, publishedAt: e.published_at, excerpt: e.excerpt,
    isPersonal: e.is_personal,
    topics: (e.catalog_evidence_topics ?? []).map((t) => {
      const tax = Array.isArray(t.topic_taxonomy) ? t.topic_taxonomy[0] : t.topic_taxonomy;
      return tax?.label_en;
    }).filter((l): l is string => !!l),
  }));
}

async function callModel(admin: SupabaseClient, apiKey: string, model: string, systemPrompt: string, userPrompt: string, orgId: string, targetId: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 700,
      system: systemPrompt + ' ' + DOCUMENT_CONTENT_INSTRUCTION,
      messages: [{ role: 'user', content: wrapDocumentContent(userPrompt) }],
      tools: [{ name: 'report_hook', description: 'Return the hook suggestion.', input_schema: HOOK_TOOL_SCHEMA }],
      tool_choice: { type: 'tool', name: 'report_hook' },
    }),
  });
  if (!res.ok) throw new Error(providerErrorMessage('[hook-suggest]', await res.text()));
  const data = await res.json();
  await logAiCall({ route: '/api/hooks/suggest', purpose: 'hook:suggest', model, usage: data.usage, orgId, targetType: 'hook_suggestions', targetId });
  const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
  return { parsed: parseHookOutput(toolUse?.input), usage: data.usage as { input_tokens?: number; output_tokens?: number } | undefined };
}

export async function POST(req: Request) {
  const auth = await requireOrgMember(req);
  if ('error' in auth) return auth.error;
  const { admin, orgId, userId } = auth;

  const body = await req.json().catch(() => ({})) as { target_kind?: string; target_id?: string; entity_id?: string; channel?: string };
  const { target_kind: targetKind, target_id: targetId, entity_id: entityId, channel } = body;
  if ((targetKind !== 'person' && targetKind !== 'entity') || !targetId || !entityId || !channel || !CHANNELS.has(channel)) {
    return NextResponse.json({ ok: false, error: 'target_kind, target_id, entity_id and a valid channel are required.' }, { status: 400 });
  }
  if (targetKind === 'entity' && targetId !== entityId) {
    return NextResponse.json({ ok: false, error: 'An entity-target hook must have target_id === entity_id.' }, { status: 400 });
  }

  // Guard: entity delivered to this org.
  const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).eq('catalog_id', entityId).maybeSingle();
  if (!delivery) return NextResponse.json({ ok: false, error: 'This fund isn’t in your pipeline.' }, { status: 404 });

  // Guard: person target must be eligible per §C.4 (same gate
  // catalog_recompute_person_priority uses) and not do_not_contact.
  let personRow: { id: string; full_name: string; linkedin_url: string | null; do_not_contact: boolean; bio_raw: string | null } | null = null;
  let personAffiliation: { title: string | null; seniority_rank: number | null } | null = null;
  if (targetKind === 'person') {
    const { data: aff } = await admin.from('catalog_person_affiliations')
      .select('title, seniority_rank, catalog_people(id, full_name, linkedin_url, do_not_contact)')
      .eq('person_id', targetId).eq('entity_id', entityId).eq('current', true).maybeSingle();
    const person = aff?.catalog_people as unknown as { id: string; full_name: string; linkedin_url: string | null; do_not_contact: boolean } | { id: string; full_name: string; linkedin_url: string | null; do_not_contact: boolean }[] | null;
    const p = Array.isArray(person) ? person[0] : person;
    if (!aff || !p || p.do_not_contact || aff.seniority_rank == null || aff.seniority_rank >= 9) {
      return NextResponse.json({ ok: false, error: 'This person isn’t an eligible contact for this fund.' }, { status: 404 });
    }
    let eligible = aff.seniority_rank <= 3;
    if (!eligible && aff.seniority_rank === 4) {
      const { data: signal } = await admin.rpc('catalog_topic_signal', { p_org_id: orgId, p_person_id: targetId, p_entity_id: null });
      eligible = !!(signal as { meets_threshold?: boolean } | null)?.meets_threshold;
    }
    if (!eligible) return NextResponse.json({ ok: false, error: 'This person isn’t an eligible contact for this fund.' }, { status: 404 });
    const { data: research } = await admin.from('catalog_people_research').select('bio_raw').eq('person_id', targetId).maybeSingle();
    personRow = { id: p.id, full_name: p.full_name, linkedin_url: p.linkedin_url, do_not_contact: p.do_not_contact, bio_raw: research?.bio_raw ?? null };
    personAffiliation = { title: aff.title, seniority_rank: aff.seniority_rank };
  }

  // --- Assemble the pack (buildHookPack does no I/O — everything below is fetching real data for it). ---
  const [{ data: org }, { data: tractionRows }, { data: orgTopicRows }, { data: entityRow }] = await Promise.all([
    admin.from('orgs').select('name, one_liner, sectors, stage, round_target_eur, intro_problem, intro_solution').eq('id', orgId).maybeSingle(),
    admin.from('org_traction_metrics').select('label, value').eq('org_id', orgId).order('sort_order'),
    admin.from('org_topics').select('topic_taxonomy(label_en)').eq('org_id', orgId),
    admin.from('catalog_entities').select('name, thesis, sectors_normalized, stage_min, stage_max, check_min_eur, check_max_eur, hq_country').eq('id', entityId).maybeSingle(),
  ]);
  if (!org || !entityRow) return NextResponse.json({ ok: false, error: 'Could not load context.' }, { status: 500 });

  const orgTopics = (orgTopicRows ?? []).map((r) => {
    const tax = r.topic_taxonomy as unknown as { label_en: string } | { label_en: string }[] | null;
    return Array.isArray(tax) ? tax[0]?.label_en : tax?.label_en;
  }).filter((l): l is string => !!l);

  const [{ data: entityEvidenceRaw }, { data: investments }] = await Promise.all([
    admin.from('catalog_evidence')
      .select('id, kind, title, published_at, excerpt, is_personal, catalog_evidence_topics(topic_taxonomy(label_en))')
      .eq('entity_id', entityId).is('person_id', null).in('status', ['found', 'verified']).neq('polarity', 'negative')
      .order('published_at', { ascending: false }).limit(10),
    admin.from('investor_investments').select('invested_at, round_type, market_companies(name)')
      .eq('investor_entity_id', entityId).order('invested_at', { ascending: false }).limit(5),
  ]);

  let personEvidenceRaw: typeof entityEvidenceRaw = [];
  if (targetKind === 'person') {
    const { data } = await admin.from('catalog_evidence')
      .select('id, kind, title, published_at, excerpt, is_personal, catalog_evidence_topics(topic_taxonomy(label_en))')
      .eq('person_id', targetId).in('status', ['found', 'verified']).neq('polarity', 'negative')
      .order('published_at', { ascending: false }).limit(10);
    personEvidenceRaw = data ?? [];
  }

  // §F.2's "relationship" — the org's own private pipeline row for this
  // fund (resolved via catalog_deliveries, same mapping used elsewhere on
  // the founder side), never anything from another org.
  const { data: orgEntityLink } = await admin.from('catalog_deliveries').select('entity_id').eq('org_id', orgId).eq('catalog_id', entityId).maybeSingle();
  let hasPriorContact = false; let lastPassReason: string | null = null;
  if (orgEntityLink?.entity_id) {
    const { data: interactionRows } = await admin.from('interactions')
      .select('classification, pass_reason').eq('entity_id', orgEntityLink.entity_id).order('occurred_at', { ascending: false }).limit(20);
    hasPriorContact = (interactionRows?.length ?? 0) > 0;
    lastPassReason = (interactionRows ?? []).find((r) => r.classification === 'pass')?.pass_reason ?? null;
  }

  const { data: killWordsRow } = targetKind === 'person'
    ? await admin.from('catalog_people_research').select('kill_words').eq('person_id', targetId).maybeSingle()
    : { data: null as { kill_words: string[] | null } | null };

  const { data: signalForWatchOuts } = await admin.rpc('catalog_topic_signal', {
    p_org_id: orgId, p_person_id: targetKind === 'person' ? targetId : null, p_entity_id: targetKind === 'entity' ? entityId : null,
  });
  const watchOuts = ((signalForWatchOuts as { watch_outs?: { evidence_id: string; title: string }[] } | null)?.watch_outs ?? [])
    .map((w) => ({ evidenceId: w.evidence_id, title: w.title }));

  const packInput: HookPackInput = {
    targetKind, channel: channel as HookPackInput['channel'],
    startup: {
      name: org.name, oneLiner: org.one_liner ?? null, sectors: org.sectors ?? [], orgTopics,
      stage: org.stage ?? null, roundTargetEur: org.round_target_eur ?? null,
      traction: (tractionRows ?? []).map((t) => ({ label: t.label, value: t.value })),
      introProblem: org.intro_problem ?? null, introSolution: org.intro_solution ?? null,
    },
    entity: {
      name: entityRow.name, thesis: entityRow.thesis ?? null, sectors: entityRow.sectors_normalized ?? [],
      stageMin: entityRow.stage_min ?? null, stageMax: entityRow.stage_max ?? null,
      checkMinEur: entityRow.check_min_eur ?? null, checkMaxEur: entityRow.check_max_eur ?? null,
      hqCountry: entityRow.hq_country ?? null,
      evidence: toEvidence(entityEvidenceRaw ?? []),
      lastInvestments: (investments ?? []).map((i) => {
        const company = i.market_companies as unknown as { name: string } | { name: string }[] | null;
        const name = Array.isArray(company) ? company[0]?.name : company?.name;
        return { companyName: name ?? 'a company', investedAt: i.invested_at, roundType: i.round_type };
      }),
    },
    person: targetKind === 'person' && personRow ? {
      fullName: personRow.full_name, title: personAffiliation?.title ?? null,
      seniorityLabel: seniorityRankLabel(personAffiliation?.seniority_rank), bioRaw: personRow.bio_raw,
      evidence: toEvidence(personEvidenceRaw ?? []),
    } : null,
    relationship: { hasPriorContact, lastPassReason },
    watchOuts,
    killWords: killWordsRow?.kill_words ?? [],
  };

  const pack = buildHookPack(packInput);
  const inputHash = createHash('sha256').update(pack.promptText).digest('hex');

  // §F.1 — cached suggestion, zero new calls.
  const { data: existing } = await admin.from('hook_suggestions')
    .select('*').eq('org_id', orgId).eq('target_kind', targetKind).eq('target_id', targetId)
    .eq('entity_id', entityId).eq('channel', channel).eq('input_hash', inputHash).is('invalidated_at', null).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, suggestion: existing });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'AI review isn’t available in this workspace yet.' }, { status: 200 });
  const model = process.env.HOOK_MODEL ?? 'claude-sonnet-5';
  const systemPrompt = buildHookSystemPrompt(targetKind, pack.charLimit);
  const killWordsList = packInput.killWords;

  let parsed: ParsedHookOutput; let totalCostEur = 0;
  try {
    const first = await callModel(admin, apiKey, model, systemPrompt, pack.promptText, orgId, targetId);
    totalCostEur += computeCostEur(model, first.usage);
    let validation = validateHookOutput({ parsed: first.parsed, evidencePool: pack.evidencePool, charLimit: pack.charLimit, killWords: killWordsList, targetKind });
    parsed = first.parsed;
    if (!validation.ok) {
      const retryPrompt = `${pack.promptText}\n\n=== YOUR PREVIOUS ANSWER FAILED VALIDATION ===\n${validation.errors.join('\n')}\nFix these issues and answer again, following the same rules.`;
      const second = await callModel(admin, apiKey, model, systemPrompt, retryPrompt, orgId, targetId);
      totalCostEur += computeCostEur(model, second.usage);
      validation = validateHookOutput({ parsed: second.parsed, evidencePool: pack.evidencePool, charLimit: pack.charLimit, killWords: killWordsList, targetKind });
      parsed = validation.ok ? second.parsed : { verdict: 'none', hookText: null, claims: [], reasonIfNone: 'validation' };
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  const citedEvidenceIds = Array.from(new Set(parsed.claims.flatMap((c) => c.evidenceIds)));
  const { data: maxVersionRow } = await admin.from('hook_suggestions')
    .select('version').eq('org_id', orgId).eq('target_kind', targetKind).eq('target_id', targetId).eq('entity_id', entityId).eq('channel', channel)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  const version = (maxVersionRow?.version ?? 0) + 1;

  const { data: inserted, error: insertErr } = await admin.from('hook_suggestions').insert({
    org_id: orgId, target_kind: targetKind, target_id: targetId, entity_id: entityId, channel, version,
    verdict: parsed.verdict, hook_text: parsed.verdict === 'none' ? null : parsed.hookText,
    claims: parsed.claims.map((c) => ({ text: c.text, evidence_ids: c.evidenceIds })),
    evidence_ids: citedEvidenceIds, input_hash: inputHash, model, cost_eur: totalCostEur || null,
    created_by: userId,
  }).select('*').single();
  if (insertErr || !inserted) return NextResponse.json({ ok: false, error: insertErr?.message ?? 'Could not save.' }, { status: 500 });

  // §F.6 — a 'none' verdict feeds back as a position-only signal for THIS
  // org (never the entity's own match score). Write-only counter this
  // phase — see DECISIONS.md for why the live ordering isn't touched yet.
  if (parsed.verdict === 'none' && targetKind === 'person') {
    const { data: priority } = await admin.from('catalog_person_priority')
      .select('components').eq('org_id', orgId).eq('person_id', targetId).eq('entity_id', entityId).maybeSingle();
    if (priority) {
      const components = (priority.components ?? {}) as Record<string, unknown>;
      const count = (typeof components.no_link_verdicts === 'number' ? components.no_link_verdicts : 0) + 1;
      await admin.from('catalog_person_priority').update({ components: { ...components, no_link_verdicts: count } })
        .eq('org_id', orgId).eq('person_id', targetId).eq('entity_id', entityId);
    }
  }

  return NextResponse.json({ ok: true, suggestion: inserted });
}
