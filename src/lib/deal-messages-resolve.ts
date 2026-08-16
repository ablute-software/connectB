// Prompt 210 §A.4 — resolver os anexos das mensagens na leitura.
//
// Server-only (toca na base de dados com o cliente admin). A parte pura da
// combinação é o withDocumentInfo() em deal-messages.ts; isto é só a busca,
// nas duas variantes que existem — e são duas porque a pergunta "podes abrir
// isto?" é genuinamente diferente conforme quem lê:
//
//   founder  -> o documento é da minha org? (é dono da Vault)
//   investor -> resolveDocumentAccess completo: grants, NDA, subpastas
//               (204 §A) e due_diligence (204 a). Anexar NUNCA cria acesso.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withDocumentInfo, type DealMessage } from './deal-messages';
import { resolveDocumentAccess, type GrantLike } from './data-room';

function idsOf(messages: DealMessage[]): string[] {
  return [...new Set(messages.flatMap((m) => m.documentIds))];
}

async function namesFor(admin: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin.from('documents').select('id, name').in('id', ids).eq('org_id', orgId);
  return new Map((data ?? []).map((d) => [d.id as string, d.name as string]));
}

// Lado do founder: dono da Vault. Um documento que exista na org dele é
// acessível; um id de outra org (ou apagado) não é — e o nome nem sequer
// aparece, porque a query já filtra por org_id.
export async function resolveFounderMessageDocs(
  admin: SupabaseClient, orgId: string, messages: DealMessage[],
): Promise<DealMessage[]> {
  const names = await namesFor(admin, orgId, idsOf(messages));
  return withDocumentInfo(messages, names, new Set(names.keys()));
}

// Lado do investidor: o mesmo caminho com gate que o separador Documents
// usa, recomputado aqui em vez de confiar em que a escrita tenha validado —
// os grants mudam depois de a mensagem ser enviada (podem ser revogados, ou
// expirar), portanto "era acessível quando foi enviado" não responde a
// "posso abrir isto agora".
export async function resolveInvestorMessageDocs(
  admin: SupabaseClient, orgId: string, viewerEmail: string, messages: DealMessage[],
): Promise<DealMessage[]> {
  const ids = idsOf(messages);
  if (ids.length === 0) return withDocumentInfo(messages, new Map(), new Set());

  const names = await namesFor(admin, orgId, ids);

  const { data: grants } = await admin.from('access_grants').select('*').eq('org_id', orgId).is('revoked_at', null)
    .or([`grantee_email.eq.${viewerEmail}`, `invited_email.eq.${viewerEmail}`].join(','));
  const now = new Date();
  const activeGrants = ((grants ?? []) as unknown as (GrantLike & {
    expires_at?: string | null; invited_email?: string | null; confirmed_at?: string | null;
  })[]).filter((g) => (!g.expires_at || new Date(g.expires_at) > now) && (!g.invited_email || g.confirmed_at));

  const [{ data: docs }, { data: folders }] = await Promise.all([
    admin.from('documents').select('id, folder_id, visibility').in('id', ids).eq('org_id', orgId),
    admin.from('folders').select('id, parent_id').eq('org_id', orgId),
  ]);
  const folderTree = (folders ?? []).map((f) => ({
    id: f.id as string, parent_id: (f.parent_id as string | undefined) ?? undefined,
  }));
  // Sem descendantFolderIds: os candidatos vêm por id explícito (são os
  // anexos da mensagem), portanto não há query por pasta a expandir. A
  // ÁRVORE é que continua a ser precisa, para um grant de pasta cobrir
  // subpastas — mesma nota que o POST de /api/portal/messages já tinha.

  const { visibleIds } = resolveDocumentAccess(
    activeGrants,
    (docs ?? []).map((d) => ({
      id: d.id as string,
      folder_id: (d.folder_id as string | undefined) ?? undefined,
      visibility: d.visibility as string | undefined,
    })),
    folderTree,
  );

  return withDocumentInfo(messages, names, new Set(visibleIds));
}
