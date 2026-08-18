'use client';
// Prompt 247 B — reminder popups, investor side. The primitive-extraction
// pass ReminderPopup.tsx's own comment anticipated ("Prompt 127 Blocks
// A/D"): same ReminderPopupView, same dueReminders(), different data
// source (investor_tasks via /api/portal/tasks instead of the founder's
// local store) and different write path (PATCH instead of updateTask).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ReminderPopupView } from '@/components/ReminderPopupView';
import type { InvestorTaskItem } from '@/lib/investor-tasks';

async function patchTask(id: string, patch: { reminder_at?: string | null; snoozed_until?: string | null }) {
  await fetch('/api/portal/tasks', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...patch }) });
}

const POLL_MS = 30_000;

export function InvestorReminderPopup() {
  const [tasks, setTasks] = useState<InvestorTaskItem[]>([]);

  function load() {
    fetch('/api/portal/tasks').then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => {});
  }
  // Unlike the founder wrapper (db.tasks is a live store reference, updated
  // in-place by whichever component calls addTask/updateTask), this
  // component holds its own fetched copy — a task created elsewhere in the
  // same session (the calendar's create-task modal) wouldn't otherwise be
  // seen until remount. Re-fetch on the same cadence ReminderPopupView
  // already ticks on, plus on tab-foreground, to keep parity.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    function onVisible() { if (document.visibilityState === 'visible') load(); }
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  return (
    <ReminderPopupView<InvestorTaskItem>
      items={tasks}
      onDismiss={(t) => { patchTask(t.id, { reminder_at: null }).then(load); }}
      onSnooze={(t, until) => { patchTask(t.id, { snoozed_until: until }).then(load); }}
      renderLink={(t) => t.orgId
        ? <Link href={`/portal/startup/${t.orgId}`} className="text-[#0E7490] hover:underline">{t.orgName}</Link>
        : null}
    />
  );
}
