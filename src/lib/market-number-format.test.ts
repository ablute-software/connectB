// The Readiness › Market tab is English copy with money in it. A bare `toLocaleString()` there follows the READER'S machine — "6 000 000 000" in a pt-PT browser,
// "6,000,000,000" on the server and in an en-US browser — and the tab then mixes both (and market-facts-view's own test failed on every full run on a pt-PT machine).
// Every number on it names its locale ('en-US', as format-money.ts, deal-terms.ts and the other money formatters do). This closes the set: the market libraries and
// the cards of the tab. The same bare call exists elsewhere in the app (backoffice, MatchDeal, the snapshot text…): see DECISIONS.md — those are a separate decision.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(path.join(SRC, dir)).filter(keep).map((n) => path.join(dir, n));
}
const FILES = [
  ...files('lib', (n) => /^market-.*\.ts$/.test(n) && !/\.test\.ts$/.test(n)),
  ...files('components/readiness/market', (n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)),
];

describe('the Market tab names its number locale', () => {
  it('covers the files it should (a rename or a move would silently empty this list)', () => {
    expect(FILES).toContain(path.join('lib', 'market-facts-view.ts'));
    expect(FILES).toContain(path.join('lib', 'market-document-extract.ts'));
    for (const card of ['MarketRingsCard.tsx', 'CompetitorsCard.tsx', 'ComparableRoundsCard.tsx', 'MarketFactsCard.tsx', 'MarketSizeCard.tsx']) {
      expect(FILES, card).toContain(path.join('components/readiness/market', card));
    }
    expect(FILES.length).toBeGreaterThanOrEqual(30);
  });

  it('none of them calls toLocaleString() with no locale (or with undefined, which is the same thing)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment may well mention the call
        if (/\.toLocaleString\(\s*(undefined\s*[,)]|\))/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, "name the locale: n.toLocaleString('en-US')").toEqual([]);
  });
});
