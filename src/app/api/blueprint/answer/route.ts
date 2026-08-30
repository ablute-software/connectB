// Prompt 219 bloco 3 §3 (Prompt 223) — a resposta do founder a uma pergunta
// de lacuna.
//
// Prompt 358 Phase 1 — "nenhuma pergunta ao founder sem antes o motor ter
// tentado responder-lhe sozinho... perguntar é o último recurso, e cada
// pergunta é um recurso escasso" — a metade mecânica disso: uma resposta
// deixou de SER um claim novo por omissão. routeAnswer (company-gaps.ts)
// decide, a partir da regra + a opção escolhida + se há texto livre, o que
// a resposta realmente é:
//   'claim'           — comportamento antigo, inalterado: um claim novo,
//                       source_kind='founder_answer', status='accepted'.
//   'dismiss'         — sem facto novo (ex. "No one yet"); grava-se como
//                       respondida no registo da análise, NUNCA um claim.
//   'refresh_claim'   — G5 "Still true": actualiza o updated_at do claim
//                       EXISTENTE, nunca duplica.
//   'set_disposition' — grava a decisão do founder directamente no claim
//                       existente (migration 0234) — nunca um segundo claim
//                       só para a segurar.
// 'attach_document' (G4 "Yes — I will attach it") não passa por aqui: é um
// fluxo à parte, /api/blueprint/link-document, porque a resposta real é o
// próprio documento, nunca texto.
//
// "Dispensar" (dismiss explícito do founder, campo body.dismissed) continua
// a não gravar claim nenhum — sem mudanças nesse caminho.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable, blueprintAnalysesAvailable } from '@/lib/blueprint-capability';
import { gapDispositionAvailable, gapQuestionsAvailable, founderPromptStateAvailable } from '@/lib/document-extraction-capability';
import { normalizeAtom, joinChipAndFreeText } from '@/lib/company-claims';
import { routeAnswer, ruleG1, ruleG6, impactWhy, type GapRule } from '@/lib/company-gaps';
import { routeFreeTextAnswer } from '@/lib/answer-routing';
import { readExistingClaims } from '@/lib/company-knowledge-db';
import type { ClaimCategory } from '@/lib/types';

const CATEGORIES: ClaimCategory[] = [
  'problema', 'solucao', 'prova_tecnica', 'validacao_externa',
  'tracao_gtm', 'equipa', 'mercado_timing', 'funding', 'ask',
];

const CATEGORY_BY_RULE: Record<string, ClaimCategory> = {
  G1: 'tracao_gtm',
  G2: 'validacao_externa',
  G3: 'equipa',
  G3b: 'equipa',
  G3c: 'equipa',
  G4: 'prova_tecnica',
  G5: 'solucao',
  G6: 'funding',
  G8: 'ask',
};

async function recordAsked(admin: SupabaseClient, orgId: string, analysisId: string | undefined, entry: Record<string, unknown>) {
  if (!analysisId || !(await blueprintAnalysesAvailable())) return;
  const { data: current } = await admin.from('blueprint_analyses')
    .select('questions_asked').eq('id', analysisId).eq('org_id', orgId).maybeSingle();
  const asked = Array.isArray(current?.questions_asked) ? current.questions_asked as unknown[] : [];
  await admin.from('blueprint_analyses').update({
    questions_asked: [...asked, { ...entry, at: new Date().toISOString() }],
    updated_at: new Date().toISOString(),
  }).eq('id', analysisId).eq('org_id', orgId);
}

// Prompt 358 Phase 2.2 — the durable ledger (gap_questions, migration 0235),
// separate from blueprint_analyses.questions_asked above (which is scoped
// to ONE analysis run and only exists when that migration is applied).
// unique(org_id, gap_key) makes "never ask the same question twice" a DB
// invariant rather than something every caller has to remember to check —
// upserted, not inserted, so answering the same gap_key again (should never
// happen given /api/blueprint's own answeredRules filter, but this is the
// backstop) updates the existing row instead of violating the constraint.
// Prompt 363 — G1 and G6 are the two structural rules that can legitimately
// keep firing after an honest, saved answer (the founder told the truth,
// but the underlying fact — paid traction, a real use-of-funds — still
// doesn't exist). Re-running the rule against the just-updated claims after
// the write is the mechanical way to tell "still structurally open" apart
// from "the app forgot your answer", which is what Prompt 363 reports the
// UI looked like without this. Only these two rules need it: G3/G3b/G3c
// close via 2.4's presumption-of-truth, G4/G5/G7/G8 close via
// set_disposition/dismiss/refresh_claim, which never re-fire once answered.
const STILL_OPEN_CLOSES_WHEN: Partial<Record<GapRule, string>> = {
  G1: 'you have a paying customer or signed purchase order, not before',
  G6: 'the ask is backed by a real use-of-funds and a real why-now, not just a number',
};

