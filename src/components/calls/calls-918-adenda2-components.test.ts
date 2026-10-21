// Prompt 918, Adenda 2 — what the screens draw when a picture is missing or broken (never a broken-image icon, never the alternative text spread over the page: the initials of the entity in a
// square, or the band in the platform's colour), and the read-only screen that is no longer a dead end. Static markup; the failed-to-load case itself is driven in a real browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { initialsOf } from '@/lib/calls/initials';

vi.mock('@/lib/supabase', () => ({ browserClient: () => ({ auth: { signOut: async () => ({}) } }), authEnabled: false }));

import { CoverBand, EntityLogo, InitialsTile, LogoTile } from './applicant/Pictures';
import { CallIntro, CallMiniHeader, type PublicCallInfo } from './applicant/CallHeader';
import { ReadOnlyNotice, readOnlyMessage } from './applicant/ReadOnlyNotice';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const info = (over: Partial<PublicCallInfo> = {}): PublicCallInfo => ({
  name: 'INNOV-ID', description: null, promoter: 'ablute_ — Internal', opensAt: '2026-11-01T09:00:00.000Z', closesAt: '2026-12-01T09:00:00.000Z', timezone: 'Europe/Lisbon', phase: 'open',
  message: null, eligibility: [], regulation: null, coverUrl: null, logoUrl: null, ...over,
});

describe('the initials that stand in for a logo', () => {
  it('two letters from the first two words; a name with no letter is a dot; accents and case are kept sensible', () => {
    expect(initialsOf('Portugal Ventures')).toBe('PV');
    expect(initialsOf('ablute_ — Internal')).toBe('AI');
    expect(initialsOf('INNOV-ID')).toBe('II');
    expect(initialsOf('Única')).toBe('Ú');
    expect(initialsOf('  --  ')).toBe('•');
    expect(initialsOf(null)).toBe('•');
    expect(initialsOf('3M Ventures')).toBe('V');                                              // a word has to START with a letter
  });
});

describe('a picture that is not there leaves nothing broken', () => {
  it('no logo: the initials in a square — on the entry page, the small header and the lists — and no <img> at all', () => {
    const intro = render(createElement(CallIntro, { call: info(), cta: 'Start application', onStart: () => {} }));
    expect(intro).not.toContain('<img');
    expect(intro).toMatch(/data-testid="intro-initials"[^>]*>AI</);
    const mini = render(createElement(CallMiniHeader, { call: info() }));
    expect(mini).toMatch(/data-testid="entity-initials"[^>]*>AI</);
    expect(mini).not.toContain('<img');
    expect(render(createElement(EntityLogo, { url: undefined, name: 'Portugal Ventures', size: 24 }))).toMatch(/>PV</);
  });

  it('no cover: the band in the platform\'s colour, with no picture in it', () => {
    const h = render(createElement(CoverBand, { url: null }));
    expect(h).toContain('data-has-cover="no"');
    expect(h).toContain('from-[#0E7490]');
    expect(h).not.toContain('<img');
  });

  it('a picture that is there has EMPTY alternative text: if it ever fails, no text is spread where it was (the name is written beside it)', () => {
    const intro = render(createElement(CallIntro, { call: info({ coverUrl: '/c?v=1', logoUrl: '/l?v=1' }), cta: null, onStart: () => {} }));
    const imgs = [...intro.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
    expect(imgs).toHaveLength(2);
    for (const img of imgs) expect(img).toContain('alt=""');
    expect(intro).not.toContain('alt="ablute_');
    expect(render(createElement(EntityLogo, { url: '/l', name: 'x' }))).toContain('alt=""');
    expect(render(createElement(LogoTile, { url: '/l', name: 'x' }))).toContain('alt=""');
  });

  it('the tile is decorative: hidden from screen readers (the entity\'s name is always written next to it)', () => {
    expect(render(createElement(InitialsTile, { name: 'Portugal Ventures', size: 32 }))).toContain('aria-hidden="true"');
  });
});

describe('the read-only screen is not a dead end', () => {
  it('says who the person is, what they are looking at and why they cannot apply', () => {
    expect(readOnlyMessage('nunomarujo@ablute.pt', 'Mob2is')).toBe('You are signed in as nunomarujo@ablute.pt and viewing “Mob2is” in Developer Viewer, which is read-only. Applications can only be started or changed by the startup’s own owner or admin.');
    expect(readOnlyMessage(null, null)).toContain('You are signed in and in Developer Viewer, which is read-only.');
    const h = render(createElement(ReadOnlyNotice, { email: 'nunomarujo@ablute.pt', startupName: 'Mob2is', onLeft: () => {} }));
    expect(h).toContain('data-testid="viewer-note"');
    expect(h).toContain('nunomarujo@ablute.pt'); expect(h).toContain('Mob2is');
  });

  it('offers a way out: leave the viewer and continue as yourself, sign out and use another account, and report a problem', () => {
    const h = render(createElement(ReadOnlyNotice, { email: 'a@b.pt', startupName: 'X', onLeft: () => {} }));
    expect(h).toMatch(/data-testid="viewer-exit"[^>]*>Leave Developer Viewer and continue as myself</);
    expect(h).toMatch(/data-testid="viewer-signout"[^>]*>Sign out and use another account</);
    expect(h).toMatch(/data-testid="viewer-report"[^>]*>Report a problem</);
    expect((h.match(/<button/g) ?? []).length).toBe(3);
    expect(h).toContain('min-h-[44px]');                                                      // touch size on a phone
  });

  it('never prints an email address of the platform for the person to write to (Report a problem is the way)', () => {
    const h = render(createElement(ReadOnlyNotice, { email: 'a@b.pt', startupName: 'X', onLeft: () => {} }));
    expect(h.match(/[\w.+-]+@[\w-]+\.[\w.]+/g)).toEqual(['a@b.pt']);                         // only the person's own address
  });
});
