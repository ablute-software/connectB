// Prompt 884 — pure card-membership rules for the Today redesign's four
// main-column cards (Meetings / Overdue / Follow up / Other), so
// TodayPanel.tsx (and the new card components) only ever render what these
// decide — one source, testable without a DOM.
import type { Entity, FitScore, TaskItem } from './types';

// The one guard every card shares: not done, and not an automation_dormant
// task (Prompt 883 — that decision lives ONLY in Actions Required now).
export function isTodayEligible(t: TaskItem): boolean {
  return !t.done && t.source !== 'automation_dormant';
}

// Meetings — every not-done meeting task with a due date, regardless of
// how far out (the CARD itself only renders the today/+2d window plus a
// "Missed" bucket; a meeting further out than that is correctly absent
// from Today, same as it always was for any other task kind).
export function meetingTasks(tasks: TaskItem[]): TaskItem[] {
  return tasks.filter((t) => isTodayEligible(t) && t.kind === 'meeting' && t.due_at);
}

// Overdue — unchanged from before this prompt EXCEPT meetings now live
// only in the Meetings card (as a "Missed" state there, never dropped).
export function overdueTasks(tasks: TaskItem[], now: Date): TaskItem[] {
  return tasks.filter((t) => isTodayEligible(t) && t.due_at && new Date(t.due_at) < now
    && t.kind !== 'research' && t.kind !== 'meeting')
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

// Follow up (NEW) — the two follow-up action_types, but only the ones NOT
// already overdue. due_at is what decides membership; any "Last outreach
// on…" subtitle is informational context from the related interaction,
// never itself a member test (the prompt's own distinction).
export function followUpTasks(tasks: TaskItem[], now: Date): TaskItem[] {
  return tasks.filter((t) => isTodayEligible(t)
    && (t.action_type === 'follow_up_no_reply' || t.action_type === 'follow_up_thread')
    && t.kind !== 'meeting'
    && (!t.due_at || new Date(t.due_at) >= now))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

// Other (NEW) — whatever's left: not done, not automation_dormant, not in
// any of the three cards above. Computed by exclusion so the four cards
// can never double-count or drop a task between them.
export function otherTasks(tasks: TaskItem[], now: Date): TaskItem[] {
  const meetingIds = new Set(meetingTasks(tasks).map((t) => t.id));
  const overdueIds = new Set(overdueTasks(tasks, now).map((t) => t.id));
  const followUpIds = new Set(followUpTasks(tasks, now).map((t) => t.id));
  return tasks.filter((t) => isTodayEligible(t)
    && !meetingIds.has(t.id) && !overdueIds.has(t.id) && !followUpIds.has(t.id));
}

// ---------------------------------------------------------------------
// Meetings card — date grouping.

export interface MeetingGroup { label: string; tasks: TaskItem[] }

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAY_MONTH_DAY = { weekday: 'long', month: 'short', day: 'numeric' } as const;

// "Missed" — a meeting whose due_at is already in the past and hasn't been
// logged. Per the prompt's own instruction: never silently dropped from
// the founder's view just because meetings are excluded from Overdue.
export function missedMeetings(tasks: TaskItem[], now: Date): TaskItem[] {
  return meetingTasks(tasks).filter((t) => new Date(t.due_at!) < now)
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
}

// Today, tomorrow, and up to 2 days out — the mockup's own stated window
// ("Meetings today and preparation for the next 2 days"). A meeting
// further out than that is correctly absent here (same as any other task
// kind that isn't due soon), not lost — it's just not "Today" yet.
export function upcomingMeetingGroups(tasks: TaskItem[], now: Date): MeetingGroup[] {
  const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3); // exclusive: today, +1, +2
  const upcoming = meetingTasks(tasks)
    .filter((t) => { const d = new Date(t.due_at!); return d >= now && d < windowEnd; })
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));

  const groups: MeetingGroup[] = [];
  for (const t of upcoming) {
    const d = new Date(t.due_at!);
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const label = sameDay(d, now)
      ? `Today · ${d.toLocaleDateString('en-US', WEEKDAY_MONTH_DAY)}`
      : sameDay(d, tomorrow)
        ? `Tomorrow · ${d.toLocaleDateString('en-US', WEEKDAY_MONTH_DAY)}`
        : d.toLocaleDateString('en-US', WEEKDAY_MONTH_DAY);
    const existing = groups.find((g) => g.label === label);
    if (existing) existing.tasks.push(t); else groups.push({ label, tasks: [t] });
  }
  return groups;
}

export function isMeetingToday(t: TaskItem, now: Date): boolean {
  return !!t.due_at && sameDay(new Date(t.due_at), now) && new Date(t.due_at) >= now;
}

// ---------------------------------------------------------------------
// "Other" card — the priority signal.
//
// No priority field exists on `tasks` (checked: 0001_init.sql, and every
// later migration touching tasks — confirmed nothing was ever added).
// Rather than inventing one silently, this derives it from the linked
// entity's own fit_score — a real, already-scored signal — and returns
// undefined (no pill) for a task with no entity, or one linked to an
// entity whose fit_score isn't set. That absence IS the honest answer for
// those rows, not a bug to paper over with a fake default.
const PRIORITY_BY_FIT: Record<FitScore, 'High' | 'Medium' | 'Low'> = {
  high: 'High', medium_high: 'High', medium: 'Medium', low: 'Low',
};
export function otherTaskPriority(t: TaskItem, entities: Pick<Entity, 'id' | 'fit_score'>[]): 'High' | 'Medium' | 'Low' | undefined {
  if (!t.entity_id) return undefined;
  const entity = entities.find((e) => e.id === t.entity_id);
  if (!entity?.fit_score) return undefined;
  return PRIORITY_BY_FIT[entity.fit_score];
}

// ---------------------------------------------------------------------
// "Meetings completed" (Outreach discipline stat).
//
// Numerator: kind==='meeting' tasks due THIS WEEK that are done — which,
// per this prompt's own decision, only ever happens through a real logged
// summary (Add meeting summary), so "completed" already means "confirmed
// via the Log", no separate reconciliation against `interactions` needed.
// Denominator: all kind==='meeting' tasks due this week, done or not.
export function meetingsCompletedThisWeek(tasks: TaskItem[], now: Date): { done: number; total: number } {
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueThisWeek = tasks.filter((t) => t.kind === 'meeting' && t.due_at
    && new Date(t.due_at) >= startOfWeek && new Date(t.due_at) < weekEnd);
  return { done: dueThisWeek.filter((t) => t.done).length, total: dueThisWeek.length };
}
