'use client';
// Agenda — month grid + Today rail + ICS export
import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';
import type { TaskItem } from '@/lib/types';

const KIND_COLOR: Record<string, string> = {
  follow_up: 'bg-cyan-100 text-cyan-900', meeting: 'bg-[#0E7490] text-white',
  research: 'bg-teal-100 text-teal-900', admin: 'bg-gray-200 text-gray-700',
};

function toICS(tasks: TaskItem[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ablute_ CRM//EN'];
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
  const now = new Date();

  const days = useMemo(() => {
    const first = new Date(month);
    const startWeekday = (first.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: (Date | null)[] = Array(startWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
    return cells;
  }, [month]);

  const tasksOn = (d: Date) => db.tasks.filter((t) => t.due_at && !t.done
    && new Date(t.due_at).toDateString() === d.toDateString());

  const overdue = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < now);
  const dueToday = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at).toDateString() === now.toDateString());
  const week = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) > now
    && new Date(t.due_at) < new Date(now.getTime() + 7 * 86400_000));

  function exportICS() {
    const blob = new Blob([toICS(db.tasks.filter((t) => !t.done))], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ablute-agenda.ics'; a.click();
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
                    const late = new Date(t.due_at!) < now;
                    return (
                      <div key={t.id} title={t.title}
                        className={`mb-0.5 truncate rounded px-1 py-0.5 text-[10px] ${late ? 'bg-red-100 text-[#B00000]' : KIND_COLOR[t.kind]}`}>
                        {t.title}
                      </div>
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
            <button disabled={!newTitle || !newDate}
              onClick={() => { addTask({ title: newTitle, kind: 'admin', due_at: `${newDate}T12:00:00Z` }); setNewTitle(''); setNewDate(''); }}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Add</button>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        {[{ label: 'OVERDUE', items: overdue, cls: 'text-[#B00000]' },
          { label: 'DUE TODAY', items: dueToday, cls: 'text-gray-900' },
          { label: 'THIS WEEK', items: week, cls: 'text-gray-600' }].map((g) => (
          <Card key={g.label} title={<span className={g.cls}>{g.label} ({g.items.length})</span>}>
            {g.items.length === 0 ? <p className="text-xs text-gray-400">—</p> : (
              <ul className="space-y-1.5 text-sm">
                {g.items.map((t) => (
                  <li key={t.id} className="flex items-start gap-2">
                    <input type="checkbox" checked={false} onChange={() => toggleTask(t.id)} className="mt-0.5" />
                    <span className="flex-1">
                      {t.title}
                      {t.entity_id && <span className="block text-xs"><EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></span>}
                    </span>
                    <span className="text-xs text-gray-400">{t.due_at?.slice(5, 10)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
