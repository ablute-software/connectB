// Prompt 503 §2 — apagar uma entrada do histórico de Readiness. O
// HistoryPanel era deliberadamente read-only ("Nothing here can be edited or
// re-sent"); o Nuno quer poder apagar, restrito a quem administra a conta.
//
// Gate SERVER-SIDE pela mesma matriz que a UI usa (permissions.ts), nunca só
// pelo botão escondido — um POST de quem não pode é recusado aqui,
// independentemente do que o cliente mostre. É a disciplina de todo o resto
// deste código (ver /api/org/update).
//
// HARD DELETE, decidido com medição e não por omissão: a única FK que aponta
// para estas duas tabelas é review_clarifications.review_run_id ->
// review_runs, e é ON DELETE CASCADE (verificado no schema real antes de
// decidir). Nada aponta para ai_reviews. Não há órfãos possíveis, e não há
// regra de produto que proteja um review do próprio founder sobre a própria
// startup — é dado dele, sobre a empresa dele, e o pedido é dele.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { can, type OrgRole } from '@/lib/permissions';
import { assertNotViewer } from '@/lib/developer-viewer';

const TABLES = ['ai_reviews', 'review_runs'] as const;
type HistoryTable = (typeof TABLES)[number];

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  // Um developer em "ver como" nunca apaga dados reais de outra pessoa.
  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const { data: member } = await sb.from('org_members').select('org_id, role').eq('user_id', user.id).maybeSingle();
  if (!member) return NextResponse.json({ ok: false, error: 'Not a member of any org.' }, { status: 403 });
  if (!can(member.role as OrgRole, 'delete_review_history')) {
    return NextResponse.json({ ok: false, error: 'Only the owner or an admin can delete history entries.' }, { status: 403 });
  }

  const { table, id } = await req.json().catch(() => ({})) as { table?: string; id?: string };
  if (!id || typeof id !== 'string') return NextResponse.json({ ok: false, error: 'Missing id.' }, { status: 400 });
  // Allow-list literal: o nome da tabela vem do cliente e nunca pode ser
  // interpolado a partir do que ele mandar.
  if (!table || !TABLES.includes(table as HistoryTable)) {
    return NextResponse.json({ ok: false, error: 'Invalid history entry.' }, { status: 400 });
  }

  const admin = createClient(url, service, { auth: { persistSession: false } });
  // O .eq('org_id') é o que impede apagar a linha de OUTRA org com um id
  // adivinhado — o service role passa por cima da RLS, portanto este scope
  // tem de ser explícito aqui.
  const { data: deleted, error } = await admin.from(table as HistoryTable)
    .delete().eq('id', id).eq('org_id', member.org_id as string).select('id');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Zero linhas = o id não existe OU é de outra org. As duas respondem igual,
  // de propósito: distingui-las diria a um atacante que o id existe algures.
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ ok: false, error: 'Entry not found.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
