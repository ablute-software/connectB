import { describe, expect, it } from 'vitest';
import { shouldShowInstallPrompt, INSTALL_PROMPT_DAYS_THRESHOLD, INSTALL_PROMPT_SESSIONS_THRESHOLD } from './pwa-install';

const NOW = new Date('2026-08-02T12:00:00Z');

describe('shouldShowInstallPrompt', () => {
  it('shows on the very first visit (never dismissed before)', () => {
    expect(shouldShowInstallPrompt({ dismissedAt: null, sessionsSinceDismiss: 0 }, NOW)).toBe(true);
  });

  it('stays hidden right after a dismiss, with few sessions and little time elapsed', () => {
    expect(shouldShowInstallPrompt({ dismissedAt: NOW.toISOString(), sessionsSinceDismiss: 0 }, NOW)).toBe(false);
    const oneDayLater = new Date(NOW.getTime() + 1 * 86_400_000);
    expect(shouldShowInstallPrompt({ dismissedAt: NOW.toISOString(), sessionsSinceDismiss: 1 }, oneDayLater)).toBe(false);
  });

  it(`shows again once ${INSTALL_PROMPT_DAYS_THRESHOLD} days have passed, regardless of session count`, () => {
    const laterEnough = new Date(NOW.getTime() + INSTALL_PROMPT_DAYS_THRESHOLD * 86_400_000);
    expect(shouldShowInstallPrompt({ dismissedAt: NOW.toISOString(), sessionsSinceDismiss: 0 }, laterEnough)).toBe(true);
  });

  it(`shows again once ${INSTALL_PROMPT_SESSIONS_THRESHOLD} sessions have passed, regardless of elapsed time`, () => {
    expect(shouldShowInstallPrompt({ dismissedAt: NOW.toISOString(), sessionsSinceDismiss: INSTALL_PROMPT_SESSIONS_THRESHOLD }, NOW)).toBe(true);
  });

  it('whichever threshold comes first wins', () => {
    const almostThreeDays = new Date(NOW.getTime() + (INSTALL_PROMPT_DAYS_THRESHOLD - 1) * 86_400_000);
    expect(shouldShowInstallPrompt({ dismissedAt: NOW.toISOString(), sessionsSinceDismiss: INSTALL_PROMPT_SESSIONS_THRESHOLD }, almostThreeDays)).toBe(true);
  });
});
