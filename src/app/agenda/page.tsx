'use client';
// Agenda — month grid + Today rail + ICS export. Batch 3 E3: tasks are
// clickable → a summary popover; completed tasks don't disappear — they turn
// green with a ✓ and stay visible (in the calendar in place, and in a
// "Completed" rail).
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';
import type { ActionType, TaskItem } from '@/lib/types';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL, ACTION_TYPES } from '@/lib/relationship';

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

export default function AgendaPage() {
  const { db, toggleTask, addTask } = useStore();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newType, setNewType] = useState<ActionType>('other');
  const [typeFilter, setTypeFilter] = useState<ActionType | 'all'>('all');
  const [selected, setSelected] = useState<TaskItem | null>(null);
  const now = new Date();

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
          <button onClick={exportICS} className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">Export ICS</button>
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
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="bg-gray-50 px-2 py-1 font-medium text-gray-500">{d}</div>
          ))}
          {days.map((d, i) => (
            <div key={i} className={`min-h-[84px] bg-white p-1 ${d && d.toDateString() === now.toDateString() ? 'ring-2 ring-inset ring-[#0E7490]' : ''}`}>
              {d && (
                <>
                  <div className="text-[10px] text-gray-400">{d.getDate()}</div>
                  {tasksOn(d).slice(0, 3).map((t) => {
                    const late = !t.done && new Date(t.due_at!) < now;
                    const cls = t.done ? 'bg-green-100 text-green-700' : late ? 'bg-red-100 text-[#B00000]' : ACTION_TYPE_COLOR[t.action_type];
                    return (
                      <button key={t.id} onClick={() => setSelected(t)} title={`${t.title} · ${ACTION_TYPE_LABEL[t.action_type]}`}
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
          <div className="flex flex-wrap gap-2">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Task…"
              className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            <select value={newType} onChange={(e) => setNewType(e.target.value as ActionType)}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {ACTION_TYPES.map((at) => <option key={at} value={at}>{ACTION_TYPE_LABEL[at]}</option>)}
            </select>
            <button disabled={!newTitle || !newDate}
              onClick={() => { addTask({ title: newTitle, kind: 'admin', action_type: newType, due_at: `${newDate}T12:00:00Z` }); setNewTitle(''); setNewDate(''); setNewType('other'); }}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        {[{ label: 'OVERDUE', items: overdue, cls: 'text-[#B00000]' },
          { label: 'DUE TODAY', items: dueToday, cls: 'text-gray-900' },
          { label: 'THIS WEEK', items: week, cls: 'text-gray-600' },
          { label: 'COMPLETED', items: completed, cls: 'text-green-700' }].map((g) => (
          <Card key={g.label} title={<span className={g.cls}>{g.label} ({g.items.length})</span>}>
            {g.items.length === 0 ? <p className="text-xs text-gray-400">—</p> : (
              <ul className="space-y-1.5 text-sm">{g.items.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
            )}
          </Card>
        ))}
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
            <button onClick={() => { toggleTask(selected.id); setSelected({ ...selected, done: !selected.done }); }}
              className={`mt-3 rounded-lg px-3 py-1.5 text-sm font-medium text-white ${selected.done ? 'bg-gray-500' : 'bg-green-700'}`}>
              {selected.done ? 'Mark as not done' : 'Mark done'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
