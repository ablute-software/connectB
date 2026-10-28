// Prompt 918 (I1) — the call's steps and the new wording of General, as the screens draw them. Static markup: what is written, which controls exist, which are off. The three widths
// were verified in a real browser (docs/calls/screenshots-918-i1); here, that what makes them adapt is in the markup and cannot be dropped by accident.
import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { stepStates } from '@/lib/calls/editor-nav';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import { newField } from '@/lib/calls/form-builder';
import { readiness } from '@/lib/calls/lifecycle';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }), authEnabled: false }));

import { ComingNext, SetupShell } from './SetupShell';
import { GeneralTab } from './GeneralTab';
import { PreviewTab } from './PreviewTab';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const call = (over: Partial<Call> = {}): Call => ({
  id: 'c1', name: 'INNOV-ID', description: null, opensAt: '2026-11-01T09:00:00.000Z', closesAt: null, timezone: 'Europe/Lisbon', visibility: 'listed', limitUnit: 'project', allowMultiple: false,
  contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null, configVersion: 1, validatedAt: null, contactEmail: null, promoterKind: 'catalog_entity', promoterId: 'p1', ...over,
} as Call);
const phases: CallPhase[] = [{ id: 'ph-1', callId: 'c1', position: 0, name: 'Applications', startsOn: '2026-11-01', endsOn: '2026-12-01' } as CallPhase];
const fields: FormField[] = [{ ...newField('short_text', 1, 0), id: 'q-1', label: 'Company name' }];
const issues = (c: Call) => readiness(c, phases, fields, new Date('2026-10-16T12:00:00Z'));
const states = (c: Call) => stepStates({ call: c, phases, fields, issues: issues(c), teamMembers: 0 });

describe('the steps of Setup', () => {
  const html = (step: Parameters<typeof SetupShell>[0]['step'] = 'form') => render(createElement(SetupShell, { step, states: states(call()), onStep: () => {} }, createElement('p', null, 'the step')));

  it('lists the seven steps in order, each with its state in words and its sign', () => {
    const h = html();
    const order = [...h.matchAll(/data-testid="step-(general|phases|form|eligibility|team|grid|review)"/g)].map((m) => m[1]);
    expect(order.slice(0, 7)).toEqual(['general', 'phases', 'form', 'eligibility', 'team', 'grid', 'review']);
    expect(h).toContain('Eligibility rules');
    expect(h).toContain('Team &amp; distribution');
    expect(h).toContain('Evaluation grid');
    expect(h).toContain('Review &amp; publish');
    expect(h).toContain('1 to fix');            // General (no closing date) and Review
    expect(h).toContain('Complete');
    expect(h).not.toContain('Coming next');     // Eligibility rules is a real step now (Prompt 918, I2)
    expect(h).toContain('Not started');         // Team
    expect(h).toContain('⚠'); expect(h).toContain('✓'); expect(h).toContain('○');
  });

  it('marks the current step, and shows its content', () => {
    const h = html('phases');
    expect((h.match(/aria-current="step"/g) ?? []).length).toBe(1);          // the side list (the folded list is closed until it is opened)
    expect(h).toMatch(/aria-current="step"[^>]*data-testid="step-phases"/);
    expect(h).toContain('the step');
  });

  it('wide screen: the list is on the side and sticks; narrower: one button — "Steps" on a tablet, "Step 3 of 7: Form" on a phone', () => {
    const h = html('form');
    expect(h).toMatch(/<nav[^>]*class="[^"]*hidden[^"]*lg:block[^"]*"[^>]*data-testid="steps-side"/);
    expect(h).toMatch(/lg:sticky/);
    expect(h).toMatch(/<div[^>]*class="[^"]*lg:hidden"[^>]*data-testid="steps-fold"/);
    expect(h).toContain('Step 3 of 7: Form');
    expect(h).toMatch(/<span class="hidden md:inline">Steps<\/span>/);
    expect(h).toContain('aria-expanded="false"');
  });

  it('Previous and Next close every step, and the ends have only one', () => {
    expect(html('form')).toMatch(/data-testid="step-prev"[\s\S]*data-testid="step-next"/);
    const first = html('general'); expect(first).not.toContain('data-testid="step-prev"'); expect(first).toContain('data-testid="step-next"');
    const last = html('review'); expect(last).toContain('data-testid="step-prev"'); expect(last).not.toContain('data-testid="step-next"');
  });

  it('every control a finger has to hit is at least 44 px high (the step buttons, the folded button, Previous and Next)', () => {
    const h = html('form');
    for (const id of ['steps-button', 'step-prev', 'step-next', 'step-general']) {
      const tag = h.slice(h.lastIndexOf('<', h.indexOf(`data-testid="${id}"`)), h.indexOf('>', h.indexOf(`data-testid="${id}"`)) + 1);
      expect(tag, id).toContain('min-h-[44px]');
    }
  });

  it('what is not built yet says so, plainly', () => {
    const h = render(createElement(ComingNext, { testId: 'x', title: 'Evaluation grid', text: 'Coming in the next stage.' }));
    expect(h).toContain('Evaluation grid'); expect(h).toContain('Coming in the next stage.');
  });
});