async function checkStillOpen(
  admin: SupabaseClient, orgId: string, rule: string,
): Promise<{ stillOpen: boolean; reason?: string } | null> {
  const closesWhen = STILL_OPEN_CLOSES_WHEN[rule as GapRule];
  if (!closesWhen) return null;
  const claims = await readExistingClaims(admin, orgId);
  const live = claims.filter((c) => c.status !== 'rejected');
  const gaps = rule === 'G1' ? ruleG1(live) : ruleG6(live);
  if (gaps.length === 0) return { stillOpen: false };
  // Prompt 363 §3 — opens with gap.why verbatim (the exact sentence the
  // Knowledge Health panel already shows for this rule) so the two surfaces
  // never read as two different systems saying similar-but-different
  // things, then adds the one thing `why` doesn't say: what specifically
  // still has to happen for THIS rule to close.
  return { stillOpen: true, reason: `${impactWhy(rule as GapRule)} It stays open until ${closesWhen}.` };
}

async function recordGapQuestion(
  admin: SupabaseClient, orgId: string, claimId: string | null, gapKey: string, rule: string,
  questionText: string, disposition: string,
) {
  if (!(await gapQuestionsAvailable())) return;
  const now = new Date().toISOString();
  await admin.from('gap_questions').upsert({
    org_id: orgId, claim_id: claimId, gap_key: gapKey, rule, question_text: questionText,
    asked_at: now, answered_at: now, disposition,
  }, { onConflict: 'org_id,gap_key' });
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;
  if (!(await claimsAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });

  const body = await req.json().catch(() => ({})) as {
    gapKey?: string; rule?: string; answer?: string; option?: string; category?: string;
    analysisId?: string; dismissed?: boolean; relatedClaimIds?: string[];
  };
  if (!body.gapKey || !body.rule) return NextResponse.json({ ok: false, error: 'gapKey and rule are required.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (body.dismissed) {
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: false, dismissed: true });
    await recordGapQuestion(admin, orgId, body.relatedClaimIds?.[0] ?? null, body.gapKey, body.rule, `Gap ${body.rule} (${body.gapKey})`, 'dismissed_explicit');
    return NextResponse.json({ ok: true });
  }

  const option = body.option?.trim() || undefined;
  const answerText = body.answer?.trim() || undefined;
  const routing = routeAnswer(body.rule as GapRule, option, !!answerText);
  const targetClaimId = body.relatedClaimIds?.[0];
  const questionText = `Gap ${body.rule} (${body.gapKey})`;

  if (routing.kind === 'dismiss') {
    // Prompt 358 §1.1 — a non-informative chip alone ("No one yet", "No
    // longer applies", …): nothing was learned, so nothing is written to
    // company_claims — recorded exactly like an explicit dismiss.
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: 'dismiss' });
    await recordGapQuestion(admin, orgId, targetClaimId ?? null, body.gapKey, body.rule, questionText, 'dismiss');
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'refresh_claim') {
    if (!targetClaimId) return NextResponse.json({ ok: false, error: 'No claim to refresh.' }, { status: 400 });
    const { error } = await admin.from('company_claims').update({ updated_at: new Date().toISOString() })
      .eq('id', targetClaimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: 'refresh' });
    await recordGapQuestion(admin, orgId, targetClaimId, body.gapKey, body.rule, questionText, 'refresh');
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'set_disposition') {
    if (!targetClaimId) return NextResponse.json({ ok: false, error: 'No claim to update.' }, { status: 400 });
    if (!(await gapDispositionAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });
    const { error } = await admin.from('company_claims').update({ gap_disposition: routing.disposition, updated_at: new Date().toISOString() })
      .eq('id', targetClaimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: routing.disposition });
    await recordGapQuestion(admin, orgId, targetClaimId, body.gapKey, body.rule, questionText, routing.disposition);
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'set_founder_prompt_state') {
    if (!targetClaimId) return NextResponse.json({ ok: false, error: 'No claim to update.' }, { status: 400 });
    if (!(await founderPromptStateAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });
    const patch: Record<string, unknown> = { founder_prompt_state: routing.state, updated_at: new Date().toISOString() };
    // Prompt 472 §C — "a promise without a date is a promise without an
    // end": recorded the moment this state is FIRST set, never touched
    // again after — this route only ever reaches this branch once per
    // gap_key (gap_questions' own unique(org_id, gap_key) constraint, and
    // shouldStopAskingFounder now suppresses the question the moment this
    // write lands), so there is no re-answer path here that would need to
    // decide whether to refresh an existing timestamp.
    if (routing.state === 'answered_document_pending') patch.document_pending_since = new Date().toISOString();
    const { error } = await admin.from('company_claims').update(patch).eq('id', targetClaimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: routing.state });
    await recordGapQuestion(admin, orgId, targetClaimId, body.gapKey, body.rule, questionText, routing.state);
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'attach_document') {
    // The client is expected to route this option to /api/blueprint/link-document
    // instead of ever calling this route with it — reaching here is a
    // client bug, not a valid state to silently paper over.
    return NextResponse.json({ ok: false, error: 'This answer needs a document — use the attach-document flow.' }, { status: 400 });
  }

  // routing.kind === 'claim' — a real claim by default, UNLESS Phase 2.3's
  // routing decides free text is just amending the claim this gap was
  // already about (never silent either way — routedAs/reasoning always
  // come back in the response so the UI can tell the founder what happened).
  const statement = joinChipAndFreeText(option, answerText);
  if (!statement) return NextResponse.json({ ok: false, error: 'An answer is required.' }, { status: 400 });

  if (answerText && targetClaimId && apiKey) {
    const { data: targetRow } = await admin.from('company_claims').select('id, statement')
      .eq('id', targetClaimId).eq('org_id', orgId).maybeSingle();
    if (targetRow?.statement) {
      try {
        const model = process.env.AI_REVIEW_MODEL ?? 'claude-sonnet-4-5';
        const decision = await routeFreeTextAnswer(apiKey, model, orgId, body.rule, targetRow.statement as string, answerText);
        if (decision.destination === 'amend_target_claim') {
          const merged = `${targetRow.statement} ${answerText}`.trim();
          const { error } = await admin.from('company_claims')
            .update({ statement: merged, updated_at: new Date().toISOString() })
            .eq('id', targetClaimId).eq('org_id', orgId);
          if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
          await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: 'amend_target_claim' });
          await recordGapQuestion(admin, orgId, targetClaimId, body.gapKey, body.rule, questionText, 'amend_target_claim');
          const stillOpenAmend = await checkStillOpen(admin, orgId, body.rule);
          return NextResponse.json({ ok: true, routedAs: 'amend_target_claim', reasoning: decision.reasoning, ...stillOpenAmend });
        }
      } catch (e) {
        // AI routing failing must never block the founder's answer — falls
        // through to the ORIGINAL, always-correct default: a new claim.
        console.error('[blueprint/answer] routeFreeTextAnswer failed', (e as Error).message);
      }
    }
  }

  const category = (body.category && (CATEGORIES as string[]).includes(body.category)
    ? body.category as ClaimCategory : (CATEGORY_BY_RULE[body.rule] ?? 'solucao'));
  const n = normalizeAtom({
    category, statement, sourceKind: 'founder_answer',
    sourceRef: `gap:${body.gapKey}`,
  });
  const { error } = await admin.from('company_claims').insert({
    org_id: orgId, category: n.category, statement: n.statement,
    evidence_class: n.evidenceClass, specificity: n.specificity,
    source_kind: n.sourceKind, source_ref: n.sourceRef,
    status: 'accepted', analysis_id: body.analysisId ?? null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false });
  await recordGapQuestion(admin, orgId, targetClaimId ?? null, body.gapKey, body.rule, questionText, 'new_claim');
  const stillOpenNew = await checkStillOpen(admin, orgId, body.rule);
  return NextResponse.json({ ok: true, routedAs: 'new_claim', ...stillOpenNew });
}
