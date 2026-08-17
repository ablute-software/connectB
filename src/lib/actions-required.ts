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
  pendingAccessRequests: { id: string; requesterName: string | null; requestedAt: string }[];
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
      at: r.requestedAt, href: '/documents',
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
