// Prompt 219 bloco 3 §3 (Prompt 223) — a resposta do founder a uma pergunta
// de lacuna.
//
// A decisão do 219 §2, aqui em código: NÃO existe tabela de respostas. Uma
// resposta É um claim novo, com source_kind='founder_answer' e
// status='accepted' — o founder acabou de a escrever, não há mais ninguém
// para a aceitar. A classificação (classe/especificidade) é DERIVADA pelo
// normalizeAtom sobre o texto que ele escreveu, nunca escolhida por ele:
// é isso que faz uma resposta vaga continuar a contar como vaga.
//
// "Dispensar" (dismiss) grava na análise mas NÃO grava claim: não responder
// não é conhecimento novo, e inventar um claim vazio poluiria a base.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable, blueprintAnalysesAvailable } from '@/lib/blueprint-capability';
import { normalizeAtom } from '@/lib/company-claims';
import type { ClaimCategory } from '@/lib/types';

// A categoria em que a resposta aterra, por regra. É o assunto da PERGUNTA,
// não uma escolha do founder — quem responde "quem lidera a técnica" está a
// falar de equipa, esteja o texto como estiver.
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
  // G8 (Prompt 310 §B) — a round-value clarification is itself a statement
  // about the round's own terms.
  G8: 'ask',
};

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
    gapKey?: string; rule?: string; answer?: string; option?: string; category?: string; analysisId?: string; dismissed?: boolean;
  };
  if (!body.gapKey || !body.rule) return NextResponse.json({ ok: false, error: 'gapKey and rule are required.' }, { status: 400 });

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // A frase é a opção escolhida e o texto livre, juntos: a opção sozinha
  // ("LOI signed") não tem sinais para medir, o texto livre sozinho perde o
  // enquadramento. Juntos dão ao measureSpecificity o que ele precisa.
  const parts = [body.option?.trim(), body.answer?.trim()].filter(Boolean);
  const statement = parts.join(' — ');

  if (!body.dismissed) {
    if (!statement) return NextResponse.json({ ok: false, error: 'An answer is required.' }, { status: 400 });
    // Prompt 299 §2 — G7 spans several categories, so its gap carries the
    // ORIGINAL claim's own category through (gap.meta.category) rather than
    // relying on the one-category-per-rule map below, which can't express
    // "depends which claim this gap was about." Prompt 310 §A gave G4 the
    // same treatment once it started spanning four categories instead of
    // one. Validated against the same allowlist as every other category
    // input in this codebase.
    const category = (body.category && (CATEGORIES as string[]).includes(body.category)
      ? body.category as ClaimCategory : (CATEGORY_BY_RULE[body.rule] ?? 'solucao'));
    const n = normalizeAtom({
      category,
      statement,
      sourceKind: 'founder_answer',
      // O sourceRef amarra a resposta à lacuna que a provocou — é assim
      // que o GET sabe não voltar a perguntar (sem tabela de perguntas).
      sourceRef: `gap:${body.gapKey}`,
    });
    const { error } = await admin.from('company_claims').insert({
      org_id: orgId, category: n.category, statement: n.statement,
      evidence_class: n.evidenceClass, specificity: n.specificity,
      source_kind: n.sourceKind, source_ref: n.sourceRef,
      status: 'accepted', analysis_id: body.analysisId ?? null,
    });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // O registo do interrogatório, quando a 0179 existir. Lido inteiro e
  // reescrito inteiro — ver o comentário da própria migração.
  if (body.analysisId && await blueprintAnalysesAvailable()) {
    const { data: current } = await admin.from('blueprint_analyses')
      .select('questions_asked').eq('id', body.analysisId).eq('org_id', orgId).maybeSingle();
    const asked = Array.isArray(current?.questions_asked) ? current.questions_asked as unknown[] : [];
    await admin.from('blueprint_analyses').update({
      questions_asked: [...asked, {
        key: body.gapKey, rule: body.rule,
        answered: !body.dismissed, dismissed: !!body.dismissed,
        at: new Date().toISOString(),
      }],
      updated_at: new Date().toISOString(),
    }).eq('id', body.analysisId).eq('org_id', orgId);
  }

  return NextResponse.json({ ok: true });
}
