'use client';
// Prompt 247 B — ReminderPopup's UI + polling, extracted into a
// presentational component parameterized by data source and write
// operations, so the investor workspace can reuse it (this exact
// extraction was already anticipated by the original component's own
// comment — "Prompt 127 Blocks A/D"). dueReminders() itself needed no
// change (already generic — src/lib/reminders.ts). ReminderPopup.tsx
// (founder, store-backed) and InvestorReminderPopup.tsx (portal,
// /api/portal/tasks-backed) are now both thin wrappers around this.
import { useEffect, useState } from 'react';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL } from '@/lib/relationship';
import { dueReminders, type ReminderSource } from '@/lib/reminders';
import type { ActionType } from '@/lib/types';

const POLL_MS = 30_000;

export interface ReminderableItem extends ReminderSource {
  title: string;
  action_type: ActionType;
  notes?: string | null;
  // Prompt 398 §3.2.2 — only 'interest_level_request' items get the "Stop
  // reminding for this investor" button below (gated on `source`, not
  // just on `onMute` being passed, since ReminderPopup.tsx wraps every
  // founder task — appointments included — through this same view).
  source?: string;
}

export function ReminderPopupView<T extends ReminderableItem>({ items, onDismiss, onSnooze, onMute, renderLink }: {
  items: T[];
  onDismiss: (item: T) => void;
  onSnooze: (item: T, until: string) => void;
  // Prompt 398 §3.2.2 — "stop reminding for THIS request", distinct from
  // Dismiss (which only clears reminder_at until the next sweep resets
  // it — see interest-reminder-sweep.ts). Optional: only the founder
  // wrapper (interest requests are founder-side only) passes it.
  onMute?: (item: T) => void;
  // Render-prop rather than an href/label pair — the founder side wants its
  // existing EntityLink component (styling + routing already established),
  // the investor side wants a plain Link to /portal/startup/[orgId]; each
  // wrapper knows its own case better than a generic shape could.
  renderLink?: (item: T) => React.ReactNode;
}) {
  // Polling/visibility only force a re-render (state itself is unused) —
  // `items` is already live from whichever source the wrapper passes in.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') setTick((n) => n + 1); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const current = dueReminders(items, Date.now())[0];
  if (!current) return null;
  const linkNode = renderLink?.(current) ?? null;

  function snooze(mins: number | 'tomorrow') {
    const until = mins === 'tomorrow'
      ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; })()
      : new Date(Date.now() + mins * 60_000);
    onSnooze(current!, until.toISOString());
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[current.action_type]}`}>
          {ACTION_TYPE_LABEL[current.action_type]}
        </span>
        <button onClick={() => onDismiss(current)} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
      </div>
      <p className="mt-1.5 text-sm font-medium text-gray-900">🔔 {current.title}</p>
      {linkNode && <p className="mt-0.5 text-xs text-gray-500">{linkNode}</p>}
      {current.notes && <p className="mt-1 text-xs text-gray-500">{current.notes}</p>}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button onClick={() => snooze(10)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze 10 min</button>
        <button onClick={() => snooze(60)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze 1 hour</button>
        <button onClick={() => snooze('tomorrow')} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">Snooze until tomorrow</button>
        <button onClick={() => onDismiss(current)} className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#0c637b]">Dismiss</button>
      </div>
      {onMute && current.source === 'interest_level_request' && (
        <button onClick={() => onMute(current)} className="mt-1.5 text-[11px] text-gray-400 hover:text-gray-600 hover:underline">
          Stop reminding for this investor
        </button>
      )}
    </div>
  );
}
