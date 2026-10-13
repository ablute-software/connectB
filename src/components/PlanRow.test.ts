// Prompt 914 — the Plan line of the Organisation card. Rendered with react-dom/server (no DOM library in this repo).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanRow } from './PlanRow';
import { describePlanOrigin } from '@/lib/effective-plan';

const render = (plan: 'idea' | 'garage' | 'motherfunding', originText: string) => renderToStaticMarkup(createElement(PlanRow, { plan, originText }));
const date = (iso: string) => iso.slice(0, 10);

describe('PlanRow', () => {
  it('a plain plan is just its name — nothing under it', () => {
    const html = render('garage', '');
    expect(html).toContain('List of Suspects');
    expect(html).not.toContain('org-plan-origin');
  });

  it('on a free trial it names the plan AND says why (the answer to "I redeemed a code and it still says Elementary")', () => {
    const html = render('motherfunding', describePlanOrigin({ kind: 'free_trial', code: 'PIONEER_100', until: '2027-01-08T22:52:27.255+00:00' }, date));
    expect(html).toContain("It&#x27;s the butler!");
    expect(html).toContain('free trial via PIONEER_100 until 2027-01-08');
    expect(html).toContain('data-testid="org-plan-origin"');
  });

  it('a platform badge says which status makes it free', () => {
    expect(render('motherfunding', describePlanOrigin({ kind: 'badge', badge: 'tech_master', until: null }, date))).toContain('free through your tech master status');
  });
});
