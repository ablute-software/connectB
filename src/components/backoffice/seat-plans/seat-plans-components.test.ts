// Prompt 904 Adenda 1 (v2) — what the back-office page shows for the two things that depend on state a click
// should not be able to get wrong: the shortcut that replaces the creation form, and a code's row (a used code
// has no Delete, it says who used it). Rendered to static markup, like the Calls component tests.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CodeRow, ExistingPlanShortcut } from './FirmManager';
import { seatTabHref } from '@/lib/seat-plans-view';
import type { Code } from './shared';

const code = (o: Partial<Code>): Code => ({
  id: 'c1', codeHint: 'AB12', seats: 10, status: 'active', expiresAt: '2999-01-01T00:00:00Z', redeemedAt: null, redeemedByEmail: null, createdAt: '2026-10-01T00:00:00Z', ...o,
});
const row = (c: Code) => renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement(CodeRow, { c, act: async () => null }))));

describe('sub-tab 1: a firm that already has a plan', () => {
  it('shows the line and the button, in the exact words', () => {
    const html = renderToStaticMarkup(createElement(ExistingPlanShortcut, { onOpen: () => {} }));
    expect(html).toContain('This firm already has a custom plan');
    expect(html).toContain('Open in Firms with a custom plan');
  });
});

describe('a code\'s row', () => {
  it('a code never used offers Revoke and Delete', () => {
    const html = row(code({}));
    expect(html).toContain('Revoke');
    expect(html).toContain('Delete');
  });
  it('a revoked code, and an expired one, can be deleted but not revoked again', () => {
    for (const c of [code({ status: 'revoked' }), code({ expiresAt: '2020-01-01T00:00:00Z' })]) {
      const html = row(c);
      expect(html).toContain('Delete');
      expect(html).not.toContain('Revoke');
    }
  });
  it('a used code has no Delete: it says when and by whom instead', () => {
    const html = row(code({ status: 'redeemed', redeemedAt: '2026-10-02T09:30:00Z', redeemedByEmail: 'owner@firm.com' }));
    expect(html).not.toContain('Delete');
    expect(html).not.toContain('Revoke');
    expect(html).toContain('Used on 2026-10-02 by owner@firm.com');
  });
  it('shows only the tail of the code, never the code', () => {
    expect(row(code({}))).toContain('PD-…-AB12');
  });
});

describe('the sub-tab lives in the URL', () => {
  it('the default sub-tab is the bare path; the others carry ?tab=, and the open firm ?firm=', () => {
    expect(seatTabHref('/backoffice/seat-plans', 'create')).toBe('/backoffice/seat-plans');
    expect(seatTabHref('/backoffice/seat-plans', 'plans')).toBe('/backoffice/seat-plans?tab=plans');
    expect(seatTabHref('/backoffice/seat-plans', 'plans', 'abc')).toBe('/backoffice/seat-plans?tab=plans&firm=abc');
    expect(seatTabHref('/backoffice/seat-plans', 'create', 'abc')).toBe('/backoffice/seat-plans?firm=abc');
    expect(seatTabHref('/backoffice/seat-plans', 'ended')).toBe('/backoffice/seat-plans?tab=ended');
    expect(seatTabHref('/backoffice/seat-plans', 'history')).toBe('/backoffice/seat-plans?tab=history');
  });
});
