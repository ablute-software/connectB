// Prompt 922 (I2) — the reminders to the evaluators: three days and one day before the evaluation deadline (the day set in the grid's settings, in the call's own timezone), to whoever still has applications to
// evaluate, once each (call_eval_reminders). Runs in the daily tick — the Hobby plan has no finer cron — so a reminder is sent when the deadline is within 3 days (the "3 days" one: 3 or 2 days away) or
// within 1 (the "1 day" one: 1 day away or the deadline day itself); if a day is missed it still goes out the next time, never twice. A call with the evaluation closed, archived or deleted sends none.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createNotice, emailNotice, type NoticeContent } from './applicant/notices';
import { EVALUATIONS_PATH } from './eval-assign-store';
import { evaluationReady } from './eval-grid-store';
import { localDay } from './eligibility';
import { formatDayInZone } from './tz';
import { loadCall } from './store';
import type { Call } from './types';

type Row = Record<string, unknown>;
const DAY = 86_400_000;
const daysBetween = (from: string, to: string): number => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / DAY);

/** Which reminder is due when the deadline is `away` days off: null = none yet (or it has passed). */
export function reminderKind(away: number): '3d' | '1d' | null {
  if (away < 0) return null;
  if (away <= 1) return '1d';
  if (away <= 3) return '3d';
  return null;
}

export const reminderContent = (call: Pick<Call, 'name' | 'timezone'>, kind: '3d' | '1d', day: string, pending: number): NoticeContent => ({
  title: kind === '1d' ? `Evaluation due tomorrow — ${call.name}` : `Evaluation due in 3 days — ${call.name}`,
  body: `You still have ${pending} application${pending === 1 ? '' : 's'} to evaluate in “${call.name}”. The deadline is ${formatDayInZone(`${day}T12:00:00Z`, call.timezone)}.`,
  ctaLabel: 'Open my evaluations',
});

export async function sendEvaluationReminders(admin: SupabaseClient, now: Date = new Date()): Promise<{ calls: number; reminded: number }> {
  if (!(await evaluationReady(admin))) return { calls: 0, reminded: 0 };
  const { data: settings } = await admin.from('call_eval_settings').select('call_id, deadlines');
  let calls = 0; let reminded = 0;
  for (const s of (settings ?? []) as Row[]) {
    const deadlines = (Array.isArray(s.deadlines) ? s.deadlines : []) as { day?: string }[];
    if (deadlines.length === 0) continue;
    const call = await loadCall(admin, s.call_id as string);
    if (!call || call.deletedAt || call.status === 'archived' || call.evaluationClosedAt) continue;
    const today = localDay(now.toISOString(), call.timezone);
    const due = deadlines.map((d) => d.day).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).map((day) => ({ day, kind: reminderKind(daysBetween(today, day)) })).filter((d) => d.kind !== null) as { day: string; kind: '3d' | '1d' }[];
    if (due.length === 0) continue;
    // Who still has something to do: assigned, and no SUBMITTED evaluation.
    const [{ data: assigned }, { data: evals }] = await Promise.all([
      admin.from('call_eval_assignments').select('application_id, evaluator_user_id').eq('call_id', call.id).eq('status', 'assigned'),
      admin.from('call_evaluations').select('application_id, evaluator_user_id, status').eq('call_id', call.id),
    ]);
    const submitted = new Set(((evals ?? []) as Row[]).filter((e) => e.status === 'submitted').map((e) => `${e.application_id}:${e.evaluator_user_id}`));
    const pending = new Map<string, number>();
    for (const a of (assigned ?? []) as Row[]) if (!submitted.has(`${a.application_id}:${a.evaluator_user_id}`)) pending.set(a.evaluator_user_id as string, (pending.get(a.evaluator_user_id as string) ?? 0) + 1);
    if (pending.size === 0) continue;
    calls++;
    const { data: done } = await admin.from('call_eval_reminders').select('evaluator_user_id, kind, deadline_day').eq('call_id', call.id);
    const already = new Set(((done ?? []) as Row[]).map((r) => `${r.evaluator_user_id}:${r.kind}:${r.deadline_day}`));
    for (const { day, kind } of due) {
      for (const [userId, n] of pending) {
        if (already.has(`${userId}:${kind}:${day}`)) continue;                              // sent before: never twice (the unique row is the second line of defence)
        const rec = await admin.from('call_eval_reminders').insert({ call_id: call.id, evaluator_user_id: userId, kind, deadline_day: day });
        if (rec.error) continue;                                                      // already sent (the unique row) or not recordable: never twice
        const content = reminderContent(call, kind, day, n);
        try {
          const { created, id } = await createNotice(admin, { userId, callId: call.id, applicationId: null, kind: 'eval_reminder', dedupeKey: `eval:reminder:${call.id}:${kind}:${day}`, content, linkPath: EVALUATIONS_PATH });
          const { data: u } = await admin.auth.admin.getUserById(userId);
          const email = u?.user?.email;
          if (created && email) await emailNotice(admin, id, email, call, content, { url: `${(process.env.NEXT_PUBLIC_APP_URL || 'https://www.sherlockdeal.com').replace(/\/$/, '')}${EVALUATIONS_PATH}` });
          reminded++;
        } catch (e) { console.error('[calls/eval] reminder failed:', (e as Error).message); }
      }
    }
  }
  return { calls, reminded };
}
