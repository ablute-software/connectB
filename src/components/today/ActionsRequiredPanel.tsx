'use client';
// Prompt 216 §C — o separador "Actions required" do FOUNDER: tudo o que
// está pendente, num sítio só, cada item clicável para onde se age (regra
// 1) ou acionável inline (interesse de investidor — o caso que o Nuno
// viveu: recebido e sem sítio único onde agir).
//
// Zero estado novo (regra 3): interesse pendente vem do hook do 220 §A,
// threads não lidas de /api/founder/messages, access requests de
// /api/data-room/access-requests, replies por classificar e revisits
// vencidas do próprio store. A montagem (e a contagem do badge) é a função
// pura founderActionsRequired — o badge do separador usa a MESMA chamada,
// por isso nunca discordam.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { founderActionsRequired, type ActionItem } from '@/lib/actions-required';
import { useInterestRequests, decideInterestRequest } from '@/lib/interest-requests-client';

const KIND_LABEL: Record<ActionItem['kind'], string> = {
  interest_request: 'Investor interest',
  unread_message: 'Messages',
  access_request: 'Data-room access requests',
  unclassified_reply: 'Replies to classify',
  overdue_revisit: 'Parked — revisit overdue',
};

function fmtDate(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
}

// Partilhado entre a página /tasks (badge do separador) e o painel (lista):
// uma única montagem, dois consumidores.
export function useFounderActions() {
  const { db } = useStore();
  const interestRequests = useInterestRequests();
  const [threads, setThreads] = useState<{ threadId: string; investorName: string; lastMessageAt: string; unread: boolean }[]>([]);
  const [accessRequests, setAccessRequests] = useState<{ id: string; requesterName: string | null; requestedAt: string }[]>([]);

  useEffect(() => {
    fetch('/api/founder/messages').then((r) => r.json())
      .then((d) => setThreads(d.threads ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!db.org.id) return;
    fetch(`/api/data-room/access-requests?orgId=${encodeURIComponent(db.org.id)}`).then((r) => r.json())
      .then((d) => setAccessRequests((d.requests ?? []).map((r: { id: string; requesterName: string | null; requesterEmail?: string | null; requestedAt: string }) => ({
        id: r.id, requesterName: r.requesterName ?? r.requesterEmail ?? null, requestedAt: r.requestedAt,
      })))).catch(() => {});
  }, [db.org.id]);

  const unclassifiedReplies = db.interactions
    .filter((i) => i.direction === 'in' && (!i.classification || i.classification === 'unclear'))
    .map((i) => ({
      id: i.id, entityId: i.entity_id,
      entityName: db.entities.find((e) => e.id === i.entity_id)?.name ?? null,
      excerpt: i.content.slice(0, 70), at: i.occurred_at,
    }));

  return founderActionsRequired({
    pendingInterest: interestRequests.filter((r) => r.status === 'pending')
      .map((r) => ({ id: r.id, investorName: r.investorName, requestedAt: r.requestedAt, entityId: r.entityId })),
    unreadThreads: threads,
    pendingAccessRequests: accessRequests,
    unclassifiedReplies,
    tasks: db.tasks,
    now: new Date(),
  });
}

export function ActionsRequiredPanel({ actions }: { actions: ReturnType<typeof useFounderActions> }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(requestId: string, decision: 'granted' | 'denied') {
    setBusyId(requestId);
    try {
      // O evento do helper faz o hook (e o badge da Pipeline do 220 §A)
      // re-verificar — o item sai da lista sem reload.
      await decideInterestRequest(requestId, decision);
    } finally { setBusyId(null); }
  }

  if (actions.count === 0) {
    return (
      <Card title="Actions required">
        <p className="text-sm text-gray-400">Nothing needs your action right now.</p>
      </Card>
    );
  }

  // Agrupar por tipo preservando a ordem de urgência da montagem pura.
  const groups: { kind: ActionItem['kind']; items: ActionItem[] }[] = [];
  for (const item of actions.items) {
    const g = groups.find((x) => x.kind === item.kind);
    if (g) g.items.push(item); else groups.push({ kind: item.kind, items: [item] });
  }

  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g.kind} title={`${KIND_LABEL[g.kind]} (${g.items.length})`}>
          <ul className="divide-y divide-gray-100">
            {g.items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2 text-sm">
                <span className="flex-1">
                  {item.href ? (
                    <Link href={item.href} className="text-gray-800 hover:text-[#0E7490] hover:underline">{item.label}</Link>
                  ) : (
                    <span className="text-gray-800">{item.label}</span>
                  )}
                  {item.detail && <span className="ml-1.5 text-xs text-gray-400">“{item.detail}…”</span>}
                  {item.entityHref && (
                    <Link href={item.entityHref} className="ml-1.5 text-xs text-[#0E7490] hover:underline">view investor →</Link>
                  )}
                </span>
                {item.kind === 'interest_request' && item.requestId && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => decide(item.requestId!, 'granted')} disabled={busyId === item.requestId}
                      className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Approve</button>
                    <button onClick={() => decide(item.requestId!, 'denied')} disabled={busyId === item.requestId}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Deny</button>
                  </span>
                )}
                <span className="shrink-0 text-xs text-gray-400">{fmtDate(item.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
