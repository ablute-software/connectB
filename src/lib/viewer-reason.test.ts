import { describe, expect, it } from 'vitest';
import {
  normalizeViewerReason, reasonForDisplay, VIEWER_REASON_MAX, VIEWER_REASON_MIN, VIEWER_REASON_MISSING,
} from './viewer-reason';

describe('viewer entry reason (Prompt 611 §B)', () => {
  it('accepts a real short answer and returns it trimmed', () => {
    const r = normalizeViewerReason('  Support ticket 41 — vault upload fails  ');
    expect(r).toEqual({ ok: true, reason: 'Support ticket 41 — vault upload fails' });
  });

  it('collapses internal whitespace, so padding cannot buy the minimum', () => {
    const r = normalizeViewerReason('bug\n\n   report');
    expect(r).toEqual({ ok: true, reason: 'bug report' });
  });

  it('rejects empty, whitespace-only and non-string', () => {
    for (const bad of ['', '   ', '\n\t ', undefined, null, 42, {}]) {
      expect(normalizeViewerReason(bad).ok).toBe(false);
    }
  });

  it('rejects a token that is technically non-empty but answers nothing', () => {
    expect(normalizeViewerReason('x').ok).toBe(false);
    expect(normalizeViewerReason('       x       ').ok).toBe(false);
  });

  it('rejects the length that spaces would have bought', () => {
    // 10 chars raw, 1 after collapsing — the check must run on the collapsed
    // value, not the raw one.
    expect(normalizeViewerReason('a         ').ok).toBe(false);
  });

  it('takes a reason exactly at the minimum', () => {
    expect(normalizeViewerReason('a'.repeat(VIEWER_REASON_MIN)).ok).toBe(true);
    expect(normalizeViewerReason('a'.repeat(VIEWER_REASON_MIN - 1)).ok).toBe(false);
  });

  it('caps the maximum', () => {
    expect(normalizeViewerReason('a'.repeat(VIEWER_REASON_MAX)).ok).toBe(true);
    expect(normalizeViewerReason('a'.repeat(VIEWER_REASON_MAX + 1)).ok).toBe(false);
  });

  it('never invents a reason for the entries written before this existed', () => {
    expect(reasonForDisplay(null)).toBe(VIEWER_REASON_MISSING);
    expect(reasonForDisplay(undefined)).toBe(VIEWER_REASON_MISSING);
    expect(reasonForDisplay('   ')).toBe(VIEWER_REASON_MISSING);
    expect(reasonForDisplay('Support ticket 41')).toBe('Support ticket 41');
  });
});
