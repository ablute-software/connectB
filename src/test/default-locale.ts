// A test helper: run `run` as if the machine's DEFAULT language were `locale`.
//
// `n.toLocaleString()` with no locale follows the machine — "6 000 000 000" on a pt-PT machine, "6,000,000,000" on Vercel — so a test that pins the output of such a
// call passes on one machine and fails on another (market-facts-view's did, on every full run on Nuno's, until 20/10/2026). Stubbing the DEFAULT makes a bare call
// visible on EVERY machine: a formatter that names its locale is unaffected, one that does not prints in `locale`.
import { vi } from 'vitest';

export function underDefaultLocale<T>(locale: string, run: () => T): T {
  const real = Number.prototype.toLocaleString;
  const spy = vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (this: number, locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    return real.call(this, locales ?? locale, options);
  });
  try { return run(); } finally { spy.mockRestore(); }
}
