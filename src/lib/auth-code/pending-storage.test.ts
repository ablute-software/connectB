// Prompt 911 — "the form is not lost between Create account and the code; a reload comes back to the code box".
// No DOM in this repo, so window.localStorage is a plain in-memory stand-in for the duration of the test.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PENDING_TTL_MS, clearPending, readPending, writePending, type PendingSignup } from './pending-storage';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  dump() { return [...this.m.values()].join('\n'); }
}

let storage: MemoryStorage;
beforeEach(() => { storage = new MemoryStorage(); (globalThis as { window?: unknown }).window = { localStorage: storage }; });
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

const NOW = 1_700_000_000_000;
const entry = (over: Partial<PendingSignup> = {}): PendingSignup => ({
  flow: 'signup', scope: 'signup', email: 'ana@example.com', sentAt: NOW, fields: { org: 'Acme', name: 'Ana', agreedToTerms: true }, ...over,
});

describe('a reload comes back to the code box with the form filled in', () => {
  it('returns what was written for the same flow and scope', () => {
    writePending(entry());
    expect(readPending('signup', 'signup', NOW + 5 * 60_000)).toMatchObject({ email: 'ana@example.com', sentAt: NOW, fields: { org: 'Acme', name: 'Ana', agreedToTerms: true } });
  });

  it('the password is never stored, whatever the caller passes', () => {
    writePending(entry({ fields: { org: 'Acme', password: 'Correct-Horse-9!', Password2: 'x', access_token: 't' } }));
    expect(storage.dump()).not.toContain('Correct-Horse-9!');
    expect(readPending('signup', 'signup', NOW)?.fields).toEqual({ org: 'Acme' });
  });

  it('dies with the code (30 minutes) and is removed when found stale', () => {
    writePending(entry());
    expect(readPending('signup', 'signup', NOW + PENDING_TTL_MS - 1)).not.toBeNull();
    expect(readPending('signup', 'signup', NOW + PENDING_TTL_MS + 1)).toBeNull();
    expect(storage.dump()).toBe('');
  });

  it('is not another flow\'s, nor another invite\'s', () => {
    writePending(entry({ flow: 'invite', scope: 'token-A' }));
    expect(readPending('signup', 'signup', NOW)).toBeNull();
    expect(readPending('invite', 'token-B', NOW)).toBeNull();
    expect(readPending('invite', 'token-A', NOW)).not.toBeNull();
  });

  it('clearPending ("Change email", or a finished sign-up) forgets it', () => {
    writePending(entry());
    clearPending('signup');
    expect(readPending('signup', 'signup', NOW)).toBeNull();
  });

  it('garbage in storage is ignored, not thrown', () => {
    storage.setItem('sd-code-signup-pending:signup', '{not json');
    expect(readPending('signup', 'signup', NOW)).toBeNull();
    storage.setItem('sd-code-signup-pending:signup', JSON.stringify({ flow: 'signup', scope: 'signup' }));
    expect(readPending('signup', 'signup', NOW)).toBeNull();
  });

  it('without a window (server render) everything is a no-op', () => {
    delete (globalThis as { window?: unknown }).window;
    expect(readPending('signup', 'signup', NOW)).toBeNull();
    expect(() => writePending(entry())).not.toThrow();
    expect(() => clearPending('signup')).not.toThrow();
  });
});
