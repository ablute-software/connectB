import { describe, expect, it } from 'vitest';
import { EVALUATION_TOOLS_INTRO_CONTENT, shouldShowEvaluationToolsIntro } from './evaluation-tools-intro';

describe('EVALUATION_TOOLS_INTRO_CONTENT', () => {
  it('has exactly one entry per tool, in Prompt 418 §B funnel order', () => {
    expect(EVALUATION_TOOLS_INTRO_CONTENT.map((e) => e.key)).toEqual([
      'compare', 'berkus', 'scorecard', 'calculator', 'simulator', 'return',
    ]);
  });

  it('every entry has non-empty what/how/concludes text', () => {
    for (const entry of EVALUATION_TOOLS_INTRO_CONTENT) {
      expect(entry.what.trim().length).toBeGreaterThan(0);
      expect(entry.how.trim().length).toBeGreaterThan(0);
      expect(entry.concludes.trim().length).toBeGreaterThan(0);
    }
  });

  // Prompt 430 §B.3
  it('every entry has a non-empty detail.purpose and at least one step', () => {
    for (const entry of EVALUATION_TOOLS_INTRO_CONTENT) {
      expect(entry.detail.purpose.trim().length).toBeGreaterThan(0);
      expect(entry.detail.steps.length).toBeGreaterThan(0);
      for (const step of entry.detail.steps) expect(step.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('shouldShowEvaluationToolsIntro — Prompt 420 §B.1/§B.3', () => {
  it('shows on a fresh session with no mute flag', () => {
    expect(shouldShowEvaluationToolsIntro({ muted: false, shownThisSession: false })).toBe(true);
  });

  it('never shows again within the same session once shown, even unmuted', () => {
    expect(shouldShowEvaluationToolsIntro({ muted: false, shownThisSession: true })).toBe(false);
  });

  it('never shows once muted, even on a session that has not shown it yet', () => {
    expect(shouldShowEvaluationToolsIntro({ muted: true, shownThisSession: false })).toBe(false);
  });

  it('stays hidden when both muted and already shown this session', () => {
    expect(shouldShowEvaluationToolsIntro({ muted: true, shownThisSession: true })).toBe(false);
  });
});
