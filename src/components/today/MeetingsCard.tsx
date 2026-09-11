'use client';
// Prompt 884 — the Today redesign's Meetings card: date-grouped (Today /
// Tomorrow / +2 days) plus a "Missed" bucket for meetings whose due_at has
// already passed. Meetings live ONLY here, never in Overdue (today-cards.ts
// enforces that at the data layer) — a missed one is shown, not dropped.
//
// "Add meeting summary" is the ONLY way to close a meeting task — it deep-
// links into the entity's RailLogForm (?rail=log&channel=meeting&taskId=),
// which only marks the task done as a side effect of a real logged
// interaction actually being saved (entities/[id]/page.tsx's onSaved
// handler). This is deliberately not a checkbox — Prompt 883 already fixed
// the exact "checkbox closes a decision with no real action behind it" bug
// once for the dormant-confirmation task, and this redesign must not
// reintroduce that shape for meetings.
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/ui';
import { useStore } from '@/lib/store';
import { missedMeetings, upcomingMeetingGroups } from '@/lib/today-cards';
import type { Db, TaskItem } from '@/lib/types';

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function summaryHref(t: TaskItem): string {
  const params = new URLSearchParams({ rail: 'log', channel: 'meeting', taskId: t.id });
  if (t.person_id) params.set('person', t.person_id);
  return `/entities/${t.entity_id}?${params.toString()}`;
}

// Hoisted out of MeetingsCard (not a nested render-time definition) so React
// doesn't see a new component type — and therefore remount the whole
// subtree — on every parent render (react/no-unstable-nested-components).
function MeetingRow({ t, tone, db, updateTask }: {
  t: TaskItem; tone: 'missed' | 'today' | 'upcoming'; db: Pick<Db, 'entities'>;
  updateTask: ReturnType<typeof useStore>['updateTask'];
}) {
  const entityName = t.entity_id ? db.entities.find((e) => e.id === t.entity_id)?.name : undefined;
  const dot = tone === 'missed' ? 'bg-[#B00000]' : tone === 'today' ? 'bg-green-600' : 'bg-[#0E7490]';
  const pill = tone === 'missed'
    ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-[#B00000]">Missed</span>
    : tone === 'today'
      ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">Happening today</span>
      : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">Prepare for meeting</span>;
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="w-16 shrink-0 text-xs text-gray-400">{t.due_at ? fmtTime(t.due_at) : ''}</span>
      <span className="flex-1 truncate">
        {t.title}{entityName && <span className="text-gray-500"> — {entityName}</span>}
      </span>
      {pill}
      {tone === 'upcoming' ? (
        t.prepared_at ? (
          <span className="shrink-0 text-xs font-medium text-green-700">Prepared ✓</span>
        ) : (
          <button
            onClick={() => updateTask(t.id, { prepared_at: new Date().toISOString() })}
            className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">
            Mark prepared
          </button>
        )
      ) : (
        <Link href={summaryHref(t)}
          className="shrink-0 rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">
          Add meeting summary
        </Link>
      )}
    </li>
  );
}

export function MeetingsCard({ tasks, now }: { tasks: TaskItem[]; now: Date }) {
  const { db, updateTask } = useStore();
  const [collapsed, setCollapsed] = useState(false);
  const missed = missedMeetings(tasks, now);
  const groups = upcomingMeetingGroups(tasks, now);
  const total = missed.length + groups.reduce((n, g) => n + g.tasks.length, 0);

  return (
    <Card
      title={
        <button type="button" onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <span aria-hidden>📅</span> Meetings ({total})
          <span className="text-xs text-gray-400">{collapsed ? '▸' : '▾'}</span>
        </button>
      }
      right={<Link href="/agenda" className="text-xs font-medium text-[#0E7490] hover:underline">View calendar →</Link>}
    >
      {!collapsed && (
        <>
          <p className="mb-2 text-xs text-gray-500">Meetings today and preparation for the next 2 days.</p>
          {total === 0 ? <p className="text-sm text-gray-400">No meetings today or coming up.</p> : (
            <ul className="divide-y divide-gray-100">
              {missed.map((t) => <MeetingRow key={t.id} t={t} tone="missed" db={db} updateTask={updateTask} />)}
              {groups.map((g) => (
                <li key={g.label}>
                  <div className="pt-2 text-xs font-semibold text-gray-500">{g.label}</div>
                  <ul className="divide-y divide-gray-100">
                    {g.tasks.map((t) => (
                      <MeetingRow key={t.id} t={t} tone={g.label.startsWith('Today') ? 'today' : 'upcoming'} db={db} updateTask={updateTask} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
