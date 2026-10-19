// Prompt 918, Adenda 1 — what the screens draw: the entry page (cover or band, logo with the name under it, title, dates, description, regulation, one button that stays in view), the small
// header on the form pages, the General step's cover/logo fields and formatted description, "Reopen and extend", and the delete message. Static markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Call, CallPhase, FormField } from '@/lib/calls/types';
import { newField } from '@/lib/calls/form-builder';
import { availableActions } from '@/lib/calls/lifecycle';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }), authEnabled: false }));

import { CallHeader, CallIntro, CallMiniHeader, EntityLogo, ctaLabel, type PublicCallInfo } from './applicant/CallHeader';
import { CallMediaFields } from './CallMediaFields';
import { GeneralTab } from './GeneralTab';
import { PreviewTab } from './PreviewTab';
import { RichText } from '@/components/RichText';
import { RichTextEditor } from '@/components/RichTextEditor';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const info = (over: Partial<PublicCallInfo> = {}): PublicCallInfo => ({
  name: 'INNOV-ID 2nd call', description: '<p>Open to <strong>startups</strong>.</p><ul><li>Health</li></ul>', promoter: 'Portugal Ventures', opensAt: '2026-11-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z',
  timezone: 'Europe/Lisbon', phase: 'open', message: null, eligibility: [], regulation: { fileName: 'regulation.pdf', url: '/api/calls/public/t/regulation' }, coverUrl: null, logoUrl: null, ...over,
});

describe('the entry page', () => {
  it('with a cover and a logo: the cover on top, the logo with the entity\'s name under it (smaller), the title, the dates, the description, the regulation and the button', () => {
    const h = render(createElement(CallIntro, { call: info({ coverUrl: '/api/calls/public/t/cover?v=1', logoUrl: '/api/calls/public/t/logo?v=1' }), cta: 'Start application', onStart: () => {} }));
    expect(h).toContain('data-has-cover="yes"');
    expect(h).toContain('src="/api/calls/public/t/cover?v=1"');
    expect(h).toMatch(/data-testid="intro-logo"[\s\S]*src="\/api\/calls\/public\/t\/logo\?v=1" alt="Portugal Ventures"/);
    expect(h).toMatch(/data-testid="call-promoter">Portugal Ventures</);
    expect(h.indexOf('intro-logo')).toBeLessThan(h.indexOf('call-promoter'));            // the logo first, the name under it
    expect(h.indexOf('call-promoter')).toBeLessThan(h.indexOf('data-testid="call-name"'));
    expect(h).toContain('INNOV-ID 2nd call');
    expect(h).toContain('Opens'); expect(h).toContain('Deadline');
    expect(h).toContain('Read the regulation (PDF)');
    expect(h).toContain('>Start application</button>');
    expect((h.match(/data-testid="call-promoter"/g) ?? []).length).toBe(1);               // the name once, not twice
  });

  it('without a cover: a band in the platform\'s colour; without a logo: no logo, the name stands', () => {
    const h = render(createElement(CallIntro, { call: info(), cta: 'Start application', onStart: () => {} }));
    expect(h).toContain('data-has-cover="no"');
    expect(h).toContain('from-[#0E7490]');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('data-testid="intro-logo"');
    expect(h).toContain('Portugal Ventures');
  });

  it('on a phone the cover is lower, and the button sits in a bar that stays at the bottom of the screen and is at least 48 px high', () => {
    const h = render(createElement(CallIntro, { call: info(), cta: 'Start application', onStart: () => {} }));
    expect(h).toMatch(/data-testid="intro-cover"/);
    expect(h).toMatch(/class="h-36 [^"]*sm:h-52 md:h-60"/);
    expect(h).toMatch(/class="sticky bottom-0[^"]*"[^>]*data-testid="intro-cta-bar"/);
    expect(h).toMatch(/class="min-h-\[48px\][^"]*"[^>]*>Start application|data-testid="start-application"[^>]*class="min-h-\[48px\]/);
  });

  it('the description is drawn with its formatting (a list is a list); a plain old one keeps its paragraphs', () => {
    expect(render(createElement(CallHeader, { call: info() }))).toContain('<ul><li>Health</li></ul>');
    expect(render(createElement(CallHeader, { call: info() }))).toContain('<strong>startups</strong>');
    expect(render(createElement(CallHeader, { call: info({ description: 'First.\n\nSecond.' }) }))).toContain('<p>First.</p><p>Second.</p>');
  });

  it('a description with a script in it is drawn without it (it is sanitised when shown, as well as when saved)', () => {
    const h = render(createElement(CallHeader, { call: info({ description: '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">go</a>' }) }));
    expect(h).toContain('<p>Hi</p>');
    expect(h).not.toMatch(/script|onclick|javascript/i);
  });

  it('the button says what the person already has: start, continue, view — and nothing for a closed call with no application (a sign-in link instead)', () => {
    expect(ctaLabel('open', null)).toBe('Start application');
    expect(ctaLabel('open', { status: 'draft' })).toBe('Continue your application');
    expect(ctaLabel('open', { status: 'submitted' })).toBe('View your application');
    expect(ctaLabel('closed', { status: 'draft' })).toBe('Continue your application');
    expect(ctaLabel('closed', null)).toBeNull();
    expect(ctaLabel('scheduled', null)).toBeNull();
    const closed = render(createElement(CallIntro, { call: info({ phase: 'closed', message: 'Applications closed on 1 Dec' }), cta: null, onStart: () => {} }));
    expect(closed).not.toContain('data-testid="start-application"');
    expect(closed).toContain('data-testid="intro-signin"');
    expect(closed).toContain('Applications closed on 1 Dec');
  });

  it('the form pages carry the same logo and title, small', () => {
    const h = render(createElement(CallMiniHeader, { call: info({ logoUrl: 'https://cdn.example/l.png' }), onAbout: () => {} }));
    expect(h).toContain('src="https://cdn.example/l.png"');
    expect(h).toContain('width="36"');
    expect(h).toContain('INNOV-ID 2nd call');
    expect(h).toContain('Portugal Ventures');
    expect(h).toContain('About this call');
    expect(render(createElement(EntityLogo, { url: null }))).toBe('');
  });
});

