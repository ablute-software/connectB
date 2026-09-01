// Prompt 216 §C — "Actions required": tudo o que está pendente para quem
// abre o separador, montado como lista de itens CLICÁVEIS (regra 1 do
// prompt: cada item leva ao sítio onde se age, nunca é só texto).
//
// Este ficheiro é só a montagem pura (filtragem, rótulos, hrefs, contagem)
// — uma fonte para o badge do separador E para a lista, para nunca poderem
// discordar. Zero estado novo (regra 3): cada input deriva de tabelas que
// já existem; o fetch vive nos componentes/rotas.
//
// Fronteira §A: os assemblers são POR AUDIÊNCIA. O do founder recebe dados
// do founder; o do investidor (§C investidor) receberá apenas dados
// investor-visíveis. Nenhum item cruza a fronteira.
import type { TaskItem } from './types';
import { isRevisitTitle } from './exit-effects';
import { documentRequestHref } from './document-request-logic';

export interface ActionItem {
  key: string;
  kind: 'interest_request' | 'unread_message' | 'access_request' | 'unclassified_reply' | 'overdue_revisit';
  label: string;
  detail?: string;
  // Ausente só no interest_request — esse age INLINE (Approve/Deny no
  // próprio item, via decideInterestRequest); tem entityHref para contexto.
  href?: string;
  entityHref?: string;
  at?: string;
  // Só nos interest_request: o id do pedido, para o decide inline.
  requestId?: string;
}

export interface FounderActionsInput {
  pendingInterest: { id: string; investorName: string; requestedAt: string; entityId: string | null }[];
  unreadThreads: { threadId: string; investorName: string; lastMessageAt: string; unread: boolean }[];
  // Prompt 518 §1 — `href` added so an access request points at its own
  // review screen instead of the generic Vault. Optional so the many existing
  // callers/tests that never set it keep compiling and keep the old
  // behaviour; the two real producers (documents/page.tsx and
  // ActionsRequiredPanel) both set it now.
  pendingAccessRequests: { id: string; requesterName: string | null; requestedAt: string; href?: string }[];
  unclassifiedReplies: { id: string; entityId: string; entityName: string | null; excerpt: string; at: string }[];
  tasks: TaskItem[];
  now: Date;
}

export function overdueRevisitTasks(tasks: TaskItem[], now: Date): TaskItem[] {
  return tasks
    .filter((t) => !t.done && isRevisitTitle(t.title) && t.due_at && new Date(t.due_at) < now)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

export function founderActionsRequired(input: FounderActionsInput): { items: ActionItem[]; count: number } {
  const items: ActionItem[] = [];

  for (const r of input.pendingInterest) {
    items.push({
      key: `interest:${r.id}`, kind: 'interest_request', requestId: r.id,
      label: `${r.investorName} requested direct contact (level 3)`,
      at: r.requestedAt,
      entityHref: r.entityId ? `/entities/${r.entityId}` : undefined,
    });
  }

  for (const t of input.unreadThreads.filter((t) => t.unread)) {
    items.push({
      key: `thread:${t.threadId}`, kind: 'unread_message',
      label: `Unread message from ${t.investorName}`,
      at: t.lastMessageAt, href: '/messages',
    });
  }

  for (const r of input.pendingAccessRequests) {
    items.push({
      key: `access:${r.id}`, kind: 'access_request',
      label: `${r.requesterName ?? 'An investor'} requested data-room access`,
      // '/documents' was the whole complaint: it dropped the founder on the
      // Vault with no idea which request they were meant to answer. The
      // review screen for THIS request is the destination.
      at: r.requestedAt, href: r.href ?? documentRequestHref(r.id),
    });
  }

  for (const r of input.unclassifiedReplies) {
    items.push({
      key: `reply:${r.id}`, kind: 'unclassified_reply',
      label: `Reply to classify${r.entityName ? ` — ${r.entityName}` : ''}`,
      detail: r.excerpt, at: r.at, href: `/entities/${r.entityId}`,
    });
  }

  for (const t of overdueRevisitTasks(input.tasks, input.now)) {
    items.push({
      key: `revisit:${t.id}`, kind: 'overdue_revisit',
      label: t.title, at: t.due_at,
      href: t.entity_id ? `/entities/${t.entity_id}` : '/tasks?tab=today',
    });
  }

  // Mais recente primeiro dentro do mesmo tipo já vem dos inputs; a lista
  // final ordena por urgência de tipo (a ordem dos blocos acima) — decisões
  // de investidor à cabeça, exatamente o caso que motivou o prompt.
  return { items, count: items.length };
}

// ---------------------------------------------------------------------------
// Lado do INVESTIDOR (§C) — audiência separada, tipos separados: o input só
// admite dados do próprio investidor (threads dele, grants dele, pedidos
// dele, decisões dele). Nada do CRM do founder tem forma de entrar (§A).
export interface InvestorActionItem {
  key: string;
  kind: 'unread_message' | 'nda_pending' | 'access_response' | 'new_documents' | 'pending_decision';
  label: string;
  href: string; // regra 1: TODOS os itens do investidor levam a um sítio
  at?: string;
}

export interface InvestorActionsInput {
  unreadThreads: { orgId: string; orgName: string; lastMessageAt: string }[];
  ndaPending: { orgId: string; orgName: string; count: number }[];
  respondedAccessRequests: { id: string; orgId: string; orgName: string; status: 'granted' | 'declined'; respondedAt: string }[];
  newDocs: { orgId: string; orgName: string; count: number }[];
  pendingDecisions: { orgId: string; orgName: string }[];
}

export function investorActionsRequired(input: InvestorActionsInput): { items: InvestorActionItem[]; count: number } {
  const items: InvestorActionItem[] = [];

  for (const t of input.unreadThreads) {
    items.push({
      key: `thread:${t.orgId}`, kind: 'unread_message',
      label: `Unread message from ${t.orgName}`,
      at: t.lastMessageAt, href: `/portal/startup/${t.orgId}?tab=messages`,
    });
  }
  for (const n of input.ndaPending.filter((n) => n.count > 0)) {
    items.push({
      key: `nda:${n.orgId}`, kind: 'nda_pending',
      label: `NDA to sign for ${n.orgName} (${n.count} grant${n.count === 1 ? '' : 's'} waiting)`,
      href: `/portal/startup/${n.orgId}?tab=documents`,
    });
  }
  for (const r of input.respondedAccessRequests) {
    items.push({
      key: `access-response:${r.id}`, kind: 'access_response',
      label: `${r.orgName} ${r.status === 'granted' ? 'granted' : 'declined'} your access request`,
      at: r.respondedAt, href: `/portal/startup/${r.orgId}?tab=documents`,
    });
  }
  for (const d of input.newDocs.filter((d) => d.count > 0)) {
    items.push({
      key: `new-docs:${d.orgId}`, kind: 'new_documents',
      label: `${d.count} document${d.count === 1 ? '' : 's'} you haven't opened yet — ${d.orgName}`,
      href: `/portal/startup/${d.orgId}?tab=documents`,
    });
  }
  for (const p of input.pendingDecisions) {
    items.push({
      key: `decision:${p.orgId}`, kind: 'pending_decision',
      label: `Decision pending on ${p.orgName}`,
      href: `/portal/startup/${p.orgId}`,
    });
  }

  return { items, count: items.length };
}
