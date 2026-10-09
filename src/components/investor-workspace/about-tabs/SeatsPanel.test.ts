// Prompt 904 Part C — what the seats panel shows. Rendered with react-dom/server (no DOM library in this
// repo); clicking is covered by the route tests and checked live in the browser.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SeatsPanelView, type SeatsData } from './SeatsPanel';
import { RemovedFromFirmNotice } from '../RemovedFromFirmNotice';

const noop = () => {};
function render(data: SeatsData | null, over: Partial<Parameters<typeof SeatsPanelView>[0]> = {}) {
  return renderToStaticMarkup(createElement(SeatsPanelView, {
    data, busy: false, error: '', notice: '', inviteEmail: '', code: '',
    onInviteEmail: noop, onInvite: noop, onCancelInvite: noop, onRemove: noop, onCode: noop, onRedeem: noop, ...over,
  }));
}

const ADMIN: SeatsData = {
  hasPlan: true, isAdmin: true, planName: 'Private Detective', seats: 10, used: 2, reserved: 1, free: 7, ownMemberId: 'm1',
  members: [
    { id: 'm1', email: 'ana@firm.com', name: 'Ana', role: 'admin', since: '2026-10-09T09:00:00.000Z' },
    { id: 'm2', email: 'bob@firm.com', name: null, role: 'member', since: '2026-10-10T09:00:00.000Z' },
  ],
  invites: [{ id: 'i1', email: 'guest@external.com', createdAt: '2026-10-11T09:00:00.000Z' }],
};

describe('administrator view', () => {
  it('shows the numbers, who holds each seat since when, and reserved seats', () => {
    const html = render(ADMIN);
    expect(html).toContain('Seats · Private Detective');
    expect(html).toContain('2 of 10 in use · 1 reserved · 7 free');
    expect(html).toContain('since 2026-10-09');
    expect(html).toContain('since 2026-10-10');
    expect(html).toContain('guest@external.com');
    expect(html).toContain('seat reserved');
  });

  it('lets the administrator remove OTHERS but not their own seat', () => {
    const html = render(ADMIN);
    expect((html.match(/>Remove</g) ?? []).length).toBe(1);
    expect(html).toContain('>Cancel<');
  });

  it('shows the server explanation when a reservation is blocked', () => {
    const blocked = render(ADMIN, { inviteEmail: 'x@external.com', error: 'Your firm is on Private Detective, which includes 10 seats, and 10 are already in use or reserved.' });
    expect(blocked).toContain('role="alert"');
    expect(blocked).toContain('which includes 10 seats');
  });

  it('keeps the reserve button disabled until the field looks like an email', () => {
    const empty = render(ADMIN);
    const filled = render(ADMIN, { inviteEmail: 'x@external.com' });
    expect(/disabled=""[^>]*>Reserve seat/.test(empty)).toBe(true);
    expect(/disabled=""[^>]*>Reserve seat/.test(filled)).toBe(false);
  });
});

describe('other views', () => {
  it('an ordinary member of a planned firm sees one line and no controls', () => {
    const html = render({ hasPlan: true, isAdmin: false, planName: 'Private Detective', seats: 10 });
    expect(html).toContain('managed by your firm');
    expect(html).not.toContain('Reserve seat');
    expect(html).not.toContain('>Remove<');
  });

  it('a firm without a plan only offers the code box, collapsed', () => {
    const html = render({ hasPlan: false });
    expect(html).toContain('Have a code for a custom plan?');
    expect(html).toContain('<details');
    expect(html).not.toContain('Reserve seat');
  });

  it('renders nothing before the data arrives', () => {
    expect(render(null)).toBe('');
  });
});

describe('C5 — the removed member notice', () => {
  it('names the firm, says nothing was lost, and points at the plans', () => {
    const html = renderToStaticMarkup(createElement(RemovedFromFirmNotice, { firmName: 'Portugal Ventures', onSeePlans: noop }));
    expect(html).toContain('no longer part of Portugal Ventures');
    expect(html).toContain('Your own account is untouched');
    expect(html).toContain('data stays with Portugal Ventures');
    expect(html).toContain('See plans');
  });

  it('has no plans button when already on the plans screen', () => {
    expect(renderToStaticMarkup(createElement(RemovedFromFirmNotice, { firmName: 'X' }))).not.toContain('See plans');
  });
});
