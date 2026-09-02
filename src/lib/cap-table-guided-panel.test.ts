// Prompt 542 §1 — the guided-questions panel stops being the default view
// once the cap table has rows.
import { describe, it, expect } from 'vitest';
import { capTableGuidedPanelOpen } from './cap-table';

describe('capTableGuidedPanelOpen', () => {
  it('opens by itself for an empty cap table — it is the way in', () => {
    expect(capTableGuidedPanelOpen({ hasRows: false, userToggled: null })).toBe(true);
  });

  it('stays collapsed once the table has rows', () => {
    // The bug: a founder with four entries still met a "let us help you
    // start" panel underneath them.
    expect(capTableGuidedPanelOpen({ hasRows: true, userToggled: null })).toBe(false);
  });

  it('lets an explicit click win over the default, both ways', () => {
    expect(capTableGuidedPanelOpen({ hasRows: true, userToggled: true })).toBe(true);
    expect(capTableGuidedPanelOpen({ hasRows: false, userToggled: false })).toBe(false);
  });

  it('follows the table again only until the founder decides, not after', () => {
    // Guards the reason userToggled is nullable rather than seeded from
    // hasRows: the store loads asynchronously, so the first render can see
    // hasRows=false for a table that does have rows. Once the rows arrive
    // the default must correct itself — which it does, because nothing was
    // latched at mount.
    expect(capTableGuidedPanelOpen({ hasRows: false, userToggled: null })).toBe(true);
    expect(capTableGuidedPanelOpen({ hasRows: true, userToggled: null })).toBe(false);
  });

  it('always opens for an investor deep link, whatever the table looks like', () => {
    expect(capTableGuidedPanelOpen({ hasRows: true, userToggled: null, deepLinked: true })).toBe(true);
    expect(capTableGuidedPanelOpen({ hasRows: true, userToggled: false, deepLinked: true })).toBe(true);
  });
});
