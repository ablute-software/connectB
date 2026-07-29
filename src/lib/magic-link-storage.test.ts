import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMagicLinkSent, setMagicLinkSent, clearMagicLinkSent, MAGIC_LINK_COOLDOWN_MS } from './magic-link-storage';

// No jsdom in this project's test setup (Node environment only, see the
// rest of src/lib/*.test.ts) — stub the minimal localStorage surface the
// module actually uses rather than pulling in a DOM environment for one file.
function stubWindow() {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  });
}

describe('magic-link-storage', () => {
  beforeEach(() => { stubWindow(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('returns null when nothing was ever sent', () => {
    expect(getMagicLinkSent()).toBeNull();
  });

  it('round-trips email + a fresh timestamp', () => {
    setMagicLinkSent('a@b.com');
    const state = getMagicLinkSent();
    expect(state?.email).toBe('a@b.com');
    expect(state?.sentAt).toBeTruthy();
  });

  it('expires after the cooldown window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00Z'));
    setMagicLinkSent('a@b.com');
    vi.setSystemTime(new Date(new Date('2026-07-29T10:00:00Z').getTime() + MAGIC_LINK_COOLDOWN_MS + 1000));
    expect(getMagicLinkSent()).toBeNull();
  });

  it('is still valid just under the cooldown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-29T10:00:00Z'));
    setMagicLinkSent('a@b.com');
    vi.setSystemTime(new Date(new Date('2026-07-29T10:00:00Z').getTime() + MAGIC_LINK_COOLDOWN_MS - 1000));
    expect(getMagicLinkSent()?.email).toBe('a@b.com');
  });

  it('clearMagicLinkSent resets to null', () => {
    setMagicLinkSent('a@b.com');
    clearMagicLinkSent();
    expect(getMagicLinkSent()).toBeNull();
  });

  it('ignores malformed stored data instead of throwing', () => {
    window.localStorage.setItem('sd-magiclink-sent', '{not json');
    expect(getMagicLinkSent()).toBeNull();
  });
});
