import 'server-only';
// Prompt 398 §3 — daily sweep for the "interest_request_unanswered"
// automation. NOT routed through the generic automation-rules engine
// (still an unbuilt placeholder server-side — see /api/automations/
// route.ts's own comment); same pattern as the other real jobs already
// hardcoded into that route's daily tick (malware scans, Pioneer badges,
// monthly delivery), each its own small dedicated function.
//
// Reuses the EXISTING ReminderPopup mechanism (tasks.reminder_at,
// src/lib/reminders.ts's dueReminders, already mounted shell-wide via
// ReminderPopup.tsx) instead of a second, parallel banner system — this
// sweep's only job is deciding WHEN to (re)set reminder_at on the task an
// unanswered L3 request already created (0129's investor-interest-level-db.ts,
// requestInterestLevel/decideInterestLevel3), respecting each automation's
// own configured interval and each task's own mute flag (migration 0253).
import type { SupabaseClient } from '@supabase/supabase-js';

export interface InterestReminderSweepResult { orgsWithAutomationEnabled: number; remindersSet: number; }

export async function runInterestReminderSweep(admin: SupabaseClient, now: Date): Promise<InterestReminderSweepResult> {
  const { data: automations } = await admin.from('automations')
    .select('org_id, config').eq('trigger', 'interest_request_unanswered').eq('enabled', true);
  const enabledOrgs = (automations ?? []) as { org_id: string; config: { intervalDays?: number } | null }[];
  if (enabledOrgs.length === 0) return { orgsWithAutomationEnabled: 0, remindersSet: 0 };

  let remindersSet = 0;
  for (const auto of enabledOrgs) {
    const intervalDays = typeof auto.config?.intervalDays === 'number' && auto.config.intervalDays > 0 ? auto.config.intervalDays : 2;
    const { data: pending } = await admin.from('investor_interest_levels')
      .select('investor_catalog_entity_id').eq('org_id', auto.org_id).eq('level', 3).eq('status', 'pending');
    if (!pending || pending.length === 0) continue;

    for (const req of pending as { investor_catalog_entity_id: string }[]) {
      // Same resolution investor-interest-level-db.ts already uses to find
      // this exact task — org_id + entity_id (via catalog_deliveries) +
      // source='interest_level_request' + done=false.
      const { data: delivery } = await admin.from('catalog_deliveries').select('entity_id')
        .eq('org_id', auto.org_id).eq('catalog_id', req.investor_catalog_entity_id).maybeSingle();
      const entityId = delivery?.entity_id as string | undefined;
      if (!entityId) continue;

      const { data: task } = await admin.from('tasks')
        .select('id, reminder_muted, last_reminded_at')
        .eq('org_id', auto.org_id).eq('entity_id', entityId).eq('source', 'interest_level_request').eq('done', false)
        .maybeSingle();
      if (!task) continue;
      if (task.reminder_muted) continue;

      const lastReminded = task.last_reminded_at ? new Date(task.last_reminded_at as string) : null;
      const dueForReminder = !lastReminded || (now.getTime() - lastReminded.getTime()) >= intervalDays * 86_400_000;
      if (!dueForReminder) continue;

      const { error } = await admin.from('tasks').update({
        reminder_at: now.toISOString(), last_reminded_at: now.toISOString(),
      }).eq('id', task.id as string);
      if (!error) remindersSet++;
    }
  }
  return { orgsWithAutomationEnabled: enabledOrgs.length, remindersSet };
}
