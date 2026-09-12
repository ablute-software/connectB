import { describe, it, expect } from 'vitest';
import { commitmentsGateEnabled, getCommitments, shouldShowCommitments } from './commitments';
import { COMMITMENT_GROUPS } from '../content/commitments/v1';

describe('Prompt 603/604 — commitments gate', () => {
  it('the gate is off unless the environment switches it on', () => {
    expect(commitmentsGateEnabled({})).toBe(false);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: '1' })).toBe(true);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: 'true' })).toBe(true);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: '0' })).toBe(false);
  });

  it('shows a signed-in founder who has not been marked as seen, nobody else', () => {
    const base = { gateEnabled: true, signedIn: true, isFounder: true, seen: false };
    expect(shouldShowCommitments(base)).toBe(true);
    expect(shouldShowCommitments({ ...base, seen: true })).toBe(false);
    expect(shouldShowCommitments({ ...base, isFounder: false })).toBe(false);
    expect(shouldShowCommitments({ ...base, signedIn: false })).toBe(false);
    expect(shouldShowCommitments({ ...base, gateEnabled: false })).toBe(false);
  });

  // Prompt 604 §A removed the versioned-acceptance record that Prompt 608's
  // numbering gap existed to protect (a commitment's identity inside a
  // record someone had accepted BY NAME). Registration is now a plain
  // account-level "seen" boolean with no per-commitment tracking at all, so
  // nothing protects — or needs to protect — a gap any more. Nine entries,
  // numbered 1-9 contiguously, exactly as Prompt 604 §C's literal text does.
  it('nine commitments, numbered 1-9 with no gap', () => {
    const numbers = getCommitments().map((c) => c.n);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('every commitment belongs to one of the three rendered groups, none renders empty', () => {
    const keys = COMMITMENT_GROUPS.map((g) => g.key);
    for (const c of getCommitments()) expect(keys).toContain(c.group);
    for (const k of keys) expect(getCommitments().some((c) => c.group === k)).toBe(true);
  });

  it('every commitment that names a feature links somewhere inside the app', () => {
    for (const c of getCommitments()) {
      if (c.link) expect(c.link.href.startsWith('/')).toBe(true);
    }
    expect(getCommitments().find((c) => c.n === 3)?.link?.href).toBe('/documents/access-log');
    expect(getCommitments().find((c) => c.n === 6)?.link?.href).toBe('/legal/subprocessors');
    expect(getCommitments().find((c) => c.n === 8)?.link?.href).toBe('/privacy-request');
  });

  // Locks in the deliberate omission documented in v1.ts's own comment on
  // commitment 4: its text still promises workspace-access visibility that
  // Prompt 886/877 (2026-09-10) withdrew, so linking it to a page that no
  // longer shows that would be a second, worse promise. If this starts
  // failing because someone added a link back, the wording needs to be
  // checked against what the product actually does first.
  it('commitment 4 carries no link, since the page section it would point to no longer exists', () => {
    expect(getCommitments().find((c) => c.n === 4)?.link).toBeUndefined();
  });
});
