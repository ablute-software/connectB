// The daily tick is reachable by the platform's cron — and by nobody else without a session (22/10/2026). The comparison, as a pure function: what opens the door, and every way it must stay shut.
import { describe, expect, it } from 'vitest';
import { CRON_PATH, CRON_SECRET_MIN_LENGTH, cronSecretMatches, isCronTickRequest } from './cron-auth';

const SECRET = 'f3a9c1d5e7b2468a0c9d1e3f5a7b9c0d2e4f6a8b0c1d3e5f7a9b1c3d5e7f9a0b';

describe('cronSecretMatches — what opens the door', () => {
  it('exactly «Bearer <secret>»: the header Vercel sends on every cron call when the project has CRON_SECRET', () => {
    expect(cronSecretMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });
  it('the minimum length is 16, and a secret of exactly that length works', () => {
    expect(CRON_SECRET_MIN_LENGTH).toBe(16);
    const s = 'a'.repeat(CRON_SECRET_MIN_LENGTH);
    expect(cronSecretMatches(`Bearer ${s}`, s)).toBe(true);
  });
});

describe('cronSecretMatches — every way it stays shut', () => {
  it.each([
    ['no header at all', undefined],
    ['a null header', null],
    ['an empty header', ''],
    ['the secret without «Bearer »', SECRET],
    ['«bearer» in lower case', `bearer ${SECRET}`],
    ['a different scheme', `Basic ${SECRET}`],
    ['the wrong secret of the same length', `Bearer ${SECRET.slice(0, -1)}0`],
    ['the wrong first character', `Bearer 0${SECRET.slice(1)}`],
    ['a truncated secret', `Bearer ${SECRET.slice(0, -1)}`],
    ['the secret with something appended', `Bearer ${SECRET}x`],
    ['the secret with a trailing space', `Bearer ${SECRET} `],
    ['two spaces after Bearer', `Bearer  ${SECRET}`],
    ['just «Bearer»', 'Bearer'],
    ['just «Bearer »', 'Bearer '],
  ])('%s', (_label, header) => {
    expect(cronSecretMatches(header, SECRET)).toBe(false);
  });

  it('FAILS CLOSED when no secret is configured: nothing opens the door — not an empty header, not «Bearer undefined», not «Bearer »', () => {
    for (const secret of [undefined, null, '']) {
      for (const header of [undefined, null, '', 'Bearer', 'Bearer ', 'Bearer undefined', 'Bearer null', `Bearer ${secret}`]) {
        expect(cronSecretMatches(header, secret), `${String(secret)} / ${String(header)}`).toBe(false);
      }
    }
  });

  it('a secret that is too short is not a secret: «x», «secret», 15 characters', () => {
    for (const s of ['x', 'secret', 'a'.repeat(CRON_SECRET_MIN_LENGTH - 1)]) {
      expect(cronSecretMatches(`Bearer ${s}`, s), s).toBe(false);
    }
  });

  it('is not fooled by a header that is a prefix or an extension of the real one, or by a different length', () => {
    expect(cronSecretMatches('Bearer ', SECRET)).toBe(false);
    expect(cronSecretMatches(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(false);
  });
});

describe('isCronTickRequest — the exact path, the exact secret', () => {
  it('the tick, with the secret', () => {
    expect(CRON_PATH).toBe('/api/automations');
    expect(isCronTickRequest('/api/automations', `Bearer ${SECRET}`, SECRET)).toBe(true);
  });
  it('the secret opens THIS path only — no other route, no sub-path, no look-alike', () => {
    for (const path of ['/api/automations/', '/api/automations/x', '/api/automation', '/api/backoffice/metrics/overview', '/api/pipeline-unlock', '/', '/automations', '/api/automations?x=1']) {
      expect(isCronTickRequest(path, `Bearer ${SECRET}`, SECRET), path).toBe(false);
    }
  });
  it('the path without the secret stays behind the gate', () => {
    expect(isCronTickRequest('/api/automations', undefined, SECRET)).toBe(false);
    expect(isCronTickRequest('/api/automations', 'Bearer nope', SECRET)).toBe(false);
    expect(isCronTickRequest('/api/automations', `Bearer ${SECRET}`, undefined)).toBe(false);
  });
});
