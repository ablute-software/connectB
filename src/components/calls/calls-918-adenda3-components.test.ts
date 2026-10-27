// Prompt 918, Adenda 3 — what the screens draw: the "Reopen and extend" box (the true reason, why the button is off, the error and the notice INSIDE the box, a confirmation that is part of the page),
// the closing date of a call closed before its deadline, "Manage" in the list, and the team message on the entry page. Static markup; the clicks are driven in a real browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import { newField } from '@/lib/calls/form-builder';
import { availableActions } from '@/lib/calls/lifecycle';
import { ON_CALL_TEAM_MESSAGE } from '@/lib/calls/applicant/team-rule';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }), authEnabled: false }));

import { CallHeader, CallIntro, type PublicCallInfo } from './applicant/CallHeader';
import { PreviewTab } from './PreviewTab';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const read = (p: string) => import('node:fs').then((fs) => fs.readFileSync(`${process.cwd()}/${p}`, 'utf8'));

const phases: CallPhase[] = [{ id: 'ph-1', callId: 'c1', position: 0, name: 'Applications', startsOn: '2026-11-01', endsOn: '2026-12-01' } as CallPhase];
const fields: FormField[] = [{ ...newField('short_text', 1, 0), id: 'q-1', label: 'Company name' }];
const closed = { id: 'c1', name: 'INNOV-ID', status: 'closed', opensAt: '2026-10-01T00:00:00.000Z', closesAt: '2026-12-31T14:34:00.000Z', closedAt: '2026-10-22T10:00:00.000Z', timezone: 'Europe/Lisbon', linkToken: 'tok', contentLanguage: 'en', currency: 'EUR', visibility: 'listed', limitUnit: 'project', allowMultiple: false } as Call;
const NOW = new Date('2026-10-23T12:00:00Z');
const view = (o: { reason?: 'deadline' | 'early' | 'restored' | null; error?: string; notice?: string; closedEarly?: boolean; call?: Call } = {}) => render(createElement(PreviewTab, {
  call: o.call ?? closed, effectiveStatus: 'closed', phases, fields, issues: [], summary: { phases: 1, pages: 1, fields: 1, questions: 1, documents: 0, required: 0, mapped: 0, conditional: 0 },
  actions: availableActions(o.call ?? closed, [], NOW, { submitted: 3, inProgress: 1, withdrawn: 0, total: 4 }, { closedEarly: o.closedEarly ?? false }),
  canManage: true, busy: false, error: o.error ?? '', notice: o.notice ?? '', closedReason: o.reason ?? null, origin: 'https://x.test', onJump: () => {}, onAction: () => {},
}));

describe('the reopen box says why the call is closed — truthfully, per reason', () => {
  it('closed at its deadline / closed early / deleted and restored: three different sentences', () => {
    expect(view({ reason: 'deadline' })).toContain('This call closed at its deadline.');
    expect(view({ reason: 'early', closedEarly: true })).toContain('This call was closed early, on purpose.');
    const restored = view({ reason: 'restored' });
    expect(restored).toContain('deleted and restored');
    expect(restored).not.toContain('closed at its deadline');
    expect(restored).not.toContain('data-testid="reopen-early-ok"');                    // a restore is undone without a confirmation about "early"
  });
  it('a restored call is reopenable although its deadline has not passed yet', () => {
    const h = view({ reason: 'restored', call: { ...closed, closesAt: '2027-02-01T00:00:00.000Z' } as Call });
    expect(h).toContain('data-testid="reopen"');
    expect(h).toContain('data-testid="reopen-button"');
  });
  it('the button is off with the reason written next to it — not silently', () => {
    const h = view({ reason: 'deadline' });
    expect(h).toMatch(/data-testid="reopen-button"[^>]*disabled=""|disabled=""[^>]*data-testid="reopen-button"/);
    expect(h).toMatch(/data-testid="reopen-why"[^>]*>Choose the new deadline to reopen the call\./);
  });
  it('an error shows INSIDE the box, next to the button; the notice of success shows at the top of the actions', () => {
    const h = view({ reason: 'deadline', error: 'The new deadline must be in the future.', notice: 'The call is open again until 31 Dec 2026.' });
    expect(h).toMatch(/data-testid="reopen"[\s\S]*role="alert"[^>]*data-testid="reopen-error">The new deadline must be in the future\./);
    expect(h).toContain('data-testid="action-notice"');
  });
  it('the summary row says "Closed on 22 Oct 2026 (early)" for a call closed before its deadline, never the future date', () => {
    const h = view({ reason: 'early', closedEarly: true });
    expect(h).toContain('Closed on');
    expect(h).toContain('22 Oct 2026 (early)');
  });
  it('the confirmation is part of the page (no browser pop-up that can be suppressed), and the button asks for it', async () => {
    const src = await read('src/components/calls/PreviewTab.tsx');
    expect(src).toContain('data-testid="reopen-confirm"');
    expect(src).toContain('data-testid="reopen-confirm-yes"');
    const box = src.slice(src.indexOf('data-testid="reopen"'), src.indexOf('data-testid="reopen-error"'));
    expect(box.length).toBeGreaterThan(500);
    expect(box).not.toMatch(/window\.confirm/);                                       // (closing early still asks with the browser's own dialog, as before)
  });
});

