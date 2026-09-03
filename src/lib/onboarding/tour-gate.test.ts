import { describe, expect, it } from 'vitest';
import { addHold, removeHold, tourMayOpen, toursHeld } from './tour-gate';

// Prompt 549 — the four cases from Correção 3 §9, as a table.
//
// The bug: the Vault privacy notice resolves asynchronously, PageTour opened
// the instant OnboardingProvider's `loaded` flipped, and the tour's z-[60]
// backdrop sits above the notice's z-50 — so on a first visit the tour won
// the race and the notice rendered underneath it, with "Got it" unreachable.
// `held` is the term that was missing.

describe('tourMayOpen — the gate PageTour asks before opening', () => {
  const base = { loaded: true, held: false, seen: false, stepCount: 7 };

  it('opens when everything is ready and nothing is holding', () => {
    expect(tourMayOpen(base)).toBe(true);
  });

  it('stays shut while a blocking overlay holds — THE fix', () => {
    expect(tourMayOpen({ ...base, held: true })).toBe(false);
  });

  it('stays shut before the provider has loaded', () => {
    expect(tourMayOpen({ ...base, loaded: false })).toBe(false);
  });

  it('stays shut once this page tour has been seen', () => {
    expect(tourMayOpen({ ...base, seen: true })).toBe(false);
  });

  it('stays shut when the page has no tour content', () => {
    expect(tourMayOpen({ ...base, stepCount: 0 })).toBe(false);
  });

  // Correção 3 §9's own table, verbatim. `held` is true exactly while the
  // notice is 'pending' or 'open', and false once it is 'done'.
  const CASES: { name: string; noticeDue: boolean; seen: boolean; whileNotice: boolean; afterGotIt: boolean }[] = [
    { name: 'A — notice due, tour unseen', noticeDue: true, seen: false, whileNotice: false, afterGotIt: true },
    { name: 'B — notice not due, tour unseen', noticeDue: false, seen: false, whileNotice: false, afterGotIt: true },
    { name: 'C — notice due, tour already seen', noticeDue: true, seen: true, whileNotice: false, afterGotIt: false },
    { name: 'D — notice not due, tour already seen', noticeDue: false, seen: true, whileNotice: false, afterGotIt: false },
  ];

  for (const c of CASES) {
    it(`case ${c.name}`, () => {
      // While the notice is unresolved or on screen, the page holds.
      expect(tourMayOpen({ loaded: true, held: true, seen: c.seen, stepCount: 7 }))
        .toBe(c.whileNotice);
      // Once it is done (acknowledged, or never due), the hold clears.
      expect(tourMayOpen({ loaded: true, held: false, seen: c.seen, stepCount: 7 }))
        .toBe(c.afterGotIt);
    });
  }

  it('case A is the regression: the tour must NOT be open while the notice is up', () => {
    // Before this fix the same inputs returned true, which is precisely how
    // the notice ended up under a full-screen backdrop.
    const duringNotice = { loaded: true, held: true, seen: false, stepCount: 7 };
    expect(tourMayOpen(duringNotice)).toBe(false);
    // ...and it opens by itself the moment the hold clears — no second
    // click, no refresh, no timer.
    expect(tourMayOpen({ ...duringNotice, held: false })).toBe(true);
  });

  it('a held tour that was already seen stays shut after release too (case C)', () => {
    expect(tourMayOpen({ loaded: true, held: true, seen: true, stepCount: 7 })).toBe(false);
    expect(tourMayOpen({ loaded: true, held: false, seen: true, stepCount: 7 })).toBe(false);
  });
});

// Prompt 549 — the hold registry. OnboardingProvider's holdTours/releaseTours
// are thin wrappers over these, so this is the shipped logic, not a copy.
describe('the hold registry', () => {
  const empty: ReadonlySet<string> = new Set();

  it('starts unheld', () => {
    expect(toursHeld(empty)).toBe(false);
  });

  it('a hold holds; releasing it releases', () => {
    const held = addHold(empty, 'vault-privacy-notice');
    expect(toursHeld(held)).toBe(true);
    expect(toursHeld(removeHold(held, 'vault-privacy-notice'))).toBe(false);
  });

  it('two overlays can hold at once, and one release does not free the other', () => {
    // The Vault notice and the WelcomeModal can genuinely be up together on
    // a first login. A boolean flag would have let either one's close start
    // the tour under the other.
    let holds = addHold(addHold(empty, 'vault-privacy-notice'), 'welcome-modal');
    expect(toursHeld(holds)).toBe(true);
    holds = removeHold(holds, 'welcome-modal');
    expect(toursHeld(holds)).toBe(true);
    holds = removeHold(holds, 'vault-privacy-notice');
    expect(toursHeld(holds)).toBe(false);
  });

  it('releasing a key that was never held is a no-op, not a throw', () => {
    // An effect cleanup can fire after the key is already gone.
    expect(toursHeld(removeHold(empty, 'never-held'))).toBe(false);
    const held = addHold(empty, 'a');
    expect(removeHold(held, 'b')).toBe(held);
  });

  it('returns the SAME instance when nothing changed, a NEW one when it did', () => {
    // Identity is the contract React state depends on: mutating in place
    // would leave the provider without a re-render, and PageTour would never
    // learn the hold appeared. Returning the same instance on a no-op is
    // what stops a repeated hold from looping renders.
    const held = addHold(empty, 'a');
    expect(addHold(held, 'a')).toBe(held);
    expect(addHold(held, 'b')).not.toBe(held);
    expect(removeHold(held, 'a')).not.toBe(held);
  });

  it('holding twice and releasing once still releases — holds are keyed, not counted', () => {
    // Deliberate: a component that re-registers the same key on re-render
    // must not need a matching number of releases to ever let go.
    const held = addHold(addHold(empty, 'a'), 'a');
    expect(toursHeld(removeHold(held, 'a'))).toBe(false);
  });
});