describe('General: the cover, the logo and the formatted description', () => {
  const call = (over: Partial<Call> = {}): Call => ({
    id: 'c1', name: 'INNOV-ID', description: null, opensAt: '2026-11-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', timezone: 'Europe/Lisbon', visibility: 'listed', limitUnit: 'project',
    allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status: 'draft', linkToken: null, configVersion: 1, validatedAt: null, contactEmail: null, promoterKind: 'catalog_entity', promoterId: 'p', ...over,
  } as Call);
  const branding = { coverUrl: '/api/calls/c1/media?kind=cover&v=1', logoUrl: 'https://cdn.example/l.png', logoSource: 'profile' as const, profileLogoUrl: 'https://cdn.example/l.png' };

  it('the cover is shown 16:9 as it will be cropped; the logo says where it comes from; both can be replaced', () => {
    const h = render(createElement(CallMediaFields, { callId: 'c1', branding, disabled: false, onState: () => {} }));
    expect(h).toContain('aspect-video');
    expect(h).toContain('data-testid="cover-preview"');
    expect(h).toContain('Shown wide, 16:9');
    expect(h).toContain('From your organisation’s profile.');
    expect(h).toContain('Replace cover'); expect(h).toContain('data-testid="cover-remove"');
    expect(h).toContain('Upload a logo');
    expect(h).not.toContain('logo-remove');                                       // a profile logo is not removed from here
    expect(h).toContain('accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"');
    expect((h.match(/accept="[^"]*"/g) ?? []).join(' ')).not.toMatch(/svg|gif/i);                // the pickers never even offer SVG or GIF
  });

  it('nothing yet: the band and "no logo" are said; an uploaded logo can be replaced or removed', () => {
    const empty = render(createElement(CallMediaFields, { callId: 'c1', branding: { coverUrl: null, logoUrl: null, logoSource: null, profileLogoUrl: null }, disabled: false, onState: () => {} }));
    expect(empty).toContain('No cover: the page shows a band');
    expect(empty).toContain('No logo yet');
    expect(empty).toContain('Upload cover');
    expect(empty).not.toContain('cover-remove');
    const own = render(createElement(CallMediaFields, { callId: 'c1', branding: { ...branding, logoUrl: '/x', logoSource: 'call' }, disabled: false, onState: () => {} }));
    expect(own).toContain('Uploaded for this call.'); expect(own).toContain('Replace logo'); expect(own).toContain('data-testid="logo-remove"');
  });

  it('when the person may not change it, every control is off', () => {
    const h = render(createElement(CallMediaFields, { callId: 'c1', branding, disabled: true, onState: () => {} }));
    for (const id of ['cover-upload', 'cover-remove', 'logo-upload']) {
      const at = h.indexOf(`data-testid="${id}"`);
      expect(h.slice(h.lastIndexOf('<', at), h.indexOf('>', at))).toContain('disabled=""');
    }
  });

  it('in a validated call the rest of General is read-only but the description, cover and logo are not', () => {
    const h = render(createElement(GeneralTab, { call: call({ status: 'validated' } as Partial<Call>), promoterName: 'ablute_', disabled: true, presentationDisabled: false, branding, onState: () => {}, onChange: () => {} }));
    expect(h).toMatch(/id="call-name"[^>]*disabled=""/);
    expect(h).toMatch(/data-testid="cover-upload"(?![^>]*disabled)/);
    expect(h).toMatch(/contenteditable="true"/i);
    expect(h).toContain('data-testid="rich-editor"');
    const locked = render(createElement(GeneralTab, { call: call(), promoterName: 'ablute_', disabled: true, presentationDisabled: true, branding, onState: () => {}, onChange: () => {} }));
    expect(locked).toMatch(/contenteditable="false"/i);
  });

  it('the editor has the toolbar the Adenda asks for: bold, italic, two heading sizes, bulleted and numbered lists, links, and a palette of at most 8 colours', () => {
    const h = render(createElement(RichTextEditor, { id: 'd', labelledBy: 'l', value: '', onChange: () => {} }));
    for (const id of ['bold', 'italic', 'h2', 'h3', 'ul', 'ol', 'link', 'colour']) expect(h, id).toContain(`data-testid="rt-${id}"`);
    expect(h).toContain('role="textbox"');
    expect(h).toContain('aria-multiline="true"');
    expect(h).not.toContain('<input');                                            // no free colour picker
  });

  it('RichText draws nothing for an empty description', () => {
    expect(render(createElement(RichText, { value: null }))).toBe('');
    expect(render(createElement(RichText, { value: '<p>x</p>' }))).toContain('class="rich-text');
  });
});

describe('Reopen and extend, in Review & publish', () => {
  const phases: CallPhase[] = [{ id: 'ph-1', callId: 'c1', position: 0, name: 'Applications', startsOn: '2026-11-01', endsOn: '2026-12-01' } as CallPhase];
  const fields: FormField[] = [{ ...newField('short_text', 1, 0), id: 'q-1', label: 'Company name' }];
  const closed = { id: 'c1', name: 'INNOV-ID', status: 'closed', opensAt: '2026-10-01T00:00:00.000Z', closesAt: '2026-10-18T00:00:00.000Z', timezone: 'Europe/Lisbon', linkToken: 'tok', contentLanguage: 'en', currency: 'EUR', visibility: 'listed', limitUnit: 'project', allowMultiple: false } as Call;
  const NOW = new Date('2026-10-19T12:00:00Z');
  const view = (closedEarly: boolean) => render(createElement(PreviewTab, {
    call: closed, effectiveStatus: 'closed', phases, fields, issues: [], summary: { phases: 1, pages: 1, fields: 1, questions: 1, documents: 0, required: 0, mapped: 0, conditional: 0 },
    actions: availableActions(closed, [], NOW, { submitted: 3, inProgress: 1, withdrawn: 0, total: 4 }, { closedEarly }), canManage: true, busy: false, error: '', origin: 'https://x.test', onJump: () => {}, onAction: () => {},
  }));

  it('a call closed at its deadline: "Reopen and extend" with a new deadline — the button waits for a date in the future', () => {
    const h = view(false);
    expect(h).toContain('data-testid="reopen"');
    expect(h).toContain('This call closed at its deadline.');
    expect(h).toContain('New deadline');
    expect(h).toMatch(/data-testid="reopen-button"[^>]*disabled=""|disabled=""[^>]*data-testid="reopen-button"/);
    expect(h).not.toContain('data-testid="reopen-early-ok"');
    expect(h).not.toContain('data-testid="extend"');                              // an open call is extended; a closed one is reopened
  });

  it('a call closed EARLY on purpose also asks the person to confirm it', () => {
    const h = view(true);
    expect(h).toContain('This call was closed early, on purpose.');
    expect(h).toContain('data-testid="reopen-early-ok"');
    expect(h).toContain('I closed this call early on purpose and I want to reopen it.');
  });

  it('the sentence the person confirms is the one the Adenda wrote (checked in the source, since it appears once a date is chosen)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(`${process.cwd()}/src/components/calls/PreviewTab.tsx`, 'utf8');
    expect(src).toContain('Applicants who had not submitted will be able to submit until «');
    expect(src).toContain('Submitted applications are not affected.');
  });
});
