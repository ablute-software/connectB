// Prompt 219 bloco 3 §4 (Prompt 223) — aceitar / editar / rejeitar um claim
// proposto. O mesmo padrão dos canon facts: nada entra em síntese nenhuma
// sem o founder confirmar.
//
// A regra que este ficheiro existe para garantir: `evidence_class` e
// `specificity` são DERIVADOS e nunca escritos à mão. Editar significa
// mandar texto novo e voltar a correr o normalizeAtom — se fosse possível
// editar a classe directamente, um founder podia promover a decoração a
// compromisso pago com um clique, e toda a hierarquia (que é a espinha da
// síntese) deixava de valer.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable } from '@/lib/blueprint-capability';
import { normalizeAtom } from '@/lib/company-claims';
import type { ClaimCategory, ClaimSourceKind } from '@/lib/types';

const CATEGORIES: ClaimCategory[] = [
  'problema', 'solucao', 'prova_tecnica', 'validacao_externa',
  'tracao_gtm', 'equipa', 'mercado_timing', 'funding', 'ask',
];

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
    id?: string; action?: 'accept' | 'reject' | 'edit'; statement?: string; category?: string;
  };
  if (!body.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });
  if (body.action !== 'accept' && body.action !== 'reject' && body.action !== 'edit') {
    return NextResponse.json({ ok: false, error: 'action must be accept, reject or edit.' }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: existing } = await admin.from('company_claims')
    .select('id, category, statement, source_kind').eq('id', body.id).eq('org_id', orgId).maybeSingle();
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

  const now = new Date().toISOString();

  if (body.action === 'edit') {
    const statement = body.statement?.trim();
    if (!statement) return NextResponse.json({ ok: false, error: 'A statement is required.' }, { status: 400 });

    // A categoria é editável e a classe/especificidade não. A distinção não
    // é arbitrária: a categoria é o RÓTULO da fonte (a ingestão adivinhou-a
    // a partir de company_facts.category, e adivinha para o lado fraco de
    // propósito), enquanto classe e especificidade são MEDIÇÕES sobre o
    // texto. Deixar corrigir o rótulo e não a medição é exactamente a
    // fronteira certa — e a categoria conta, porque as G-rules contam
    // claims por categoria (o G1 procura tracao_gtm).
    const category = (body.category && (CATEGORIES as string[]).includes(body.category)
      ? body.category : existing.category) as ClaimCategory;

    const n = normalizeAtom({ category, statement, sourceKind: existing.source_kind as ClaimSourceKind });
    const { error } = await admin.from('company_claims').update({
      statement: n.statement, category: n.category,
      evidence_class: n.evidenceClass, specificity: n.specificity,
      // Editar É aceitar: o founder acabou de rever a frase e reescrevê-la.
      status: 'accepted', updated_at: now,
    }).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, evidenceClass: n.evidenceClass, specificity: n.specificity });
  }

  const { error } = await admin.from('company_claims')
    .update({ status: body.action === 'accept' ? 'accepted' : 'rejected', updated_at: now })
    .eq('id', body.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
