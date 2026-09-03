import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prompt 540 RC1 — the lost update, pinned at the source.
//
// THE BUG. Each of the nine actions below captured `const prev =
// dbRef.current` BEFORE its `await sb.from(...)` and built the commit from
// that snapshot AFTER. Two overlapping calls therefore both rebuilt the whole
// list from the same stale copy, and the second commit discarded the first
// one's row. RoadmapPanel's seeding loop fired five of them at once: the
// database got all five categories (production: ablute_, Caramel Biscuit,
// Krohnsty — 5 each, one timestamp, no duplicates), while
// db.roadmapCategories kept only the last insert to resolve. A refresh ran
// loadAll and all five appeared, which is the entire reported symptom.
//
// WHY THIS TEST IS SHAPED LIKE THIS. The actions live inside the provider's
// closure and the repository has no DOM test environment (no jsdom, no
// @testing-library) — every existing test here is a pure-function test.
// Rather than add a rendering toolchain, or test a hand-written copy of the
// action bodies and call it coverage, this asserts the invariant directly
// against the shipped source: in each of these actions, the commit that
// follows an await must be built from a FRESH read, never from the snapshot
// captured before it. It fails on main today and it fails again the moment
// someone reintroduces the pattern. roadmap-seed.test.ts covers the
// behaviour end to end for the one path that could be extracted.
const SOURCE = readFileSync(join(process.cwd(), 'src/lib/store-supabase.tsx'), 'utf8');

const AWAITING_ACTIONS = [
  'addTractionMetric', 'addRoadmapCategory', 'removeRoadmapCategory',
  'addFundingRound', 'removeFundingRound', 'addCapTableEntry',
  'removeCapTableEntry', 'addRoadmapMilestone', 'addRoadmapEvent',
];

/** The source of one `async name(...) { ... }` method, by brace balance. */
function actionBody(name: string): string {
  const start = SOURCE.indexOf(`async ${name}(`);
  expect(start, `${name} should exist in store-supabase.tsx`).toBeGreaterThan(-1);
  const open = SOURCE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++;
    else if (SOURCE[i] === '}') {
      depth--;
      if (depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  throw new Error(`could not find the end of ${name}`);
}

describe('Prompt 540 RC1 — no action commits from a snapshot taken before its await', () => {
  for (const name of AWAITING_ACTIONS) {
    it(`${name} commits from a fresh read`, () => {
      const body = actionBody(name);
      // These are the nine that actually await the network mid-action.
      expect(body).toContain('await sb.from');
      const commits = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('commit({'));
      expect(commits.length, `${name} should commit exactly once`).toBe(1);
      // The invariant: the commit spreads the CURRENT snapshot, not `prev`.
      expect(commits[0], `${name} still commits from the pre-await snapshot`).not.toContain('...prev');
      expect(body).toContain('const cur = dbRef.current;');
    });
  }

  it('covers every action the audit found, and none silently dropped', () => {
    expect(AWAITING_ACTIONS).toHaveLength(9);
    expect(new Set(AWAITING_ACTIONS).size).toBe(9);
  });

  it('the seeding loop that multiplied the bug is gone from RoadmapPanel', () => {
    const panel = readFileSync(join(process.cwd(), 'src/components/company/RoadmapPanel.tsx'), 'utf8');
    // Five concurrent addRoadmapCategory calls, replaced by one action.
    expect(panel).not.toContain('for (const lane of DEFAULT_LANES)');
    expect(panel).toContain('seedRoadmapCategories(DEFAULT_LANES)');
    // And the effect no longer runs while the initial load is in flight.
    expect(panel).toContain('loading');
  });
});
