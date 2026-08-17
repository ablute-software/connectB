'use client';
// Prompt 216 §C — o separador "Actions required" do INVESTIDOR: mensagens
// por ler, NDAs por assinar, access requests respondidos por ver,
// documentos nunca abertos, decisões pendentes. Cada item é clicável e
// leva ao dossier da startup onde se age (regra 1).
//
// Fronteira §A: tudo aqui vem de /api/portal/actions-required (dados do
// próprio investidor) e de /api/portal/pipeline (a elegibilidade que ele
// já vê) — nada deriva do CRM do founder.
//
// Badge (regra 2, o mecanismo do bug 182): o shell chama useInvestorActions
// UMA vez e passa o resultado ao painel — badge e lista da mesma fonte.
// "Visto" para os access responses acontece quando o separador abre (o
// painel monta): o POST ack marca-os no servidor e o badge deixa de os
// contar, mas a lista mantém-nos visíveis nesta sessão (esmaecidos).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { investorActionsRequired, type InvestorActionItem, type InvestorActionsInput } from '@/lib/actions-required';

interface PipelineCard { orgId: string; name: string; status: 'open' | 'passed' | 'interested'; isArchived?: boolean }

const KIND_LABEL: Record<InvestorActionItem['kind'], string> = {
  unread_message: 'Messages to read',
  nda_pending: 'NDAs to sign',
  access_response: 'Access requests answered',
  new_documents: 'Documents you haven’t opened',
  pending_decision: 'Decisions pending',
};

function fmtDate(iso?: string) {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
}

export interface InvestorActions {
  items: InvestorActionItem[];
  count: number;
  respondedSeen: boolean;
  markResponsesSeen: () => void;
}

export function useInvestorActions(): InvestorActions {
  const [server, setServer] = useState<Omit<InvestorActionsInput, 'pendingDecisions'>>({
    unreadThreads: [], ndaPending: [], respondedAccessRequests: [], newDocs: [],
  });
  const [pendingDecisions, setPendingDecisions] = useState<{ orgId: string; orgName: string }[]>([]);
  const [respondedSeen, setRespondedSeen] = useState(false);

  useEffect(() => {
    fetch('/api/portal/actions-required').then((r) => r.json()).then((d) => setServer({
      unreadThreads: d.unreadThreads ?? [], ndaPending: d.ndaPending ?? [],
      respondedAccessRequests: d.respondedAccessRequests ?? [], newDocs: d.newDocs ?? [],
    })).catch(() => {});
    // Decisões pendentes: o MESMO endpoint que o separador Pipeline usa —
    // a elegibilidade (waves, caps, decididos) nunca é re-derivada aqui.
    fetch('/api/portal/pipeline').then((r) => r.json()).then((d) => {
      const cards: PipelineCard[] = (d.waves ?? [])
        .filter((w: { unlocked: boolean }) => w.unlocked)
        .flatMap((w: { items?: PipelineCard[] }) => w.items ?? []);
      setPendingDecisions(cards.filter((c) => c.status === 'open' && !c.isArchived)
        .map((c) => ({ orgId: c.orgId, orgName: c.name })));
    }).catch(() => {});
  }, []);

  const { items } = investorActionsRequired({ ...server, pendingDecisions });
  // Depois do ack, os access responses saem da CONTAGEM (o badge limpa ao
  // serem vistos) mas ficam na lista desta sessão.
  const count = items.length - (respondedSeen ? items.filter((i) => i.kind === 'access_response').length : 0);

  function markResponsesSeen() {
    if (respondedSeen || server.respondedAccessRequests.length === 0) return;
    setRespondedSeen(true);
    fetch('/api/portal/actions-required', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ackAccessResponses: true }),
    }).catch(() => {});
  }

  return { items, count, respondedSeen, markResponsesSeen };
}

export function InvestorActionsPanel({ actions }: { actions: InvestorActions }) {
  // Abrir o separador É ver os access responses respondidos (regra 2).
  useEffect(() => { actions.markResponsesSeen(); }, [actions]);

  if (actions.items.length === 0) {
    return (
      <Card title="Actions required">
        <p className="text-sm text-gray-400">Nothing needs your action right now.</p>
      </Card>
    );
  }

  const groups: { kind: InvestorActionItem['kind']; items: InvestorActionItem[] }[] = [];
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
                <Link href={item.href}
                  className={`flex-1 hover:text-[#0E7490] hover:underline ${
                    g.kind === 'access_response' && actions.respondedSeen ? 'text-gray-400' : 'text-gray-800'}`}>
                  {item.label}
                </Link>
                <span className="shrink-0 text-xs text-gray-400">{fmtDate(item.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
