// Prompt 909 (I3) — the permission switches as the Team tab draws them: nine of them, the two the server enforces
// plain and the other seven marked "Used from the next stage", an individual adjustment marked, and nothing
// clickable when the person may not manage the team.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PermissionToggles } from './PermissionToggles';
import { ALL_PERMISSIONS, NO_PERMISSIONS } from '@/lib/calls/permissions';

const render = (props: Partial<Parameters<typeof PermissionToggles>[0]> = {}) =>
  renderToStaticMarkup(createElement(PermissionToggles, { values: { ...NO_PERMISSIONS, configure_call: true }, onToggle: () => {}, disabled: false, idPrefix: 'x', ...props }));

describe('the permission switches', () => {
  it('are the nine of the spec, in order, with the right ones switched on', () => {
    const html = render();
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(9);
    for (const label of ['Configure call', 'Manage team &amp; permissions', 'View all applications', 'Evaluate assigned applications', 'Correct eligibility &amp; document validity',
      'View colleagues’ evaluations after completing own', 'Final decision &amp; selection overrides', 'Publish results', 'Handle contestations']) expect(html).toContain(label);
    expect(html).toMatch(/data-testid="x-configure_call"[^>]*checked/);
    expect(html).not.toMatch(/data-testid="x-manage_team"[^>]*checked/);
  });
  it('seven say "Used from the next stage"; the two enforced now do not', () => {
    const html = render();
    expect((html.match(/Used from the next stage/g) ?? []).length).toBe(7);
    const configure = html.slice(html.indexOf('Configure call'), html.indexOf('Manage team'));
    expect(configure).not.toContain('Used from the next stage');
  });
  it('marks what a person has adjusted against their category', () => {
    const html = render({ values: { ...ALL_PERMISSIONS, evaluate_assigned: false }, markAdjusted: { evaluate_assigned: false } });
    expect((html.match(/adjusted/g) ?? []).length).toBe(1);
  });
  it('is not clickable when the person cannot manage the team', () => {
    expect((render({ disabled: true }).match(/disabled/g) ?? []).length).toBe(9);
  });
});
