// Prompt 923 (A.2, A.3) — the area selector in the menu shows only the areas the person has (and marks where they are), and /portal never leaves somebody on a dead end: it says what the area is and offers a button for each
// of the other areas they have. Rendered for every combination of papers (only a founder, only a firm, only data rooms, founder + firm, founder + firm + data rooms, nothing).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HatSwitcher } from '@/components/incubator/HatSwitcher';
import { NoDataRoomAccess, NO_DATA_ROOM_TEXT } from './NoDataRoomAccess';
import type { Area } from '@/lib/areas';

const selector = (current: 'founder' | 'incubator' | 'investor', areas: Area[]) => renderToStaticMarkup(createElement(HatSwitcher, { current, areas }));
const noRoom = (areas: Area[]) => renderToStaticMarkup(createElement(NoDataRoomAccess, { areas, senderEmail: null, showLogout: false }));

describe('the selector of areas in the menu', () => {
  it('a person with ONE area sees nothing to switch to', () => {
    expect(selector('founder', ['founder'])).toBe('');
    expect(selector('investor', ['investor'])).toBe('');
    expect(selector('investor', ['dataroom'])).toBe('');
    expect(selector('founder', [])).toBe('');
  });
  it('a founder who is also a firm member sees exactly those two: where they are is marked, the other leads to its workspace', () => {
    const html = selector('founder', ['founder', 'investor']);
    expect(html).toContain('data-testid="area-selector"');
    expect((html.match(/data-testid="area-current"/g) ?? []).length).toBe(1);
    expect(html).toContain('Founder workspace');
    expect(html).toMatch(/href="\/portal"[^>]*>[^<]*<span[^>]*>⇄<\/span> Investor workspace/);
    expect(html).not.toContain('Data rooms');
    expect(html).not.toContain('Ecosystem');
  });
  it('a founder, a firm member and data rooms sees the three — and from the firm\'s workspace the other two are links', () => {
    const html = selector('investor', ['founder', 'investor', 'dataroom']);
    expect((html.match(/data-testid="area-option"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/pipeline"');
    expect(html).toContain('href="/portal?tab=pipeline"');
    expect(html).toContain('Data rooms');
  });
  it('the old shells that still call the ecosystem area "incubator" are marked as the current one', () => {
    expect(selector('incubator', ['founder', 'ecosystem'])).toContain('Ecosystem workspace');
    expect((selector('incubator', ['founder', 'ecosystem']).match(/data-testid="area-current"/g) ?? []).length).toBe(1);
  });
});

describe('/portal without a data room is never a dead end', () => {
  it('a firm member (28/10/2026): says they have no data-room access yet, what the area is, and offers their investor workspace', () => {
    const html = noRoom(['investor']);
    expect(html.replace(/&#x27;/g, "'")).toContain(NO_DATA_ROOM_TEXT);
    expect(html).toContain('Data rooms are the folders startups share with you.');
    expect(html).toMatch(/href="\/portal"[^>]*data-testid="no-data-room-area"|data-testid="no-data-room-area"[^>]*href="\/portal"/);
    expect(html).toContain('Go to your investor workspace');
    expect(html).not.toContain('contact the founder');
  });
  it('a founder who is also a firm member is offered both workspaces', () => {
    const html = noRoom(['founder', 'investor']);
    expect(html).toContain('Go to your founder workspace');
    expect(html).toContain('Go to your investor workspace');
    expect((html.match(/data-testid="no-data-room-area"/g) ?? []).length).toBe(2);
  });
  it('a person with data rooms only is not shown their own area as "another" one; with nothing at all, the old generic sentence stays (it must never reveal who has access)', () => {
    expect(noRoom(['dataroom'])).toContain('data-testid="no-access-generic"');
    const none = noRoom([]);
    expect(none).toContain('No active access for this account. If you believe this is an error, contact the founder.');
    expect(none).not.toContain('no-data-room-area');
  });
  it('the way out is there when a session exists', () => {
    expect(renderToStaticMarkup(createElement(NoDataRoomAccess, { areas: ['investor'], senderEmail: null, showLogout: true }))).toMatch(/Log ?out/i);
  });
});
