'use client';
// Investor Workspace Agenda (Prompt 59) — merged timeline of meetings, round
// deadlines, and manual follow-ups.
//
// Prompt 247 B / 248 — grew from a flat timeline into the SAME calendar the
// founder side has: month grid, Overdue/Due today/This week/Completed rail
// (accordion per Prompt 246), and a create-task modal with hour+reminder —
// mirrored, not reimplemented independently: "Startup" replaces "Investor"
// as the linkable side, and the source is investor_tasks (migration 0182)
// through /api/portal/tasks instead of the founder's local store. The three
// EXISTING sources (meetings/deadlines/follow-ups via /api/portal/agenda,
// and the "Needs attention" signals via /api/portal/today) are untouched —
// agenda items merge into the same grid/rail as read-only entries (no
// checkbox, no edit modal; follow-ups keep their own existing "Done"
// action), tagged by a source discriminator so the two never get confused.
// The Startup select is fed by the SAME eligibleOrgIds() the timeline
// already uses (see /api/portal/tasks' GET) — never a broader query, per
// the root privacy rule checked in prompt 248.
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL, ACTION_TYPES } from '@/lib/relationship';
import { REMINDER_OPTIONS } from '@/lib/reminders';
import type { ActionType } from '@/lib/types';
import type { InvestorTaskItem } from '@/lib/investor-tasks';

interface AgendaItem {
  kind: 'meeting' | 'round_close' | 'follow_up';
  date: string; orgId: string; orgName: string; title: string; followupId?: string;
}
interface TodayItem { kind: string; title: string; orgId?: string }
interface Startup { id: string; name: string }

const KIND_ICON: Record<AgendaItem['kind'], string> = { meeting: '◔', round_close: '⏱', follow_up: '⚑' };
const TODAY_KIND_STYLE: Record<string, string> = {
  new_matches: 'text-[#0E7490]', qa_answered: 'text-green-700',
  round_closing: 'text-amber-700', followup_overdue: 'text-[#B00000]',
};

// A single row shape both sources (investor_tasks and the agenda feed) map
// into for the grid/rail — `source` is what keeps them from being treated
// as interchangeable further down (checkbox/click/edit only ever apply to
// 'task').
interface CalendarEntry {
  key: string;
  source: 'task' | 'agenda';
  title: string;
  date: string | null;
  done: boolean;
  actionType: ActionType;
  orgId: string | null;
  orgName: string | null;
  task?: InvestorTaskItem;
  agendaKind?: AgendaItem['kind'];
  followupId?: string;
}

function taskToEntry(t: InvestorTaskItem): CalendarEntry {
  return {
    key: `task-${t.id}`, source: 'task', title: t.title, date: t.due_at, done: t.done,
    actionType: t.action_type, orgId: t.orgId, orgName: t.orgName, task: t,
  };
}
function agendaToEntry(it: AgendaItem, i: number): CalendarEntry {
  return {
    key: `agenda-${it.kind}-${it.followupId ?? i}`, source: 'agenda', title: it.title, date: it.date,
    done: false, actionType: 'other', orgId: it.orgId, orgName: it.orgName,
    agendaKind: it.kind, followupId: it.followupId,
  };
}