describe('the editor does not stay locked by an old save failure', () => {
  it('a stale "failed" flag is cleared when nothing is unsaved, and lifecycle actions other than the ones about the form do not wait for it', async () => {
    const src = await read('src/components/calls/CallEditor.tsx');
    expect(src).toMatch(/if \(failed\.current && !unsaved\) failed\.current = false;/);
    expect(src).toMatch(/failed\.current && aboutTheForm/);
    expect(src).toContain("const aboutTheForm = action === 'confirm' || action === 'publish' || action === 'edit';");
    expect(src).toContain('Fix the save error first, then try again.');
  });
});

describe('the list: "Manage", and the closing line', () => {
  it('the card button says Manage (or View when the person cannot manage), and the closing row comes from the one place', async () => {
    const src = await read('src/components/calls/CallsList.tsx');
    expect(src).toContain("{canManage ? 'Manage' : 'View'}");
    expect(src).not.toMatch(/>\s*Open\s*</);
    expect(src).toContain('closingLine(');
    expect(src).toContain('data-testid="card-closing"');
  });
});

describe('the entry page for a call closed before its deadline, and for a member of the team', () => {
  const info = (over: Partial<PublicCallInfo> = {}): PublicCallInfo => ({
    name: 'INNOV-ID', description: null, promoter: 'Portugal Ventures', opensAt: '2026-10-01T09:00:00.000Z', closesAt: '2026-12-31T14:34:00.000Z', timezone: 'Europe/Lisbon', phase: 'closed',
    message: 'Applications closed on 22 Oct 2026', eligibility: [], regulation: null, coverUrl: null, logoUrl: null, ...over,
  });
  it('shows "Closed" with the day it closed, and no deadline in the future', () => {
    const h = render(createElement(CallHeader, { call: info({ closedAt: '2026-10-22T10:00:00.000Z', closedDay: '22 Oct 2026' }) }));
    expect(h).toMatch(/data-testid="call-closed-on">22 Oct 2026</);
    expect(h).not.toContain('data-testid="call-deadline"');
  });
  it('a call that closed at its deadline keeps its "Deadline" row', () => {
    const h = render(createElement(CallHeader, { call: info() }));
    expect(h).toContain('data-testid="call-deadline"');
    expect(h).not.toContain('data-testid="call-closed-on"');
  });
  it('the team member sees the sentence and neither the start button nor the sign-in invitation', () => {
    const h = render(createElement(CallIntro, { call: info({ phase: 'open', message: null }), cta: null, onStart: () => {}, teamNotice: true }));
    expect(h).toContain('data-testid="team-notice"');
    expect(h).toContain("You are on this call&#x27;s team, so you cannot apply to it.");
    expect(ON_CALL_TEAM_MESSAGE).toBe("You are on this call's team, so you cannot apply to it.");
    expect(h).not.toContain('data-testid="start-application"');
    expect(h).not.toContain('data-testid="intro-signin"');
  });
});

describe('"Close early" asks in the page too (27/10/2026)', () => {
  it('no browser dialog: a box with "Yes, close the call" and "Cancel", asked after the click', async () => {
    const src = await read('src/components/calls/PreviewTab.tsx');
    expect(src).not.toMatch(/window\.confirm/);
    expect(src).toContain('data-testid="close-confirm"');
    expect(src).toContain('data-testid="close-confirm-yes"');
    expect(src).toContain('data-testid="close-confirm-no"');
    expect(src).toContain('Close the call now? Nobody will be able to submit a new application. What has already come in is kept.');
  });
});
