'use client';
// Agenda — month grid + Today rail + ICS export. Moved from
// src/app/agenda/page.tsx (formerly its own route) into the Today/Agenda
// separadores on /today — logic unchanged, only the export changed from a
// page default to a named panel. Batch 3 E3: tasks are clickable → a summary
// popover; completed tasks don't disappear — they turn green with a ✓ and
// stay visible (in the calendar in place, and in a "Completed" rail).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';
import type { ActionType, TaskItem } from '@/lib/types';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL, ACTION_TYPES } from '@/lib/relationship';

// Prompt 126 D — offsets for the "create appointment" modal's Reminder
// select. `null` = no reminder at all; `0` = fire right at the event's own
// time. Minutes-before, not an absolute time, so the popup logic only ever
// needs one field (reminder_at) regardless of which option was picked.
const REMINDER_OPTIONS: { value: string; label: string; offsetMin: number | null }[] = [
  { value: 'none', label: 'No reminder', offsetMin: null },
  { value: 'at_time', label: 'At the time', offsetMin: 0 },
  { value: '10_before', label: '10 minutes before', offsetMin: 10 },
  { value: '1h_before', label: '1 hour before', offsetMin: 60 },
  { value: '1d_before', label: '1 day before', offsetMin: 1440 },
];

function toICS(tasks: TaskItem[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ablute_ IRM//EN'];
  for (const t of tasks) {
    if (!t.due_at) continue;
    const dt = t.due_at.replace(/[-:]/g, '').slice(0, 15) + 'Z';
    lines.push('BEGIN:VEVENT', `UID:${t.id}@ablute-crm`, `DTSTART:${dt}`, `SUMMARY:${t.title.replace(/\n/g, ' ')}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function AgendaPanel() {
  const { db, toggleTask, addTask } = useStore();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [typeFilter, setTypeFilter] = useState<ActionType | 'all'>('all');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  // Prompt 246 — the rail's four groups (OVERDUE/DUE TODAY/THIS WEEK/
  // COMPLETED) are collapsed by default and open exclusively (opening one
  // closes whichever was open) — same accordion shape as
  // AccessGrantedPanel.tsx's expandedOrgId. Local only, no persistence.
  const [openRailGroup, setOpenRailGroup] = useState<string | null>(null);
  const now = new Date();

  // Prompt 126 D — click any day in the grid to create an appointment there.
  // Prompt 247 A — the bottom-of-page "Add task" form used to be a
  // stripped-down duplicate of this modal (title+date+type only, no time,
  // reminder, or investor). Rather than growing that second form to match
  // this one field-by-field, "Add task" now opens this same modal with
  // `apDateOpen` blank — one flow, one set of fields, instead of two that
  // could drift apart again. `apDateOpen` (gate) is separate from `apDate`
  // (the editable yyyy-mm-dd value) so a day-grid click can prefill it while
  // "Add task" leaves it for the user to pick.
  const [apDateOpen, setApDateOpen] = useState(false);
  const [apDate, setApDate] = useState('');
  const [apTitle, setApTitle] = useState('');
  const [apTime, setApTime] = useState('09:00');
  const [apType, setApType] = useState<ActionType>('other');
  const [apEntityId, setApEntityId] = useState('');
  const [apPersonId, setApPersonId] = useState('');
  const [apNotes, setApNotes] = useState('');
  const [apReminder, setApReminder] = useState('none');
  // notes/reminder_at/snoozed_until are migration 0123 (propose-only) —
  // never sent to a real backend until this probe confirms the columns
  // exist. Demo mode has no schema to violate, so it's always available
  // there regardless of what the probe (which needs a real Supabase
  // connection) reports.
  const [remindersAvailable, setRemindersAvailable] = useState(false);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setRemindersAvailable(!me.authEnabled || !!me.capabilities?.taskReminders))
      .catch(() => setRemindersAvailable(false));
  }, []);

  function toDateInputValue(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function resetApFields() {
    setApTitle(''); setApTime('09:00'); setApType('other');
    setApEntityId(''); setApPersonId(''); setApNotes(''); setApReminder('none');
  }

  // Day-grid click: date prefilled (still editable in the modal).
  function openCreate(d: Date) {
    setApDate(toDateInputValue(d)); resetApFields(); setApDateOpen(true);
  }

  // "Add task": same modal, date left for the user to pick.
  function openCreateBlank() {
    setApDate(toDateInputValue(now)); resetApFields(); setApDateOpen(true);
  }

  function saveAppointment() {
    if (!apDate || !apTitle.trim()) return;
    const [y, m, day] = apDate.split('-').map(Number);
    const [hh, mm] = apTime.split(':').map(Number);
    const due = new Date(y, (m || 1) - 1, day || 1, hh || 0, mm || 0);
    const reminderOpt = REMINDER_OPTIONS.find((r) => r.value === apReminder);
    const reminderAt = remindersAvailable && reminderOpt?.offsetMin != null
      ? new Date(due.getTime() - reminderOpt.offsetMin * 60_000).toISOString()
      : undefined;
    addTask({
      title: apTitle.trim(),
      kind: 'meeting',
      action_type: apType,
      due_at: due.toISOString(),
      entity_id: apEntityId || undefined,
      person_id: apPersonId || undefined,
      notes: remindersAvailable ? (apNotes.trim() || undefined) : undefined,
      reminder_at: reminderAt,
    });
    setApDateOpen(false);
  }

  const visibleTasks = useMemo(
    () => typeFilter === 'all' ? db.tasks : db.tasks.filter((t) => t.action_type === typeFilter),
    [db.tasks, typeFilter]
  );

  const days = useMemo(() => {
    const first = new Date(month);
    const startWeekday = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    return cells;
  }, [month]);

  // Calendar shows done tasks too (styled green), so completing one doesn't
  // make it vanish from the day it was scheduled.
  const tasksOn = (d: Date) => visibleTasks.filter((t) => t.due_at && new Date(t.due_at).toDateString() === d.toDateString());

  const overdue = visibleTasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < now);
  const dueToday = visibleTasks.filter((t) => !t.done && t.due_at && new Date(t.due_at).toDateString() === now.toDateString());
  const week = visibleTasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) > now
    && new Date(t.due_at) < new Date(now.getTime() + 7 * 86400_000));
  const completed = visibleTasks.filter((t) => t.done && t.due_at)
    .sort((a, b) => (b.due_at! > a.due_at! ? 1 : -1)).slice(0, 20);

  function exportICS() {
    const blob = new Blob([toICS(db.tasks.filter((t) => !t.done))], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ablute-agenda.ics'; a.click();
  }

  function TaskRow({ t }: { t: TaskItem }) {
    return (
      <li className={`flex items-start gap-2 rounded px-1 ${t.done ? 'bg-green-50' : ''}`}>
        <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id)} className="mt-1" onClick={(e) => e.stopPropagation()} />
        <button onClick={() => setSelected(t)} className="flex-1 text-left">
          <span className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[t.action_type]}`}>
            {ACTION_TYPE_LABEL[t.action_type]}
          </span>
          <span className={t.done ? 'text-green-700 line-through' : ''}>{t.done && '✓ '}{t.title}</span>
          {t.entity_id && <span className="block text-xs"><EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></span>}
        </button>
        <span className="text-xs text-gray-400">{t.due_at?.slice(5, 10)}</span>
      </li>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      <div className="space-y-3 lg:col-span-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded border border-gray-300 px-2 py-1 text-sm">←</button>
          <h1 className="text-lg font-bold">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h1>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded border border-gray-300 px-2 py-1 text-sm">→</button>
          <button data-tour-id="agenda-export" onClick={exportICS} className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Export ICS</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setTypeFilter('all')}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${typeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            All ({db.tasks.length})
          </button>
          {ACTION_TYPES.map((at) => {
            const count = db.tasks.filter((t) => t.action_type === at).length;
            return (
              <button key={at} onClick={() => setTypeFilter(at)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${typeFilter === at ? 'ring-2 ring-offset-1 ring-gray-400' : 'hover:opacity-80'} ${ACTION_TYPE_COLOR[at]}`}>
                {ACTION_TYPE_LABEL[at]} ({count})
              </button>
            );
          })}
        </div>
        <div data-tour-id="agenda-grid" className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="bg-gray-50 px-2 py-1 font-medium text-gray-500">{d}</div>
          ))}
          {days.map((d, i) => (
            <div key={i} onClick={() => d && openCreate(d)} title={d ? 'Click to create an appointment on this day' : undefined}
              className={`min-h-[84px] bg-white p-1 ${d ? 'cursor-pointer hover:bg-cyan-50/60' : ''} ${d && d.toDateString() === now.toDateString() ? 'ring-2 ring-inset ring-[#0E7490]' : ''}`}>
              {d && (
                <>
                  <div className="text-[10px] text-gray-400">{d.getDate()}</div>
                  {tasksOn(d).slice(0, 3).map((t) => {
                    const late = !t.done && new Date(t.due_at!) < now;
                    const cls = t.done ? 'bg-green-100 text-green-700' : late ? 'bg-red-100 text-[#B00000]' : ACTION_TYPE_COLOR[t.action_type];
                    return (
                      <button key={t.id} onClick={(e) => { e.stopPropagation(); setSelected(t); }} title={`${t.title} · ${ACTION_TYPE_LABEL[t.action_type]}`}
                        className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] ${cls}`}>
                        {t.done && '✓ '}{t.title}
                      </button>
                    );
                  })}
                  {tasksOn(d).length > 3 && <div className="text-[9px] text-gray-400">+{tasksOn(d).length - 3} more</div>}
                </>
              )}
            </div>
          ))}
        </div>
        <Card title="Add task">
          <button onClick={openCreateBlank}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
            + Add task…
          </button>
        </Card>
      </div>

      <div data-tour-id="agenda-rail" className="space-y-3">
        {[{ label: 'OVERDUE', items: overdue, cls: 'text-[#B00000]' },
          { label: 'DUE TODAY', items: dueToday, cls: 'text-gray-900' },
          { label: 'THIS WEEK', items: week, cls: 'text-gray-600' },
          { label: 'COMPLETED', items: completed, cls: 'text-green-700' }].map((g) => {
          const isOpen = openRailGroup === g.label;
          const hasItems = g.items.length > 0;
          // Card wraps `title` in a plain <h3>, not a button, so a <button>
          // here is valid nesting (no button-inside-button) — confirmed by
          // reading ui.tsx before reaching for a bespoke container.
          return (
            <Card key={g.label} title={
              <button type="button" disabled={!hasItems} aria-expanded={isOpen}
                onClick={() => setOpenRailGroup(isOpen ? null : g.label)}
                className={`flex w-full items-center justify-between text-left ${hasItems ? '' : 'cursor-default opacity-60'}`}>
                <span className={g.cls}>{g.label} ({g.items.length})</span>
                {hasItems && <span className="text-xs text-gray-400">{isOpen ? '▾' : '▸'}</span>}
              </button>
            }>
              {isOpen && hasItems && (
                <ul className="space-y-1.5 text-sm">{g.items.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
              )}
            </Card>
          );
        })}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[selected.action_type]}`}>{ACTION_TYPE_LABEL[selected.action_type]}</span>
              <button onClick={() => setSelected(null)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <p className={`mt-2 text-sm font-medium ${selected.done ? 'text-green-700 line-through' : 'text-gray-900'}`}>{selected.done && '✓ '}{selected.title}</p>
            <dl className="mt-2 space-y-1 text-xs text-gray-500">
              <div>Due: {selected.due_at ? selected.due_at.slice(0, 10) : '—'}</div>
              <div>Kind: {selected.kind}</div>
              {selected.entity_id && <div>Investor: <EntityLink id={selected.entity_id}>{db.entities.find((e) => e.id === selected.entity_id)?.name}</EntityLink></div>}
              <div>Status: {selected.done ? 'completed' : 'open'}</div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => { toggleTask(selected.id); setSelected({ ...selected, done: !selected.done }); }}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${selected.done ? 'bg-gray-500' : 'bg-green-700'}`}>
                {selected.done ? 'Mark as not done' : 'Mark done'}
              </button>
              {/* Prompt 126 C — the popup used to be read-only (mark done,
                  or nothing); an overdue/due-today task almost always means
                  "go log the interaction that resolves this", so link
                  straight into that flow prefilled with whatever this task
                  already points at. Only entity_id/person_id exist on
                  TaskItem — there is no document_id field to prefill from,
                  so that part of the request doesn't apply here. */}
              {selected.entity_id && (
                <Link href={`/log?entity=${selected.entity_id}${selected.person_id ? `&person=${selected.person_id}` : ''}`}
                  className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                  Log interaction
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {apDateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setApDateOpen(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">New task</p>
              <button onClick={() => setApDateOpen(false)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="mt-3 space-y-2">
              <input value={apTitle} onChange={(e) => setApTitle(e.target.value)} placeholder="Title…" autoFocus
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={apDate} onChange={(e) => setApDate(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input type="time" value={apTime} onChange={(e) => setApTime(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <select value={apType} onChange={(e) => setApType(e.target.value as ActionType)}
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                {ACTION_TYPES.map((at) => <option key={at} value={at}>{ACTION_TYPE_LABEL[at]}</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={apEntityId} onChange={(e) => { setApEntityId(e.target.value); setApPersonId(''); }}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="">Investor (optional)…</option>
                  {db.entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select value={apPersonId} onChange={(e) => setApPersonId(e.target.value)} disabled={!apEntityId}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50">
                  <option value="">Person (optional)…</option>
                  {db.people.filter((p) => p.entity_id === apEntityId).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </div>
              {remindersAvailable ? (
                <>
                  <textarea value={apNotes} onChange={(e) => setApNotes(e.target.value)} rows={2} placeholder="Notes (optional)…"
                    className="w-full rounded border border-gray-300 p-2 text-sm" />
                  <select value={apReminder} onChange={(e) => setApReminder(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm">
                    {REMINDER_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </>
              ) : (
                <p className="text-[11px] text-gray-400">Notes and reminders aren&apos;t saved yet in this workspace — coming soon.</p>
              )}
            </div>
            <button disabled={!apTitle.trim() || !apDate} onClick={saveAppointment}
              className="mt-3 w-full rounded-lg bg-[#0E7490] px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
              Create task
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
