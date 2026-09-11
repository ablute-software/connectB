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
import { useDormantConfirmation } from '@/lib/use-dormant-confirmation';
import { useConfirm } from '@/lib/confirm';

const KIND_LABEL: Record<ActionItem['kind'], string> = {
  interest_request: 'Investor interest',
  unread_message: 'Messages',
  access_request: 'Data-room access requests',
  unclassified_reply: 'Replies to classify',
  overdue_revisit: 'Frozen — revisit overdue',
  dormant_confirmation: 'Dormant decisions',
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
        g.kind === 'dormant_confirmation'
          ? <DormantConfirmationCard key={g.kind} items={g.items} />
          : (
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
          )
      ))}
    </div>
  );
}

// Prompt 883 §4 — genuinely new UI, scoped to this one ActionItem kind only
// (the panel above has zero other multi-select machinery, and this prompt
// doesn't ask to retrofit it). Per-row checkboxes + select-all, plus a bulk
// Confirm/Decline/Dismiss toolbar that appears once 2+ rows are checked;
// each row also keeps its own inline buttons (same pattern this file
// already uses for interest_request) so a single pending item is never
// stranded without a way to act on it.
// §4 — "keep the existing one-line confirmation step before an action with
// a real effect fires — even in bulk". Confirm and Decline both change the
// entity's future (status, or the automation's suppression window); Dismiss
// never asks, per the prompt's own exemption ("Dismiss... doesn't need one").
function confirmMessage(action: 'confirm' | 'decline', count: number): string {
  const who = count === 1 ? 'this investor' : `${count} investors`;
  return action === 'confirm'
    ? `Mark ${who} dormant? This will be recorded in ${count === 1 ? 'its' : 'each one\'s'} history.`
    : `Decline and keep ${who} as is — no reply after the follow-up? Sherlock won't ask about ${count === 1 ? 'this one' : 'these'} again for 6 months, unless something changes.`;
}

function DormantConfirmationCard({ items }: { items: ActionItem[] }) {
  const { confirmDormant, declineDormant, dismissDormant } = useDormantConfirmation();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  function toggleOne(key: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === items.length ? new Set() : new Set(items.map((i) => i.key))));
  }

  async function runOne(item: ActionItem, action: 'confirm' | 'decline' | 'dismiss') {
    const taskId = item.taskId, entityId = item.entityId;
    if (!taskId || !entityId) return;
    if (action === 'confirm' || action === 'decline') {
      if (!(await confirm({ message: confirmMessage(action, 1) }))) return;
    }
    setBusy((b) => new Set(b).add(item.key));
    try {
      const target = { taskId, entityId };
      if (action === 'confirm') confirmDormant(target);
      else if (action === 'decline') declineDormant(target);
      else dismissDormant(target);
      setSelected((s) => { const next = new Set(s); next.delete(item.key); return next; });
    } finally {
      setBusy((b) => { const next = new Set(b); next.delete(item.key); return next; });
    }
  }

  async function runBulk(action: 'confirm' | 'decline' | 'dismiss') {
    const targets = items.filter((i) => selected.has(i.key));
    if (targets.length === 0) return;
    if (action === 'confirm' || action === 'decline') {
      if (!(await confirm({ message: confirmMessage(action, targets.length) }))) return;
    }
    setBusy((b) => new Set([...b, ...targets.map((t) => t.key)]));
    try {
      for (const item of targets) {
        if (!item.taskId || !item.entityId) continue;
        const target = { taskId: item.taskId, entityId: item.entityId };
        if (action === 'confirm') confirmDormant(target);
        else if (action === 'decline') declineDormant(target);
        else dismissDormant(target);
      }
      setSelected(new Set());
    } finally {
      setBusy((b) => { const next = new Set(b); for (const t of targets) next.delete(t.key); return next; });
    }
  }

  return (
    <Card title={
      <span className="flex flex-wrap items-center gap-2">
        <span>{KIND_LABEL.dormant_confirmation} ({items.length})</span>
        {selected.size >= 2 && (
          <span className="flex items-center gap-1.5">
            <button onClick={() => runBulk('confirm')} className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">Confirm ({selected.size})</button>
            <button onClick={() => runBulk('decline')} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Decline ({selected.size})</button>
            <button onClick={() => runBulk('dismiss')} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Dismiss ({selected.size})</button>
          </span>
        )}
      </span>
    }>
      <ul className="divide-y divide-gray-100">
        <li className="flex items-center gap-2 py-1 text-xs text-gray-400">
          <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
          <span>Select all</span>
        </li>
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggleOne(item.key)} disabled={busy.has(item.key)} />
            <span className="flex-1">
              <span className="text-gray-800">{item.label}</span>
              {item.entityHref && (
                <Link href={item.entityHref} className="ml-1.5 text-xs text-[#0E7490] hover:underline">view investor →</Link>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => runOne(item, 'confirm')} disabled={busy.has(item.key)}
                className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Confirm</button>
              <button onClick={() => runOne(item, 'decline')} disabled={busy.has(item.key)}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Decline</button>
              <button onClick={() => runOne(item, 'dismiss')} disabled={busy.has(item.key)}
                className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Dismiss</button>
            </span>
            <span className="shrink-0 text-xs text-gray-400">{fmtDate(item.at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
