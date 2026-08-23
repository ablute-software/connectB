// Prompt 219 bloco 3 §3/§4 (Prompt 223) — o motor de narrativa, lado
// servidor. GET devolve o estado actual (claims + lacunas + análise em
// curso); POST arranca uma análise nova (ingestão → claims propostos).
//
// SEM AI neste bloco: a ingestão é mecânica (company-knowledge.ts) e a
// deteção de lacunas é pura (company-gaps.ts). A síntese é o bloco 4.
// SEM quota/gating: é o bloco 6.
//
// Regra raiz: nada aqui lê performance de plataforma — ver a lista fechada
// de tabelas em company-knowledge-db.ts. Esta rota é founder-only por
// construção (resolve a org por org_members) e nenhuma superfície de
// investidor lhe toca.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable, blueprintAnalysesAvailable } from '@/lib/blueprint-capability';
import { readKnowledgeSources, readExistingClaims, hasAnyVaultDocument } from '@/lib/company-knowledge-db';
import { knowledgeToAtoms, newAtoms } from '@/lib/company-knowledge';
import { normalizeAtom, findDuplicateCandidate } from '@/lib/company-claims';
import { detectGaps, templateFor, gapKey } from '@/lib/company-gaps';

async function resolveOrg(sb: Awaited<ReturnType<typeof serverClient>>, userId: string) {
  const { data } = await sb.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

// As lacunas precisam de saber quem são os founders (G3b) e o estágio
// (G3c) — ambos do próprio perfil da org, nada derivado pela plataforma.
async function gapContext(admin: SupabaseClient, orgId: string) {
  const [{ data: people }, { data: org }, hasVaultDocuments] = await Promise.all([
    admin.from('company_people').select('full_name, is_founder').eq('org_id', orgId),
    admin.from('orgs').select('stage, sectors').eq('id', orgId).maybeSingle(),
    hasAnyVaultDocument(admin, orgId),
  ]);
  const orgRow = (org ?? null) as { stage?: string | null; sectors?: string[] | null } | null;
  return {
    founders: ((people ?? []) as { full_name: string; is_founder?: boolean }[])
      .filter((p) => p.is_founder).map((p) => ({ name: p.full_name })),
    stage: orgRow?.stage ?? null,
    sector: (orgRow?.sectors ?? [])[0] ?? null,
    now: new Date(),
    hasVaultDocuments,
  };
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { available: false, claims: [], gaps: [], analysis: null };
  if (!url || !serviceKey) return NextResponse.json(empty);

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await claimsAvailable())) return NextResponse.json(empty);

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json(empty);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const claims = await readExistingClaims(admin, orgId);

  // As lacunas correm sobre o que CONTA: propostos + aceites. Rejeitados
  // ficam de fora — o founder já disse que não, e uma regra a disparar
  // sobre um claim rejeitado seria pedir-lhe a mesma decisão outra vez.
  const live = claims.filter((c) => c.status !== 'rejected');
  const gaps = detectGaps(live, await gapContext(admin, orgId));

  // Nunca perguntar o que já tem resposta aceite: uma lacuna cuja pergunta
  // já foi respondida (existe claim founder_answer aceite dessa regra)
  // desaparece da fila. O G5 (staleness) é que a reabre, e reabre pela via
  // normal — o claim antigo volta a disparar por idade.
  const answeredRules = new Set(
    claims.filter((c) => c.status === 'accepted' && c.sourceKind === 'founder_answer' && c.sourceRef?.startsWith('gap:'))
      .map((c) => (c.sourceRef as string).slice('gap:'.length)),
  );

  let analysis: unknown = null;
  if (await blueprintAnalysesAvailable()) {
    const { data } = await admin.from('blueprint_analyses')
      .select('id, status, started_at, completed_at, questions_asked')
      .eq('org_id', orgId).order('started_at', { ascending: false }).limit(1).maybeSingle();
    analysis = data ?? null;
  }

  // Prompt 311 §C — recomputado a cada GET (nunca persistido: fica sempre
  // coerente com o estado actual dos claims, e não precisa de migração
  // nenhuma). Só claims PROPOSTOS são candidatos — um já aceite é uma
  // decisão tomada, não algo a reconciliar contra outra coisa.
  const claimsWithDuplicates = claims.map((c) => (
    c.status === 'proposed' ? { ...c, possibleDuplicateOf: findDuplicateCandidate(c, claims) } : c
  ));

  return NextResponse.json({
    available: true,
    analysesAvailable: await blueprintAnalysesAvailable(),
    claims: claimsWithDuplicates,
    gaps: gaps
      .filter((g) => !answeredRules.has(gapKey(g)))
      .map((g) => ({ ...g, key: gapKey(g), prompt: templateFor(g) })),
    analysis,
  });
}

// POST — arranca uma análise: ingere as fontes, propõe os claims novos.
// Idempotente no que importa: um átomo já aceite ou já rejeitado não volta
// a ser proposto (newAtoms), e um proposto que ainda lá esteja também não
// duplica, porque a comparação é sobre TODOS os claims existentes.
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

  const orgId = await resolveOrg(sb, user.id);
  if (!orgId) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // A análise só existe se a 0179 estiver aplicada; sem ela a ingestão
  // funciona na mesma (os claims são o que interessa), apenas sem registo
  // do interrogatório. Degradar, nunca 500.
  let analysisId: string | null = null;
  if (await blueprintAnalysesAvailable()) {
    const { data } = await admin.from('blueprint_analyses')
      .insert({ org_id: orgId, created_by: user.id, status: 'in_progress' }).select('id').maybeSingle();
    analysisId = (data?.id as string | undefined) ?? null;
  }

  const [sources, existing] = await Promise.all([
    readKnowledgeSources(admin, orgId),
    readExistingClaims(admin, orgId),
  ]);
  const atoms = newAtoms(knowledgeToAtoms(sources), existing);

  if (atoms.length > 0) {
    const rows = atoms.map((a) => {
      const n = normalizeAtom(a);
      return {
        org_id: orgId, category: n.category, statement: n.statement,
        evidence_class: n.evidenceClass, specificity: n.specificity,
        source_kind: n.sourceKind, source_ref: n.sourceRef ?? null,
        status: 'proposed', analysis_id: analysisId,
      };
    });
    const { error } = await admin.from('company_claims').insert(rows);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, proposed: atoms.length, analysisId });
}