function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Prompt 546 — hoisted out of InvestorAgendaPanel for the same reason as
// the Vault trees: a component declared inside another component's body is
// a new type on every render, so React remounts the whole list instead of
// re-rendering it. Caught by the lint rule Prompt 546 turned on.
function EntryRow({ e, markFollowupDone, toggleTaskDone, setSelectedTask }: {
  e: CalendarEntry;
  markFollowupDone: (id: string) => void;
  toggleTaskDone: (t: InvestorTaskItem) => void | Promise<void>;
  setSelectedTask: (t: InvestorTaskItem) => void;
}) {
  if (e.source === 'agenda') {
    return (
      <li className="flex items-start gap-2 rounded px-1">
        <span className="mt-0.5 text-sm">{KIND_ICON[e.agendaKind!]}</span>
        <span className="flex-1 text-sm text-gray-900">
          {e.title}
          {e.orgId && <span className="block text-xs"><Link href={`/portal/startup/${e.orgId}`} className="text-[#0E7490] hover:underline">{e.orgName}</Link></span>}
        </span>
        {e.agendaKind === 'follow_up' && e.followupId && (
          <button onClick={() => markFollowupDone(e.followupId!)} className="rounded-lg border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:border-[#0E7490]">Done</button>
        )}
        <span className="text-xs text-gray-400">{e.date?.slice(5, 10)}</span>
      </li>
    );
  }
  const t = e.task!;
  return (
    <li className={`flex items-start gap-2 rounded px-1 ${t.done ? 'bg-green-50' : ''}`}>
      <input type="checkbox" checked={t.done} onChange={() => toggleTaskDone(t)} className="mt-1" onClick={(ev) => ev.stopPropagation()} />
      <button onClick={() => setSelectedTask(t)} className="flex-1 text-left">
        <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[t.action_type]}`}>{ACTION_TYPE_LABEL[t.action_type]}</span>
        <span className={t.done ? 'text-green-700 line-through' : ''}>{t.done && '✓ '}{t.title}</span>
        {t.orgId && <span className="block text-xs"><Link href={`/portal/startup/${t.orgId}`} className="text-[#0E7490] hover:underline">{t.orgName}</Link></span>}
      </button>
      <span className="text-xs text-gray-400">{t.due_at?.slice(5, 10)}</span>
    </li>
  );
}

export function InvestorAgendaPanel() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  // Prompt 340 Block B — parity gap with the founder side's own type-filter
  // chips (AgendaPanel.tsx): agenda-sourced entries (meetings/round
  // closes/follow-ups) are always tagged 'other' by agendaToEntry, so they
  // only ever show up under the "All"/"Other" chips — same behavior as the
  // founder side treating any task without a finer action_type.
  const [typeFilter, setTypeFilter] = useState<ActionType | 'all'>('all');
  const [tasks, setTasks] = useState<InvestorTaskItem[] | null>(null);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[] | null>(null);
  const [todayItems, setTodayItems] = useState<TodayItem[] | null>(null);
  const [selectedTask, setSelectedTask] = useState<InvestorTaskItem | null>(null);
  // Prompt 246 — same exclusive accordion as the founder rail.
  const [openRailGroup, setOpenRailGroup] = useState<string | null>(null);
  const now = new Date();

  // Prompt 247 A's merged create flow, mirrored: one modal for both "click
  // a day" and "Add task", "Startup" instead of "Investor".
  const [apDateOpen, setApDateOpen] = useState(false);
  const [apDate, setApDate] = useState('');
  const [apTitle, setApTitle] = useState('');
  const [apTime, setApTime] = useState('09:00');
  const [apType, setApType] = useState<ActionType>('other');
  const [apOrgId, setApOrgId] = useState('');
  const [apNotes, setApNotes] = useState('');
  const [apReminder, setApReminder] = useState('none');

  function load() {
    fetch('/api/portal/tasks').then((r) => r.json()).then((d) => { setTasks(d.tasks ?? []); setStartups(d.startups ?? []); });
    fetch('/api/portal/agenda').then((r) => r.json()).then((d) => setAgendaItems(d.items ?? []));
    fetch('/api/portal/today').then((r) => r.json()).then((d) => setTodayItems((d.items ?? []).filter((it: TodayItem) => it.kind !== 'meeting_today')));
  }
  useEffect(load, []);

  function resetApFields() {
    setApTitle(''); setApTime('09:00'); setApType('other'); setApOrgId(''); setApNotes(''); setApReminder('none');
  }
  function openCreate(d: Date) { setApDate(toDateInputValue(d)); resetApFields(); setApDateOpen(true); }
  function openCreateBlank() { setApDate(toDateInputValue(now)); resetApFields(); setApDateOpen(true); }

  async function saveTask() {
    if (!apDate || !apTitle.trim()) return;
    const [y, m, day] = apDate.split('-').map(Number);
    const [hh, mm] = apTime.split(':').map(Number);
    const due = new Date(y, (m || 1) - 1, day || 1, hh || 0, mm || 0);
    const reminderOpt = REMINDER_OPTIONS.find((r) => r.value === apReminder);
    const reminderAt = reminderOpt?.offsetMin != null ? new Date(due.getTime() - reminderOpt.offsetMin * 60_000).toISOString() : undefined;
    await fetch('/api/portal/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: apTitle.trim(), orgId: apOrgId || undefined, kind: 'meeting', action_type: apType,
        due_at: due.toISOString(), notes: apNotes.trim() || undefined, reminder_at: reminderAt,
      }),
    });
    setApDateOpen(false);
    load();
  }

  async function toggleTaskDone(t: InvestorTaskItem) {
    await fetch('/api/portal/tasks', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: t.id, done: !t.done }) });
    load();
  }
  async function markFollowupDone(id: string) {
    await fetch('/api/portal/agenda', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }

  const allEntries = useMemo(() => [
    ...(tasks ?? []).map(taskToEntry),
    ...(agendaItems ?? []).map(agendaToEntry),
  ], [tasks, agendaItems]);
  const entries = useMemo(
    () => typeFilter === 'all' ? allEntries : allEntries.filter((e) => e.actionType === typeFilter),
    [allEntries, typeFilter],
  );

  const days = useMemo(() => {
    const first = new Date(month);
    const startWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    return cells;
  }, [month]);

  const entriesOn = (d: Date) => entries.filter((e) => e.date && new Date(e.date).toDateString() === d.toDateString());
  const overdue = entries.filter((e) => !e.done && e.date && new Date(e.date) < now);
  const dueToday = entries.filter((e) => !e.done && e.date && new Date(e.date).toDateString() === now.toDateString());
  const week = entries.filter((e) => !e.done && e.date && new Date(e.date) > now && new Date(e.date) < new Date(now.getTime() + 7 * 86400_000));
  const completed = entries.filter((e) => e.source === 'task' && e.done && e.date)
    .sort((a, b) => (b.date! > a.date! ? 1 : -1)).slice(0, 20);

  if (!tasks || !agendaItems || !todayItems) return <p className="text-sm text-gray-400">Loading…</p>;
  if (allEntries.length === 0 && todayItems.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">No meetings yet — express interest on a startup to start a conversation.</p>
        <p className="mt-1 text-xs text-gray-400">Round deadlines and reminders you set from a Pipeline card show up here too.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Agenda</h1>
        <a data-tour-id="agenda-export" href="/api/portal/agenda/ical" className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:border-[#0E7490]">Export .ics</a>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setTypeFilter('all')}
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${typeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          All ({allEntries.length})
        </button>
        {ACTION_TYPES.map((at) => {
          const count = allEntries.filter((e) => e.actionType === at).length;
          return (
            <button key={at} onClick={() => setTypeFilter(at)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${typeFilter === at ? 'ring-2 ring-offset-1 ring-gray-400' : 'hover:opacity-80'} ${ACTION_TYPE_COLOR[at]}`}>
              {ACTION_TYPE_LABEL[at]} ({count})
            </button>
          );
        })}
      </div>

      {todayItems.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Needs attention</h2>
          {todayItems.map((it, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
              <span className={`text-sm font-medium ${TODAY_KIND_STYLE[it.kind] ?? 'text-gray-900'}`}>{it.title}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="space-y-3 lg:col-span-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded border border-gray-300 px-2 py-1 text-sm">←</button>
            <h2 className="text-base font-semibold text-gray-900">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
            <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded border border-gray-300 px-2 py-1 text-sm">→</button>
          </div>
          <div data-tour-id="agenda-grid" className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-xs">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="bg-gray-50 px-2 py-1 font-medium text-gray-500">{d}</div>
            ))}
            {days.map((d, i) => (
              <div key={i} onClick={() => d && openCreate(d)} title={d ? 'Click to create a task on this day' : undefined}
                className={`min-h-[84px] bg-white p-1 ${d ? 'cursor-pointer hover:bg-cyan-50/60' : ''} ${d && d.toDateString() === now.toDateString() ? 'ring-2 ring-inset ring-[#0E7490]' : ''}`}>
                {d && (
                  <>
                    <div className="text-[10px] text-gray-400">{d.getDate()}</div>
                    {entriesOn(d).slice(0, 3).map((e) => {
                      const late = !e.done && new Date(e.date!) < now;
                      const cls = e.done ? 'bg-green-100 text-green-700' : late ? 'bg-red-100 text-[#B00000]'
                        : e.source === 'task' ? ACTION_TYPE_COLOR[e.actionType] : 'bg-gray-100 text-gray-700';
                      return (
                        <button key={e.key} onClick={(ev) => { ev.stopPropagation(); if (e.source === 'task') setSelectedTask(e.task!); }}
                          title={`${e.title}${e.source === 'agenda' ? '' : ` · ${ACTION_TYPE_LABEL[e.actionType]}`}`}
                          className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] ${cls}`}>
                          {e.done && '✓ '}{e.source === 'agenda' && `${KIND_ICON[e.agendaKind!]} `}{e.title}
                        </button>
                      );
                    })}
                    {entriesOn(d).length > 3 && <div className="text-[9px] text-gray-400">+{entriesOn(d).length - 3} more</div>}
                  </>
                )}
              </div>
            ))}
          </div>
          <Card title="Add task">
            <button onClick={openCreateBlank} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">+ Add task…</button>
          </Card>
        </div>

        <div data-tour-id="agenda-rail" className="space-y-3">
          {[{ label: 'OVERDUE', items: overdue, cls: 'text-[#B00000]' },
            { label: 'DUE TODAY', items: dueToday, cls: 'text-gray-900' },
            { label: 'THIS WEEK', items: week, cls: 'text-gray-600' },
            { label: 'COMPLETED', items: completed, cls: 'text-green-700' }].map((g) => {
            const isOpen = openRailGroup === g.label;
            const hasItems = g.items.length > 0;
            return (
              <Card key={g.label} title={
                <button type="button" disabled={!hasItems} aria-expanded={isOpen}
                  onClick={() => setOpenRailGroup(isOpen ? null : g.label)}
                  className={`flex w-full items-center justify-between text-left ${hasItems ? '' : 'cursor-default opacity-60'}`}>
                  <span className={g.cls}>{g.label} ({g.items.length})</span>
                  {hasItems && <span className="text-xs text-gray-400">{isOpen ? '▾' : '▸'}</span>}
                </button>
              }>
                {isOpen && hasItems && <ul className="space-y-1.5 text-sm">{g.items.map((e) => <EntryRow key={e.key} e={e} markFollowupDone={markFollowupDone} toggleTaskDone={toggleTaskDone} setSelectedTask={setSelectedTask} />)}</ul>}
              </Card>
            );
          })}
        </div>
      </div>

      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelectedTask(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[selectedTask.action_type]}`}>{ACTION_TYPE_LABEL[selectedTask.action_type]}</span>
              <button onClick={() => setSelectedTask(null)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <p className={`mt-2 text-sm font-medium ${selectedTask.done ? 'text-green-700 line-through' : 'text-gray-900'}`}>{selectedTask.done && '✓ '}{selectedTask.title}</p>
            <dl className="mt-2 space-y-1 text-xs text-gray-500">
              <div>Due: {selectedTask.due_at ? selectedTask.due_at.slice(0, 10) : '—'}</div>
              {selectedTask.orgId && <div>Startup: <Link href={`/portal/startup/${selectedTask.orgId}`} className="text-[#0E7490] hover:underline">{selectedTask.orgName}</Link></div>}
              {selectedTask.notes && <div>Notes: {selectedTask.notes}</div>}
              <div>Status: {selectedTask.done ? 'completed' : 'open'}</div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={async () => { await toggleTaskDone(selectedTask); setSelectedTask({ ...selectedTask, done: !selectedTask.done }); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${selectedTask.done ? 'bg-gray-500' : 'bg-green-700'}`}>
                {selectedTask.done ? 'Mark as not done' : 'Mark done'}
              </button>
              {selectedTask.orgId && (
                <Link href={`/portal/startup/${selectedTask.orgId}`} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                  Open dossier
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {apDateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setApDateOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">New task</p>
              <button onClick={() => setApDateOpen(false)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="mt-3 space-y-2">
              <input value={apTitle} onChange={(ev) => setApTitle(ev.target.value)} placeholder="Title…" autoFocus
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={apDate} onChange={(ev) => setApDate(ev.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input type="time" value={apTime} onChange={(ev) => setApTime(ev.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <select value={apType} onChange={(ev) => setApType(ev.target.value as ActionType)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {ACTION_TYPES.map((at) => <option key={at} value={at}>{ACTION_TYPE_LABEL[at]}</option>)}
              </select>
              <select value={apOrgId} onChange={(ev) => setApOrgId(ev.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value="">Startup (optional)…</option>
                {startups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <textarea value={apNotes} onChange={(ev) => setApNotes(ev.target.value)} rows={2} placeholder="Notes (optional)…" className="w-full rounded border border-gray-300 p-2 text-sm" />
              <select value={apReminder} onChange={(ev) => setApReminder(ev.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {REMINDER_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button disabled={!apTitle.trim() || !apDate} onClick={saveTask}
              className="mt-3 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              Create task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
