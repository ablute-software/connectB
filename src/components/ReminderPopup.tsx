'use client';
// Prompt 126 D — reminder popups, founder side. Thin wrapper around
// ReminderPopupView (Prompt 247 B extraction) — the polling/UI live there
// now; this file only wires the founder's local store as the data source.
// Mounted once in Shell, so it fires regardless of which page is open.
import { useStore } from '@/lib/store';
import { EntityLink } from '@/components/ui';
import { ReminderPopupView } from '@/components/ReminderPopupView';
import { followUpTaskDisplayTitle } from '@/lib/relationship';
import type { TaskItem } from '@/lib/types';

export function ReminderPopup() {
  const { db, updateTask } = useStore();

  return (
    // Prompt 414 §1.2 — ReminderPopupView is shared with the investor side
    // (InvestorReminderPopup.tsx), whose items are a different type with no
    // due_at/kind fields, so the live-title fix can't live inside the
    // shared view without widening a generic type for one caller. Applied
    // here instead, at the founder-only wrapper, by overriding .title
    // before it ever reaches the view — onDismiss/onSnooze/onMute below
    // only ever key off `t.id`, never `t.title`, so this is display-only.
    <ReminderPopupView<TaskItem>
      items={db.tasks.map((t) => ({ ...t, title: followUpTaskDisplayTitle(t) }))}
      onDismiss={(t) => updateTask(t.id, { reminder_at: null })}
      onSnooze={(t, until) => updateTask(t.id, { snoozed_until: until })}
      // Prompt 398 §3.2.2 — permanent per-request opt-out (never fires
      // again for this task), distinct from Dismiss above. The request
      // itself stays pending in Today; muting only silences the popup.
      onMute={(t) => updateTask(t.id, { reminder_muted: true, reminder_at: null })}
      renderLink={(t) => t.entity_id
        ? <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink>
        : null}
    />
  );
}
