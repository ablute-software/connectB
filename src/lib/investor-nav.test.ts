// Prompt 548 Part 1 — the guest sidebar and the real one are the same list.
// These freeze order and labels because the bug being fixed was drift: the
// hand-typed guest copy still said "Access granted" two prompts after the
// workspace renamed it, and had lost four entries entirely.
import { describe, it, expect } from 'vitest';
import { GUEST_PREVIEWABLE_KEYS, INVESTOR_NAV, INVESTOR_NAV_KEYS, isGuestPreviewableKey } from './investor-nav';

describe('INVESTOR_NAV', () => {
  it('is the workspace nav, in order', () => {
    expect(INVESTOR_NAV_KEYS).toEqual([
      'about', 'access', 'pipeline', 'dashboard', 'evaluation',
      'actions', 'agenda', 'network', 'messages', 'plans', 'support',
    ]);
  });

  it('uses the CURRENT labels — "Data room", never the renamed-away "Access granted"', () => {
    const byKey = Object.fromEntries(INVESTOR_NAV.map((n) => [n.key, n.label]));
    expect(byKey.access).toBe('Data room');
    expect(Object.values(byKey)).not.toContain('Access granted');
    expect(byKey.dashboard).toBe('Dashboard');
    expect(byKey.actions).toBe('Actions required');
    expect(byKey.network).toBe('My Network');
    expect(byKey.messages).toBe('Messages');
  });

  it('keeps the six groups, each entry in exactly one', () => {
    expect(new Set(INVESTOR_NAV.map((n) => n.group))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    // Groups are contiguous in the list — the sidebar draws a separator on
    // each change, so an out-of-order entry would split its own group.
    const groups = INVESTOR_NAV.map((n) => n.group);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
  });

  it('gives every entry an icon and a label, and no duplicate keys', () => {
    for (const n of INVESTOR_NAV) {
      expect(n.icon.trim()).not.toBe('');
      expect(n.label.trim()).not.toBe('');
    }
    expect(new Set(INVESTOR_NAV_KEYS).size).toBe(INVESTOR_NAV.length);
  });
});

describe('guest previewability', () => {
  it('previews every entry except the Data room', () => {
    // 'access' is not a tool to preview — it is the share the guest already
    // has, so the guest sidebar links it back to their own documents.
    expect(GUEST_PREVIEWABLE_KEYS).toEqual(INVESTOR_NAV_KEYS.filter((k) => k !== 'access'));
    expect(GUEST_PREVIEWABLE_KEYS).toHaveLength(10);
  });

  it('recognises exactly those keys, and nothing else', () => {
    for (const k of GUEST_PREVIEWABLE_KEYS) expect(isGuestPreviewableKey(k)).toBe(true);
    for (const k of ['access', 'archive', '', 'PIPELINE', '../admin']) {
      expect(isGuestPreviewableKey(k)).toBe(false);
    }
  });
});
