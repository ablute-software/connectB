'use client';
// Prompt 126 D — reminder popups. Polls db.tasks (already live in the store,
// no extra fetch) on an interval + immediately whenever the tab comes back
// into the foreground, and shows the single earliest-due reminder that
// hasn't been dismissed or is still snoozed. Mounted once in Shell, so it
// fires regardless of which page is open. Founder-side only for now — the
// investor workspace inherits this later via the same primitive-extraction
// pass already scoped for it (Prompt 127 Blocks A/D).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { EntityLink } from '@/components/ui';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL } from '@/lib/relationship';
import type { TaskItem } from '@/lib/types';

const POLL_MS = 30_000;

function dueReminders(tasks: TaskItem[], now: number): TaskItem[] {
  return tasks
    .filter((t) => !t.done && t.reminder_at && new Date(t.reminder_at).getTime() <= now
      && (!t.snoozed_until || new Date(t.snoozed_until).getTime() <= now))
    .sort((a, b) => new Date(a.reminder_at!).getTime() - new Date(b.reminder_at!).getTime());
}

export function ReminderPopup() {
  const { db, updateTask } = useStore();
  // Polling/visibility only force a re-render (state itself is unused) —
  // db.tasks is already live from the store on every tick.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') setTick((n) => n + 1); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const current = dueReminders(db.tasks, Date.now())[0];
  if (!current) return null;

  function dismiss() { updateTask(current!.id, { reminder_at: null }); }
  function snooze(mins: number | 'tomorrow') {
    const until = mins === 'tomorrow'
      ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })()
      : new Date(Date.now() + mins * 60_000);
    updateTask(current!.id, { snoozed_until: until.toISOString() });
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[current.action_type]}`}>
          {ACTION_TYPE_LABEL[current.action_type]}
        </span>
        <button onClick={dismiss} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
      </div>
      <p className="mt-1.5 text-sm font-medium text-gray-900">🔔 {current.title}</p>
      {current.entity_id && (
        <p className="mt-0.5 text-xs text-gray-500">
          <EntityLink id={current.entity_id}>{db.entities.find((e) => e.id === current.entity_id)?.name}</EntityLink>
        </p>
      )}
      {current.notes && <p className="mt-1 text-xs text-gray-500">{current.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button onClick={() => snooze(10)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze 10 min</button>
        <button onClick={() => snooze(60)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze 1 hour</button>
        <button onClick={() => snooze('tomorrow')} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze until tomorrow</button>
        <button onClick={dismiss} className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">Dismiss</button>
      </div>
    </div>
  );
}
