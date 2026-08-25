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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { assertNotViewer } from '@/lib/developer-viewer';
import { claimsAvailable, strengthenDismissAvailable } from '@/lib/blueprint-capability';
import { normalizeAtom } from '@/lib/company-claims';
import { normalizeStatement } from '@/lib/company-knowledge';
import type { ClaimCategory, ClaimSourceKind } from '@/lib/types';

const CATEGORIES: ClaimCategory[] = [
  'problema', 'solucao', 'prova_tecnica', 'validacao_externa',
  'tracao_gtm', 'equipa', 'mercado_timing', 'funding', 'ask',
];

type Action = 'accept' | 'reject' | 'edit' | 'dismiss_strengthen' | 'undismiss_strengthen';
const ACTIONS: Action[] = ['accept', 'reject', 'edit', 'dismiss_strengthen', 'undismiss_strengthen'];

// Prompt 374 §E — "accepting a claim whose normalized text already matches
// an existing ACCEPTED claim doesn't create a second line." Same
// normalization as ingestion-time dedup (isAlreadyKnown/newAtoms,
// company-knowledge.ts) — reused, not reimplemented, so the two guards can
// never drift apart on what counts as "the same statement". Returns the id
// of the other, already-accepted row this one duplicates, or null.
async function findAcceptedDuplicate(
  admin: SupabaseClient, orgId: string, selfId: string, statement: string,
): Promise<string | null> {
  const { data } = await admin.from('company_claims')
    .select('id, statement').eq('org_id', orgId).eq('status', 'accepted').neq('id', selfId);
  const key = normalizeStatement(statement);
  const match = (data ?? []).find((c) => normalizeStatement(c.statement as string) === key);
  return (match?.id as string | undefined) ?? null;
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
    id?: string; ids?: string[]; action?: Action; statement?: string; category?: string;
  };
  if (!body.id && !(Array.isArray(body.ids) && body.ids.length > 0)) {
    return NextResponse.json({ ok: false, error: 'id or ids is required.' }, { status: 400 });
  }
  if (!body.action || !ACTIONS.includes(body.action)) {
    return NextResponse.json({ ok: false, error: `action must be one of: ${ACTIONS.join(', ')}.` }, { status: 400 });
  }

  const { data: member } = await sb.from('org_members').select('org_id').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'No organization.' }, { status: 403 });
  const orgId = member.org_id as string;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  // Prompt 374 §C — dismiss/undismiss never touch status or text, so bulk
  // and single-id share one path unlike edit (which is always one-at-a-time
  // below).
  if (body.action === 'dismiss_strengthen' || body.action === 'undismiss_strengthen') {
    if (!(await strengthenDismissAvailable())) return NextResponse.json({ ok: false, error: 'not configured' });
    const ids = body.id ? [body.id] : (body.ids ?? []);
    const { error } = await admin.from('company_claims')
      .update({ strengthen_dismissed_at: body.action === 'dismiss_strengthen' ? now : null })
      .in('id', ids).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Prompt 299 §1 — bulk accept/reject, trivial generalization of the same
  // UPDATE. Edit stays one-at-a-time (a single `id`): each claim has its own
  // text, there's no meaningful "bulk edit". ids takes priority over a
  // stray id+ids combination — the caller means the batch.
  if (Array.isArray(body.ids) && body.ids.length > 0 && body.action !== 'edit') {
    if (body.action === 'accept') {
      // Prompt 374 §E — bulk-accept goes through the SAME duplicate guard as
      // single-accept below, one id at a time (bulk accept is rare — a
      // handful of ids at most — so N small lookups costs nothing next to
      // the alternative of a second, subtly different bulk-dedup query).
      const { data: candidates } = await admin.from('company_claims')
        .select('id, statement').in('id', body.ids).eq('org_id', orgId);
      for (const c of candidates ?? []) {
        const dupId = await findAcceptedDuplicate(admin, orgId, c.id as string, c.statement as string);
        await admin.from('company_claims')
          .update({ status: dupId ? 'rejected' : 'accepted', updated_at: now })
          .eq('id', c.id as string).eq('org_id', orgId);
      }
      return NextResponse.json({ ok: true, count: body.ids.length });
    }
    const { error } = await admin.from('company_claims')
      .update({ status: 'rejected', updated_at: now })
      .in('id', body.ids).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: body.ids.length });
  }

  const { data: existing } = await admin.from('company_claims')
    .select('id, category, statement, source_kind').eq('id', body.id).eq('org_id', orgId).maybeSingle();
  if (!existing) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });

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
    // Prompt 374 §E — the same acceptance-time duplicate guard applies to an
    // edit: "editing IS accepting" (see below), so a rewrite that happens to
    // land on text already covered by another accepted claim must not
    // create a second accepted row either.
    const dupId = await findAcceptedDuplicate(admin, orgId, body.id as string, n.statement);
    const { error } = await admin.from('company_claims').update({
      statement: n.statement, category: n.category,
      evidence_class: n.evidenceClass, specificity: n.specificity,
      // Editar É aceitar: o founder acabou de rever a frase e reescrevê-la.
      // A EXCEPÇÃO é já ser duplicado de outro claim aceite — nesse caso
      // fica rejeitado (nunca apagado), porque o facto já está coberto.
      status: dupId ? 'rejected' : 'accepted', updated_at: now,
    }).eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, evidenceClass: n.evidenceClass, specificity: n.specificity, supersededBy: dupId });
  }

  if (body.action === 'accept') {
    const dupId = await findAcceptedDuplicate(admin, orgId, body.id as string, existing.statement as string);
    const { error } = await admin.from('company_claims')
      .update({ status: dupId ? 'rejected' : 'accepted', updated_at: now })
      .eq('id', body.id).eq('org_id', orgId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, supersededBy: dupId });
  }

  const { error } = await admin.from('company_claims')
    .update({ status: 'rejected', updated_at: now })
    .eq('id', body.id).eq('org_id', orgId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
