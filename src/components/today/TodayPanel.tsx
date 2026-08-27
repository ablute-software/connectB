'use client';
// Today — the Next Best Action queue. Moved from src/app/today/page.tsx
// (formerly its own route) into the Today/Agenda separadores on /today —
// logic unchanged, only the export changed from a page default to a named
// panel.
import Link from 'next/link';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink, PersonLink, fmtRoundEur } from '@/components/ui';
import { outboundCounts } from '@/lib/rules';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL } from '@/lib/relationship';
import { PageTour } from '@/components/onboarding/PageTour';
import { useInterestRequests, decideInterestRequest } from '@/lib/interest-requests-client';
import type { ActionType } from '@/lib/types';
import { ReawakeningQueue } from '@/components/ReawakeningQueue';

// Prompt 398 §2 — exported so ReadyToContactPanel.tsx/ResearchNeededPanel.tsx
// (the two sections extracted out to their own top-level tabs) use the
// exact same pill, not a second copy.
export function ActionTypePill({ type }: { type: ActionType }) {
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[type]}`}>{ACTION_TYPE_LABEL[type]}</span>;
}

export function TodayPanel() {
  const { db, toggleTask } = useStore();
  // Prompt 220 §B — a task 'interest_level_request' existia mas o único
  // botão era o checkbox "done", que a marcava resolvida SEM decidir o
  // pedido: ficava pending para sempre, invisível em qualquer outro sítio.
  // Aqui liga-se a task ao pedido pendente (match por entity_id — a mesma
  // resolução catalog_deliveries que a criou) e o botão passa a ser
  // Approve/Deny no próprio endpoint POST. O servidor fecha a task ao
  // decidir (decideInterestLevel3); o toggleTask local é só para o UI
  // refletir já, sem esperar reload (persistir done=true é idempotente).
  const interestRequests = useInterestRequests();
  const pendingInterestByEntity = new Map(
    interestRequests.filter((r) => r.status === 'pending' && r.entityId).map((r) => [r.entityId as string, r]));
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  async function decideInterest(taskId: string, requestId: string, decision: 'granted' | 'denied') {
    setBusyTaskId(taskId);
    try {
      await decideInterestRequest(requestId, decision);
      toggleTask(taskId);
    } finally { setBusyTaskId(null); }
  }
  // Prompt 398 §1 — a checkbox click can be a mis-click, and toggleTask is
  // already reversible, but the founder had no way to know that. Same
  // pattern as RelationshipSummaryCard's stage-change undo: local state,
  // 10s auto-clear, last-one-wins (no queue). Interest-request tasks are
  // the one exception (§1.2) — their decision hits the server
  // (decideInterestRequest) and reverting locally would lie about that, so
  // they keep calling toggleTask directly via decideInterest above, never
  // this.
  const [undoable, setUndoable] = useState<{ taskId: string; label: string } | null>(null);
  function completeTask(taskId: string, label: string) {
    toggleTask(taskId);
    setUndoable({ taskId, label });
    window.setTimeout(() => setUndoable((u) => (u?.taskId === taskId ? null : u)), 10_000);
  }
  const now = new Date();
  const caps = outboundCounts(db);

  const overdue = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < now && t.kind !== 'research')
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  const unclassified = db.interactions.filter((i) => i.direction === 'in' && (!i.classification || i.classification === 'unclear'));
  const thisWeek = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) >= now
    && new Date(t.due_at) < new Date(now.getTime() + 7 * 24 * 3600 * 1000))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '')).slice(0, 6);
  // P106 §3 — see OverviewPanel.tsx's identical fix for the full rationale.
  const roundTarget = db.org.round_target_eur;
  const roundSecured = db.org.round_secured_eur ?? 0;
  const roundPct = roundTarget ? Math.min(100, (roundSecured / roundTarget) * 100) : 0;
  const activeConvos = db.entities.filter((e) => ['in_conversation', 'diligence'].includes(e.status)).length;

  // "Follow-ups on time" — of the follow-ups still open right now, what %
  // aren't overdue. No completed_at field exists to measure "was it done
  // before its deadline" retroactively, so this is a live snapshot (are
  // your CURRENT follow-ups on schedule), not a historical on-time rate —
  // the honest metric the real data actually supports.
  const openFollowUps = db.tasks.filter((t) => t.kind === 'follow_up' && t.due_at && !t.done);
  const followUpsOnTime = openFollowUps.filter((t) => new Date(t.due_at!) >= now);
  const followUpsOnTimePct = openFollowUps.length ? Math.round((followUpsOnTime.length / openFollowUps.length) * 100) : 100;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <PageTour pageKey="guide_today" />
      <div className="space-y-4 lg:col-span-2">
        <div data-tour-id="today-header" className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Today</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{now.toISOString().slice(0, 10)}</span>
          </div>
        </div>

        {undoable && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span>Task completed — {undoable.label}</span>
            <button onClick={() => { toggleTask(undoable.taskId); setUndoable(null); }}
              className="font-semibold text-[#0E7490] hover:underline">
              Undo
            </button>
          </div>
        )}

        {/* Prompt 251/253 Bloco C — the exact same queue Pipeline already
            shows, mounted here too: a cleared rejection_code is a
            "today" signal, not something the founder should only find
            by visiting Pipeline. Self-contained (own fetch, own store
            read) — no new logic, just a second place it renders. */}
        <ReawakeningQueue />

        <Card title={<span className="text-[#B00000]">Overdue ({overdue.length})</span>}>
          {overdue.length === 0 ? <p className="text-sm text-gray-400">Nothing overdue.</p> : (
            <ul className="divide-y divide-gray-100">
              {overdue.map((t) => {
                // §B — sem pedido pendente correspondente (já decidido
                // noutro sítio, ou task órfã), cai no checkbox normal para
                // continuar fechável à mão.
                const interestReq = t.source === 'interest_level_request' && t.entity_id
                  ? pendingInterestByEntity.get(t.entity_id) : undefined;
                return (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  {!interestReq && <input type="checkbox" checked={false} onChange={() => completeTask(t.id, t.title)} />}
                  <ActionTypePill type={t.action_type} />
                  <span className="flex-1">{t.title}
                    {t.entity_id && <> — <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></>}
                  </span>
                  {interestReq ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button onClick={() => decideInterest(t.id, interestReq.id, 'granted')} disabled={busyTaskId === t.id}
                        className="rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">Approve</button>
                      <button onClick={() => decideInterest(t.id, interestReq.id, 'denied')} disabled={busyTaskId === t.id}
                        className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">Deny</button>
                    </span>
                  ) : (
                    <span className="font-semibold text-[#B00000]">{t.due_at?.slice(0, 10)}</span>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={<span className="text-amber-700">Unclassified replies ({unclassified.length})</span>}>
          {unclassified.length === 0 ? <p className="text-sm text-gray-400">Inbox clear.</p> : (
            <ul className="divide-y divide-gray-100">
              {unclassified.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    {i.person_id && <PersonLink id={i.person_id}>{db.people.find((p) => p.id === i.person_id)?.full_name}</PersonLink>}
                    {' — '}<span className="text-gray-500">“{i.content.slice(0, 70)}…”</span>
                  </span>
                  <Link href={`/entities/${i.entity_id}`} className="rounded border border-gray-300 px-2 py-1 text-xs">Classify</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

      </div>

      <div className="space-y-4">
        <div data-tour-id="today-discipline">
        <Card title="Outreach discipline">
          <div className="space-y-3">
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-gray-600">Today&apos;s outreach</span>
                <span className="text-gray-500">{caps.today} / {caps.dailyCap}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-gray-100">
                <div className={`h-full ${caps.today >= caps.dailyCap ? 'bg-[#B00000]' : 'bg-[#0E7490]'}`}
                  style={{ width: `${Math.min(100, (caps.today / caps.dailyCap) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-gray-600">This week</span>
                <span className="text-gray-500">{caps.week} / {caps.weeklyCap}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-gray-100">
                <div className={`h-full ${caps.week >= caps.weeklyCap ? 'bg-[#B00000]' : 'bg-[#0E7490]'}`}
                  style={{ width: `${Math.min(100, (caps.week / caps.weeklyCap) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-gray-600">Follow-ups on time</span>
                <span className="text-gray-500">{followUpsOnTimePct}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded bg-gray-100">
                <div className={`h-full ${followUpsOnTimePct < 70 ? 'bg-amber-500' : 'bg-green-600'}`}
                  style={{ width: `${followUpsOnTimePct}%` }} />
              </div>
            </div>
          </div>
        </Card>
        </div>

        <Card title="Round progress" tint="blue">
          {roundTarget ? (
            <>
              <div className="text-2xl font-bold text-[#0E7490]">{fmtRoundEur(roundSecured)} <span className="text-sm font-normal text-gray-500">/ {fmtRoundEur(roundTarget)}</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded bg-white">
                <div className="h-full bg-[#0E7490]" style={{ width: `${roundPct}%` }} />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              Complete your round target to track your fundraising progress.{' '}
              <Link href="/settings#settings-round" className="font-medium text-[#0E7490] hover:underline">Set it in About</Link>.
            </p>
          )}
          <div className="mt-2 text-xs text-gray-500">{activeConvos} active conversation(s) · benchmark: a seed closes on 15–40.</div>
        </Card>
        <Card title="This week">
          {thisWeek.length === 0 ? <p className="text-sm text-gray-400">Nothing scheduled.</p> : (
            <ul className="space-y-1.5 text-sm">
              {thisWeek.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <ActionTypePill type={t.action_type} />
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-gray-400">{t.due_at?.slice(5, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
