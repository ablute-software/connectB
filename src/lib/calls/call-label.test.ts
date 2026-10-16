// Prompt 917 (Adenda 1, Part A) — two drafts both called "Untitled call" are told apart by when they were created; a call with a name is shown by its name.
import { describe, expect, it } from 'vitest';
import { UNTITLED_CALL, callLabel, createdText, isUnnamedCall } from './call-label';
import { onOpenRun } from './ai-import/screen-state';

describe('the label of a call', () => {
  it('a call without a name carries its creation time, in the call\'s own time zone', () => {
    expect(callLabel('Untitled call', '2026-10-15T12:29:57Z', 'Europe/Lisbon')).toBe('Untitled call · created 15 Oct, 13:29');
    expect(callLabel('', '2026-10-15T12:25:27Z', 'Europe/Lisbon')).toBe('Untitled call · created 15 Oct, 13:25');
    expect(callLabel(null, '2026-10-15T12:25:27Z', 'UTC')).toBe('Untitled call · created 15 Oct, 12:25');
    expect(callLabel('Untitled call', '2026-10-15T12:29:57Z', 'Europe/Lisbon')).not.toBe(callLabel('Untitled call', '2026-10-15T12:25:27Z', 'Europe/Lisbon'));
  });
  it('a call with a name is its name; with no date known it is just "Untitled call"; a bad time zone falls back, never throws', () => {
    expect(callLabel('  INNOV-ID  ', '2026-10-15T12:29:57Z')).toBe('INNOV-ID');
    expect(callLabel('Untitled call', null)).toBe(UNTITLED_CALL);
    expect(createdText('2026-10-15T12:29:57Z', 'Not/AZone')).toBe('15 Oct, 12:29');
    expect(createdText('nonsense')).toBe('');
    expect(isUnnamedCall('INNOV-ID')).toBe(false); expect(isUnnamedCall(' ')).toBe(true);
  });
});

describe('opening a run (from "Review", the call\'s card or the pill)', () => {
  const proposal = { general: {}, phases: [], fields: [], attention: [], foundLater: { eligibility: [], evaluation: [] } } as never;
  it('a proposed run goes straight to its review — never through the upload form', () => {
    expect(onOpenRun({ ok: true, status: 200, run: { id: 'r1', status: 'proposed', proposal } })).toMatchObject({ kind: 'review', id: 'r1', proposal });
  });
  it('a run still being read resumes the wait from when it started', () => {
    expect(onOpenRun({ ok: true, status: 200, run: { id: 'r1', status: 'reading', startedAt: '2026-10-15T12:30:14.614Z' } })).toEqual({ kind: 'reading', runId: 'r1', since: Date.parse('2026-10-15T12:30:14.614Z') });
  });
  it('anything else says why there is nothing to review — never a silent upload form', () => {
    expect(onOpenRun({ ok: true, status: 200, run: { id: 'r1', status: 'failed', error: 'Reading the documents took longer than we allow.' } })).toEqual({ kind: 'upload', error: 'Reading the documents took longer than we allow.' });
    expect(onOpenRun({ ok: true, status: 200, run: { id: 'r1', status: 'applied' } })).toEqual({ kind: 'upload', error: 'That proposal was already applied to the call.' });
    expect(onOpenRun({ ok: true, status: 200, run: { id: 'r1', status: 'discarded' } })).toEqual({ kind: 'upload', error: 'That proposal was discarded.' });
    expect(onOpenRun({ ok: false, status: 404 })).toEqual({ kind: 'upload', error: 'That proposal no longer exists.' });
    expect(onOpenRun({ ok: false, status: 0 })).toEqual({ kind: 'upload', error: 'We could not open that proposal. Please try again.' });
  });
});
