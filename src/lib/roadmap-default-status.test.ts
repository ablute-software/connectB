// A milestone dated in the past is history ("done"); one dated ahead is a plan. The add-a-milestone form used to decide this once, from the date it opened with
// (today), and keep it when the founder typed last year's date — the milestone was saved as "planned" and the history never counted (20/10/2026).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultStatusForDate } from './roadmap-canvas';

const NOW = new Date('2026-10-20T12:00:00Z');
const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('defaultStatusForDate', () => {
  it('past → done, ahead → planned', () => {
    expect(defaultStatusForDate('2024-05-01', NOW)).toBe('done');
    expect(defaultStatusForDate('2026-10-19', NOW)).toBe('done');
    expect(defaultStatusForDate('2027-01-01', NOW)).toBe('planned');
  });
  it('an unreadable date is a plan, not history', () => {
    expect(defaultStatusForDate('', NOW)).toBe('planned');
    expect(defaultStatusForDate('not a date', NOW)).toBe('planned');
  });
});

describe('the form follows the date until the founder chooses a status', () => {
  const canvas = read('../components/company/RoadmapCanvas.tsx');

  it('the date input goes through changeDate, which only moves the status while it is untouched', () => {
    expect(canvas).toContain('onChange={(e) => changeDate(e.target.value)}');
    expect(canvas).toContain('if (!statusTouched) setStatus(defaultStatusForDate(next, new Date()));');
  });

  it('picking a status marks it as chosen, so a later date change does not undo the founder\'s choice', () => {
    expect(canvas).toContain('onChange={(e) => { setStatusTouched(true); setStatus(e.target.value as RoadmapEventStatus); }}');
  });

  it('a form opened from a button elsewhere on the page brings itself into view; one opened by a click on a lane (no initial title) does not move the page', () => {
    expect(canvas).toContain("if (draft.initialTitle !== undefined) rootRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });");
    expect(canvas).toContain('<div ref={rootRef} className="mt-3 space-y-2 rounded-2xl');
    // the lane click builds its draft without an initialTitle, the prefill with one
    expect(canvas).toMatch(/setDraft\(\{ laneId: GENERAL_LANE\.id, date: now\.toISOString\(\)\.slice\(0, 10\), end_date: null, x: 0, initialTitle: prefillTitle \}\)/);
  });

  it('an empty prefill still opens the form (the "Add a milestone" button); only null means nothing was asked', () => {
    expect(canvas).toContain('if (prefillTitle === null || !editable) return;');
    expect(canvas).not.toContain('if (!prefillTitle || !editable) return;');
  });
});
