import { describe, expect, it } from 'vitest';
import { fetchExternalPage } from './safe-external-fetch';

// Prompt 512 asks for the validation path to be exercised against at least
// one REAL non-LinkedIn URL (https://clave.capital/equipo/ is the prompt's
// own example). That is a live network call, so it is gated behind an env
// var rather than left in the default suite: a test that fails when a third
// party's marketing site is redesigned is a false alarm, not a regression.
//
//   LIVE_FETCH_TEST=1 npx vitest run src/lib/safe-external-fetch.live.test.ts
const LIVE = process.env.LIVE_FETCH_TEST === '1';

describe.runIf(LIVE)('fetchExternalPage against a real VC team page', () => {
  it('fetches https://clave.capital/equipo/ through every gate', async () => {
    const result = await fetchExternalPage('https://clave.capital/equipo/');
    if (!result.ok) throw new Error(`expected a fetch, got: ${result.reason}`);

    expect(result.text.length).toBeGreaterThan(500);
    expect(result.finalUrl).toContain('clave.capital');
  }, 20000);

  it('refuses the same host over http', async () => {
    const result = await fetchExternalPage('http://clave.capital/equipo/');
    expect(result.ok).toBe(false);
  });
});
