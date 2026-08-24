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
import { gapDispositionAvailable } from '@/lib/document-extraction-capability';
import { normalizeAtom } from '@/lib/company-claims';
import { routeAnswer, type GapRule } from '@/lib/company-gaps';
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

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    return NextResponse.json({ ok: true });
  }

  const option = body.option?.trim() || undefined;
  const answerText = body.answer?.trim() || undefined;
  const routing = routeAnswer(body.rule as GapRule, option, !!answerText);
  const targetClaimId = body.relatedClaimIds?.[0];

  if (routing.kind === 'dismiss') {
    // Prompt 358 §1.1 — a non-informative chip alone ("No one yet", "No
    // longer applies", …): nothing was learned, so nothing is written to
    // company_claims — recorded exactly like an explicit dismiss.
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: 'dismiss' });
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'refresh_claim') {
    if (!targetClaimId) return NextResponse.json({ ok: false, error: 'No claim to refresh.' }, { status: 400 });
    const { error } = await admin.from('company_claims').update({ updated_at: new Date().toISOString() })
      .eq('id', targetClaimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: 'refresh' });
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'set_disposition') {
    if (!targetClaimId) return NextResponse.json({ ok: false, error: 'No claim to update.' }, { status: 400 });
    if (!(await gapDispositionAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });
    const { error } = await admin.from('company_claims').update({ gap_disposition: routing.disposition, updated_at: new Date().toISOString() })
      .eq('id', targetClaimId).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    await recordAsked(admin, orgId, body.analysisId, { key: body.gapKey, rule: body.rule, answered: true, dismissed: false, disposition: routing.disposition });
    return NextResponse.json({ ok: true });
  }

  if (routing.kind === 'attach_document') {
    // The client is expected to route this option to /api/blueprint/link-document
    // instead of ever calling this route with it — reaching here is a
    // client bug, not a valid state to silently paper over.
    return NextResponse.json({ ok: false, error: 'This answer needs a document — use the attach-document flow.' }, { status: 400 });
  }

  // routing.kind === 'claim' — unchanged behavior: a real claim, derived
  // (never chosen) classification, same as always.
  const parts = [option, answerText].filter(Boolean);
  const statement = parts.join(' — ');
  if (!statement) return NextResponse.json({ ok: false, error: 'An answer is required.' }, { status: 400 });

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
  return NextResponse.json({ ok: true });
}
