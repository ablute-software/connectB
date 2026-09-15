import { describe, expect, it } from 'vitest';
import { CHUNK_RELOAD_GUARD_KEY, isChunkLoadError, shouldAutoReloadForChunkError } from './chunk-error-recovery';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

describe('isChunkLoadError', () => {
  it('recognizes the exact production error message', () => {
    expect(isChunkLoadError('ChunkLoadError: Loading chunk 9668 failed.')).toBe(true);
  });
  it('recognizes a CSS chunk failure and a dynamic-import failure too', () => {
    expect(isChunkLoadError('Loading CSS chunk 42 failed')).toBe(true);
    expect(isChunkLoadError('error loading dynamically imported module: https://…')).toBe(true);
  });
  it('does not misfire on an unrelated error', () => {
    expect(isChunkLoadError('TypeError: Cannot read properties of undefined')).toBe(false);
  });
  it('is false for empty/absent messages', () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('')).toBe(false);
  });
});

describe('shouldAutoReloadForChunkError — the guard that prevents a reload loop', () => {
  it('the first failure this tab has seen says yes, and sets the flag', () => {
    const storage = fakeStorage();
    expect(shouldAutoReloadForChunkError(storage)).toBe(true);
    expect(storage.getItem(CHUNK_RELOAD_GUARD_KEY)).toBe('1');
  });
  it('a second failure (flag already set) says no — never reloads twice', () => {
    const storage = fakeStorage();
    expect(shouldAutoReloadForChunkError(storage)).toBe(true);
    expect(shouldAutoReloadForChunkError(storage)).toBe(false);
    expect(shouldAutoReloadForChunkError(storage)).toBe(false);
  });
});
