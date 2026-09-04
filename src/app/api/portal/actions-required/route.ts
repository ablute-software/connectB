// Prompt 216 §C — o agregado "Actions required" do INVESTIDOR. Uma rota,
// quatro fontes, TODAS dados do próprio investidor (§A é requisito de
// aceitação): as threads dele (deal_threads, unread pelo
// investor_last_read_at dele), os grants dele (NDAs por assinar), os
// document_views dele (documentos a que tem acesso e nunca abriu) e os
// access_requests dele (respondidos por ver — marcador da migração 0178).
// Nada do CRM do founder é lido aqui; org name é o único campo de orgs.
//
// As decisões pendentes NÃO vêm daqui: a elegibilidade do pipeline
// (published ∪ grants ∪ decididos, waves, caps) já vive em
// /api/portal/pipeline e o cliente reutiliza esse endpoint — re-derivar
// aqui seria a segunda cópia de uma lógica que só pode divergir.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { activeGrantsForFirm, visibleDocumentsForFirm } from '@/lib/data-room-server';
import { unlockedGrants } from '@/lib/data-room';
import { assertNotViewer } from '@/lib/developer-viewer';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const empty = { unreadThreads: [], ndaPending: [], respondedAccessRequests: [], newDocs: [] };
  if (!url || !serviceKey) return NextResponse.json(empty, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, user.id);

  // 1. Threads não lidas — pelo investor_last_read_at DELE.
  let unreadThreads: { orgId: string; lastMessageAt: string }[] = [];
  if (investorCatalogEntityId) {
    const { data: threads } = await admin.from('deal_threads')
      .select('startup_org_id, last_message_at, investor_last_read_at')
      .eq('investor_catalog_entity_id', investorCatalogEntityId).not('last_message_at', 'is', null);
    unreadThreads = (threads ?? [])
      .filter((t) => !t.investor_last_read_at || (t.investor_last_read_at as string) < (t.last_message_at as string))
      .map((t) => ({ orgId: t.startup_org_id as string, lastMessageAt: t.last_message_at as string }));
  }

  // 2/4. Orgs com grants ativos (por email/convite confirmado) — a base
  // para NDAs pendentes e para documentos nunca abertos.
  const { data: grantOrgRows } = await admin.from('access_grants').select('org_id').is('revoked_at', null)
    .or([`grantee_email.eq.${email}`, `invited_email.eq.${email}`].join(','));
  const grantOrgIds = [...new Set((grantOrgRows ?? []).map((g) => g.org_id as string))];

  const ndaPending: { orgId: string; count: number }[] = [];
  // Prompt 560 §C — the id of the first document this investor has not
  // opened, so the action can point at the row instead of the tab.
  const newDocs: { orgId: string; count: number; firstUnseenDocId: string | null }[] = [];
  for (const orgId of grantOrgIds) {
    const grants = await activeGrantsForFirm(admin, orgId, email);
    if (grants.length === 0) continue;
    const locked = grants.length - unlockedGrants(grants).length;
    if (locked > 0) ndaPending.push({ orgId, count: locked });

    const visible = await visibleDocumentsForFirm(admin, orgId, email);
    if (visible.length > 0) {
      const { data: views } = await admin.from('document_views')
        .select('document_id').eq('org_id', orgId).eq('viewer_email', email);
      const viewed = new Set((views ?? []).map((v) => v.document_id as string));
      const unseen = visible.filter((d) => !viewed.has(d.id));
      if (unseen.length > 0) newDocs.push({ orgId, count: unseen.length, firstUnseenDocId: unseen[0].id ?? null });
    }
  }

  // 3. Access requests respondidos por ver. A coluna
  // investor_seen_response_at é da migração 0178 (PROPOSTA) — antes de
  // aplicada, o select falha e degrada para [] em vez de 500, a mesma
  // convenção de todas as tabelas capability-gated.
  const requesterOr = [`requested_email.eq.${email}`];
  if (person) requesterOr.push(`person_id.eq.${person.id}`);
  let respondedAccessRequests: { id: string; orgId: string; status: 'granted' | 'declined'; respondedAt: string }[] = [];
  const { data: reqRows, error: reqError } = await admin.from('access_requests')
    .select('id, org_id, status, responded_at, investor_seen_response_at')
    .neq('status', 'pending').not('responded_at', 'is', null).is('investor_seen_response_at', null)
    .or(requesterOr.join(','));
  if (!reqError) {
    respondedAccessRequests = (reqRows ?? []).map((r) => ({
      id: r.id as string, orgId: r.org_id as string,
      status: r.status as 'granted' | 'declined', respondedAt: r.responded_at as string,
    }));
  }

  // Nomes das orgs — o único campo lido de orgs.
  const orgIds = [...new Set([
    ...unreadThreads.map((t) => t.orgId), ...ndaPending.map((n) => n.orgId),
    ...newDocs.map((d) => d.orgId), ...respondedAccessRequests.map((r) => r.orgId),
  ])];
  const { data: orgs } = orgIds.length
    ? await admin.from('orgs').select('id, name').in('id', orgIds)
    : { data: [] as { id: string; name: string }[] };
  const nameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const named = (orgId: string) => nameById.get(orgId) ?? 'A startup';

  return NextResponse.json({
    unreadThreads: unreadThreads.map((t) => ({ ...t, orgName: named(t.orgId) })),
    ndaPending: ndaPending.map((n) => ({ ...n, orgName: named(n.orgId) })),
    newDocs: newDocs.map((d) => ({ ...d, orgName: named(d.orgId) })),
    respondedAccessRequests: respondedAccessRequests.map((r) => ({ ...r, orgName: named(r.orgId) })),
  });
}

// POST {ackAccessResponses: true} — marca os pedidos respondidos deste
// investidor como vistos (regra 2: o badge limpa quando os itens são
// vistos). Só toca nas linhas DELE (mesmo match person/email do GET).
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ ok: false, error: 'Sign in first.' }, { status: 401 });

  const viewerBlock = await assertNotViewer(sb, req);
  if (viewerBlock) return viewerBlock;

  const body = await req.json().catch(() => ({})) as { ackAccessResponses?: boolean };
  if (!body.ackAccessResponses) return NextResponse.json({ ok: false, error: 'Nothing to acknowledge.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: person } = await admin.from('people').select('id').eq('email_verified', email).maybeSingle();
  const requesterOr = [`requested_email.eq.${email}`];
  if (person) requesterOr.push(`person_id.eq.${person.id}`);

  // Pré-0178 a coluna não existe: o update falha e devolve-se ok:false
  // sem 500 — o cliente trata como "ainda não suportado".
  const { error } = await admin.from('access_requests')
    .update({ investor_seen_response_at: new Date().toISOString() })
    .neq('status', 'pending').is('investor_seen_response_at', null)
    .or(requesterOr.join(','));
  if (error) return NextResponse.json({ ok: false, error: 'not available yet' }, { status: 200 });
  return NextResponse.json({ ok: true });
}
