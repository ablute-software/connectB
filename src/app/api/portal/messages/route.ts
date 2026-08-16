// P134-C — investor side of Sherlock messaging. GET returns the thread for
// one startup (creating nothing — a thread only exists once someone has
// actually sent a message); POST sends one. Relationship-gated per R2:
// an investor may only message a startup once a real relationship exists
// (interest expressed OR an active data-room grant) — a pure "discovery"
// card (published profile, no grant/decision yet) gets a 403, same
// consent-based boundary P132-A already draws elsewhere in this workspace.
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '@/lib/supabase-server';
import { getPipelineWaves } from '@/lib/investor-pipeline';
import { resolveInvestorCatalogEntityId } from '@/lib/portal-access';
import { dealMessagesAvailable } from '@/lib/deal-messages-capability';
import { findThread, getOrCreateThread, getThreadMessages, postMessage, markThreadRead, canInvestorMessage } from '@/lib/deal-messages';
import { resolveInvestorMessageDocs } from '@/lib/deal-messages-resolve';
import { descendantFolderIds, resolveDocumentAccess, type GrantLike } from '@/lib/data-room';
import { assertNotViewer } from '@/lib/developer-viewer';
import { resendConfigured, sendTransactionalEmail, transactionalTemplate } from '@/lib/resend';

async function resolveCardAndInvestorId(admin: SupabaseClient, sb: Awaited<ReturnType<typeof serverClient>>, userId: string, email: string, orgId: string) {
  const result = await getPipelineWaves(sb, admin, userId, email);
  const card = result.linked ? result.waves.flatMap((w) => w.items).find((c) => c.orgId === orgId) : null;
  const investorCatalogEntityId = await resolveInvestorCatalogEntityId(admin, userId);
  return { card, investorCatalogEntityId };
}

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: 'not configured' }, { status: 200 });

  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const orgId = new URL(req.url).searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId is required.' }, { status: 400 });

  if (!(await dealMessagesAvailable())) return NextResponse.json({ messages: [], canMessage: false });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { card, investorCatalogEntityId } = await resolveCardAndInvestorId(admin, sb, user.id, email, orgId);
  if (!card) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  if (!investorCatalogEntityId || !canInvestorMessage(card)) {
    return NextResponse.json({ messages: [], canMessage: false });
  }

  const thread = await findThread(admin, orgId, investorCatalogEntityId);
  if (!thread) return NextResponse.json({ messages: [], canMessage: true, founderLastReadAt: null });

  const raw = await getThreadMessages(admin, thread.id as string);
  // Prompt 210 §A.4 — recomputado AGORA, nao herdado da escrita: os grants
  // podem ter sido revogados ou expirado depois de a mensagem ser enviada.
  const messages = await resolveInvestorMessageDocs(admin, orgId, email, raw);
  await markThreadRead(admin, thread.id as string, 'investor');
  return NextResponse.json({ messages, canMessage: true, founderLastReadAt: thread.founder_last_read_at });
}

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

  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (isAbluteQa) return NextResponse.json({ ok: true, qa: true });

  if (!(await dealMessagesAvailable())) return NextResponse.json({ ok: false, error: 'not configured' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { orgId?: string; body?: string; links?: unknown; documentIds?: string[] };
  if (!body.orgId) return NextResponse.json({ ok: false, error: 'orgId is required.' }, { status: 400 });
  if (!body.body?.trim()) return NextResponse.json({ ok: false, error: 'Message can\'t be empty.' }, { status: 400 });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { card, investorCatalogEntityId } = await resolveCardAndInvestorId(admin, sb, user.id, email, body.orgId);
  if (!card) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  if (!investorCatalogEntityId || !canInvestorMessage(card)) {
    return NextResponse.json({ ok: false, error: 'No relationship with this startup yet.' }, { status: 403 });
  }

  // document_ids: only ever documents this firm already has grant-visibility
  // to — messages are never a channel for bypassing the data room. Same
  // resolveDocumentAccess() the Documents tab itself uses, recomputed here
  // rather than trusted from the client.
  const requestedDocIds = [...new Set(body.documentIds ?? [])];
  let allowedDocIds: string[] = [];
  if (requestedDocIds.length > 0) {
    const { data: grants } = await admin.from('access_grants').select('*').eq('org_id', body.orgId).is('revoked_at', null)
      .or([`grantee_email.eq.${email}`, `invited_email.eq.${email}`].join(','));
    const now = new Date();
    const activeGrants = ((grants ?? []) as unknown as (GrantLike & { expires_at?: string | null; invited_email?: string | null; confirmed_at?: string | null })[])
      .filter((g) => (!g.expires_at || new Date(g.expires_at) > now) && (!g.invited_email || g.confirmed_at));
    const { data: candidateDocs } = await admin.from('documents').select('id, folder_id, visibility').in('id', requestedDocIds).eq('org_id', body.orgId);
    // Prompt 204 §A — aqui os candidatos vem por id explicito (o cliente pede
    // documentos concretos), portanto nao ha query por pasta a expandir; falta
    // so a arvore para o grant de pasta poder cobrir subpastas.
    const { data: orgFolders } = await admin.from('folders').select('id, parent_id').eq('org_id', body.orgId);
    const folderTree = (orgFolders ?? []).map((f) => ({ id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined }));
    const { visibleIds } = resolveDocumentAccess(activeGrants, (candidateDocs ?? []).map((d) => ({ id: d.id as string, folder_id: (d.folder_id as string | undefined) ?? undefined, visibility: d.visibility as string | undefined })), folderTree);
    allowedDocIds = requestedDocIds.filter((id) => visibleIds.includes(id));
  }

  const thread = await getOrCreateThread(admin, body.orgId, investorCatalogEntityId);
  const { error } = await postMessage(admin, {
    threadId: thread.id as string, senderSide: 'investor', senderUserId: user.id,
    body: body.body, links: body.links, documentIds: allowedDocIds,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Founder notification — best-effort, same pattern as /api/portal/pipeline's
  // own express-interest notify (never undoes the message on a failed send).
  if (resendConfigured) {
    const { data: org } = await admin.from('orgs').select('name, sender_email').eq('id', body.orgId).single();
    const to = (org?.sender_email as string | null) ?? null;
    if (to) {
      const heading = 'New message on your Pipeline';
      const emailBody = `An investor sent you a new message about ${org?.name ?? 'your startup'}.`;
      try {
        await sendTransactionalEmail({
          to, subject: heading,
          html: transactionalTemplate({ heading, body: emailBody, ctaLabel: 'Reply in your workspace', ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/messages` }),
        });
      } catch { /* best-effort — the message itself is already recorded */ }
    }
  }

  return NextResponse.json({ ok: true });
}
