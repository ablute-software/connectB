// MET-08 — a code comment explaining "current-status-only, no full
// history yet" isn't visible to whoever reads the dashboard number. This
// is the same caveat, surfaced where it's actually seen. The date is when
// the entities.status / pipeline_stage_reached triggers were deployed
// (migration "analytics_events_triggers") — the real point full history
// starts being trustworthy, not a rounded guess.
export const ANALYTICS_HISTORY_START_LABEL = 'July 30, 2026';

export function HistoricalDataNotice() {
  return (
    <p className="mt-1 text-[11px] text-amber-700">
      ⚠ Reads current stage only, not full history — a relation that reached a later stage and then
      regressed before {ANALYTICS_HISTORY_START_LABEL} won&apos;t show that earlier stage. Complete
      historical data starts {ANALYTICS_HISTORY_START_LABEL}.
    </p>
  );
}
