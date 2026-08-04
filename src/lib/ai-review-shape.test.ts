import { describe, expect, it } from 'vitest';
import { coerceReport, isRenderableReport } from './ai-review-shape';

const VALID = {
  score: 5, summary: 'A test report.',
  strengths: ['Good market'],
  weaknesses: [{ text: 'Thin team', category: 'team', severity: 'high' }],
  risks: [{ text: 'No traction', category: 'traction', severity: 'medium' }],
  recommendations: [{ text: 'Add pilot data', category: 'traction' }],
};

describe('isRenderableReport', () => {
  it('accepts an already-valid report', () => {
    expect(isRenderableReport(VALID)).toBe(true);
  });
  it('rejects a report with a string strengths field', () => {
    expect(isRenderableReport({ ...VALID, strengths: '- one\n- two' })).toBe(false);
  });
  it('rejects null/non-object input', () => {
    expect(isRenderableReport(null)).toBe(false);
    expect(isRenderableReport('not a report')).toBe(false);
  });
});

describe('coerceReport', () => {
  it('passes an already-valid report through unchanged, coerced=false', () => {
    const r = coerceReport(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coerced).toBe(false);
      expect(r.report.strengths).toEqual(['Good market']);
    }
  });

  it('coerces the real production failure mode: strengths as a markdown bullet string', () => {
    const malformed = {
      ...VALID,
      strengths: '\n- Care homes represent a legitimate addressable market\n- Connected monitoring is a recognized category\n',
    };
    const r = coerceReport(malformed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.coerced).toBe(true);
      expect(r.report.strengths).toEqual([
        'Care homes represent a legitimate addressable market',
        'Connected monitoring is a recognized category',
      ]);
    }
  });

  it('coerces a finding-array field (weaknesses) collapsed to a bullet string, filling defaults', () => {
    const malformed = { ...VALID, weaknesses: '- No team info\n- No regulatory strategy' };
    const r = coerceReport(malformed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.weaknesses).toEqual([
        { text: 'No team info', category: 'other', severity: 'medium' },
        { text: 'No regulatory strategy', category: 'other', severity: 'medium' },
      ]);
    }
  });

  it('falls back to a single-item array when a string has no bullet markers', () => {
    const malformed = { ...VALID, strengths: 'One plain sentence with no bullets.' };
    const r = coerceReport(malformed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.strengths).toEqual(['One plain sentence with no bullets.']);
  });

  it('treats a missing array field as an empty array, not a failure', () => {
    const { strengths, ...rest } = VALID;
    const r = coerceReport(rest);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.report.strengths).toEqual([]);
  });

  it('fails when score or summary themselves are the wrong type', () => {
    expect(coerceReport({ ...VALID, score: 'not a number' }).ok).toBe(false);
    expect(coerceReport({ ...VALID, summary: 42 }).ok).toBe(false);
  });

  it('fails when an array field is neither an array nor a string (unrecoverable)', () => {
    expect(coerceReport({ ...VALID, strengths: 42 }).ok).toBe(false);
    expect(coerceReport({ ...VALID, weaknesses: { oops: true } }).ok).toBe(false);
  });

  it('rejects an array item that is a string in a finding-array field already shaped as an array', () => {
    // Distinguishes "the whole field is a string" (recoverable, tested above)
    // from "the field is an array but its items aren't finding objects"
    // (not the observed failure mode — left unrecovered rather than guessed at).
    expect(coerceReport({ ...VALID, weaknesses: ['just a string, not {text,category,severity}'] }).ok).toBe(false);
  });
});