describe('General: the two clear choices', () => {
  const h = (c = call(), disabled = false) => render(createElement(GeneralTab, { call: c, promoterName: 'ablute_', disabled, onChange: () => {} }));
  it('"Count applications by" and "Each one can submit" — radio buttons, no check box, no "Applications per…"', () => {
    const out = h();
    expect(out).toContain('Count applications by');
    expect(out).toContain('Project / startup');
    expect(out).toContain('Legal entity (company)');
    expect(out).toContain('Each one can submit');
    expect(out).toContain('Only one application');
    expect(out).toContain('More than one application');
    expect(out).not.toContain('Applications per');
    expect(out).not.toContain('Allow more than one');
    expect(out).not.toContain('type="checkbox"');
    expect(out).not.toContain('Application limit');
  });
  it('the saved values do not change: project / one application is selected for limit_unit "project" and allow_multiple false', () => {
    const out = h();
    expect(out).toMatch(/name="limit-unit"[^>]*checked=""[^>]*\/><span>Project \/ startup/);
    expect(out).toMatch(/name="allow-multiple"[^>]*checked=""[^>]*\/><span>Only one application/);
    const other = h(call({ limitUnit: 'legal_entity', allowMultiple: true }));
    expect(other).toMatch(/name="limit-unit"[^>]*checked=""[^>]*\/><span>Legal entity/);
    expect(other).toMatch(/name="allow-multiple"[^>]*checked=""[^>]*\/><span>More than one application/);
  });
  it('read-only (a validated call): both choices are off', () => {
    const out = h(call({ status: 'validated' } as Partial<Call>), true);
    for (const n of ['limit-unit', 'allow-multiple']) expect([...out.matchAll(new RegExp(`name="${n}"[^>]*>`, 'g'))].every((m) => m[0].includes('disabled=""'))).toBe(true);
  });
  it('the fields "What is missing" can lead to carry their jump marks', () => {
    const out = h();
    for (const t of ['name', 'opens', 'closes']) expect(out).toContain(`data-jump="${t}"`);
  });
});

describe('Review & publish: "What is missing" goes to the step', () => {
  it('each missing thing has a button that names the step it leads to', () => {
    const c = call();
    const out = render(createElement(PreviewTab, {
      call: c, effectiveStatus: 'draft', phases, fields, issues: issues(c), summary: { phases: 1, pages: 1, fields: 1, questions: 1, documents: 0, required: 0, mapped: 0, conditional: 0 },
      actions: { confirm: { ok: false, reason: 'x' }, edit: { ok: false }, publish: { ok: false }, extend: { ok: false }, close: { ok: false }, archive: { ok: false }, delete: { ok: true } } as never,
      canManage: true, busy: false, error: '', origin: 'https://x.test', onJump: () => {}, onAction: () => {},
    }));
    expect(out).toContain('Set the closing date and time.');
    expect(out).toContain('Go to General');
    expect(out).toContain('data-testid="missing-go"');
    expect(out).toMatch(/data-testid="missing-go"[^>]*class="[^"]*min-h-\[44px\]/);
  });
});

describe('the editor and the touch rule', () => {
  const css = fs.readFileSync(`${process.cwd()}/src/app/globals.css`, 'utf8');
  it('one rule makes every control at least 44 px on a handheld or touch screen, scoped to the call editor', () => {
    expect(css).toMatch(/@media \(max-width: 1023px\), \(pointer: coarse\) \{[\s\S]*\[data-calls-touch\] button[\s\S]*min-height: 44px/);
  });
  it('the editor, and the full-screen question panel (a portal, outside the editor), both carry the mark', () => {
    expect(fs.readFileSync(`${process.cwd()}/src/components/calls/CallEditor.tsx`, 'utf8')).toMatch(/data-testid="call-editor" data-calls-touch/);
    const form = fs.readFileSync(`${process.cwd()}/src/components/calls/FormTab.tsx`, 'utf8');
    expect(form).toMatch(/data-testid="field-fullscreen" data-calls-touch/);
    expect(form).toContain('createPortal(');
    expect(form).toContain('grid-cols-[minmax(0,1fr)]');                       // without it the question list pushes the page wider than the screen
  });
  it('the Applications list is cards on a phone and the table from a tablet up', () => {
    const subs = fs.readFileSync(`${process.cwd()}/src/components/calls/SubmissionsTab.tsx`, 'utf8');
    expect(subs).toContain('data-testid="submission-cards"');
    expect(subs).toMatch(/className="mt-4 space-y-2 sm:hidden" data-testid="submission-cards"/);
    expect(subs).toMatch(/<div className="hidden sm:block">/);
  });
  it('the main tabs slide when they do not fit, and a deep link opens the call', () => {
    const ed = fs.readFileSync(`${process.cwd()}/src/components/calls/CallEditor.tsx`, 'utf8');
    expect(ed).toContain('overflow-x-auto whitespace-nowrap');
    expect(ed).toContain("parseLinkQuery(window.location.search, callId)");
    expect(fs.readFileSync(`${process.cwd()}/src/components/calls/CallsWorkspace.tsx`, 'utf8')).toContain("get('call')");
  });
});
