import { describe, it, expect } from 'vitest';
import { commitmentsGateEnabled, getCommitments, isCommitmentsVersion, shouldGateCommitments, COMMITMENTS_VERSION } from './commitments';
import { COMMITMENT_GROUPS } from '../content/commitments/v1';

describe('Prompt 603 — commitments gate', () => {
  it('the gate is off unless the environment switches it on', () => {
    expect(commitmentsGateEnabled({})).toBe(false);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: '1' })).toBe(true);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: 'true' })).toBe(true);
    expect(commitmentsGateEnabled({ COMMITMENTS_GATE_ENABLED: '0' })).toBe(false);
  });

  it('gates a signed-in founder without the current version, nobody else', () => {
    const base = { gateEnabled: true, signedIn: true, isFounder: true, acceptedVersion: null };
    expect(shouldGateCommitments(base)).toBe(true);
    expect(shouldGateCommitments({ ...base, acceptedVersion: COMMITMENTS_VERSION })).toBe(false);
    expect(shouldGateCommitments({ ...base, acceptedVersion: 'commitments-0.9' })).toBe(true);
    expect(shouldGateCommitments({ ...base, isFounder: false })).toBe(false);
    expect(shouldGateCommitments({ ...base, signedIn: false })).toBe(false);
    expect(shouldGateCommitments({ ...base, gateEnabled: false })).toBe(false);
  });

  // Prompt 608 §D — was `expect(numbers.includes(6)).toBe(AI_TRAINING_LINE_CONFIRMED)`,
  // which passed whichever way the flag was set and so asserted nothing about
  // the thing that mattered. The AI-training promise is now OUT of the
  // structure, not dormant inside it, and this test says so flatly: nine
  // entries, no 6, and no flag to flip.
  it('the AI-training promise is not in the structure at all', () => {
    const numbers = getCommitments().map((c) => c.n);
    expect(numbers).toHaveLength(9);
    expect(numbers).not.toContain(6);
    expect(numbers).toContain(1);
    expect(numbers).toContain(10);
    // The gap is deliberate: `n` names a commitment inside a published version.
    expect(numbers).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10]);
  });

  it('every commitment belongs to one of the three rendered groups', () => {
    const keys = COMMITMENT_GROUPS.map((g) => g.key);
    for (const c of getCommitments()) expect(keys).toContain(c.group);
    // None of the three sections may render empty on the page.
    for (const k of keys) expect(getCommitments().some((c) => c.group === k)).toBe(true);
  });

  it('the acceptance version is namespaced away from the Terms versions', () => {
    expect(isCommitmentsVersion(COMMITMENTS_VERSION)).toBe(true);
    expect(isCommitmentsVersion('3.0')).toBe(false);
  });

  it('every commitment that names a feature links somewhere inside the app', () => {
    for (const c of getCommitments()) {
      if (c.link) expect(c.link.href.startsWith('/')).toBe(true);
    }
    expect(getCommitments().find((c) => c.n === 3)?.link?.href).toBe('/documents/access-log');
    expect(getCommitments().find((c) => c.n === 9)?.link?.href).toBe('/privacy-request');
    expect(getCommitments().find((c) => c.n === 7)?.link?.href).toBe('/legal/subprocessors');
  });
});
