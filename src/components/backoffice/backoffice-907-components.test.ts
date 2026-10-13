// Prompt 907 — the two small components behind the new back-office surfaces, rendered for real with react-dom/server (no DOM
// needed, like PasswordInput.test.ts): the People card of the Ficha do cliente, and the account label of a support ticket
// (the list's "Account" cell and the detail's header). Plus the wiring of the three pages that use them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PeopleCard } from '@/components/backoffice/PeopleCard';
import { TicketAccountCell, TicketAccountLabel, TicketAccountMatch } from '@/components/backoffice/TicketAccount';
import type { CustomerInvite, CustomerPerson } from '@/lib/backoffice-customer-people';
import type { TicketAccount } from '@/lib/support-ticket-account';

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();

const members: CustomerPerson[] = [
  { userId: 'u1', email: 'owner@zz-test-907.example', role: 'owner', joinedAt: '2026-09-01T09:00:00Z', joinedSource: 'account', emailConfirmed: true, lastSignInAt: '2026-10-12T09:00:00Z' },
  { userId: 'u2', email: 'member@zz-test-907.example', role: 'member', joinedAt: '2026-09-22T10:30:00Z', joinedSource: 'invitation', emailConfirmed: false, lastSignInAt: null },
];
const invites: CustomerInvite[] = [
  { id: 'i1', email: 'pending@zz-test-907.example', role: 'admin', sentAt: '2026-10-10T08:00:00Z', expiresAt: '2026-10-17T08:00:00Z', expired: false },
  { id: 'i2', email: 'lapsed@zz-test-907.example', role: 'member', sentAt: '2026-09-01T08:00:00Z', expiresAt: '2026-09-08T08:00:00Z', expired: true },
];

describe('PeopleCard — a org with 2 members and pending invitations', () => {
  const html = renderToStaticMarkup(createElement(PeopleCard, { members, invites }));
  const t = text(html);

  it('titles the card with the headcount and lists every member with role, joined date, confirmation and last login', () => {
    expect(t).toContain('People (2)');
    expect(t).toContain('owner@zz-test-907.example owner 2026-09-01');
    expect(t).toContain('member@zz-test-907.example member 2026-09-22');
    expect(t).toContain('2026-10-12'); // last login of the owner
    expect(t).toContain('never'); // the member never logged in
    expect(html).toMatch(/>Yes</);
    expect(html).toMatch(/>No</);
  });

  it('says where the joined date comes from, on hover', () => {
    expect(decode(html)).toContain('The day their invitation was accepted');
    expect(decode(html)).toContain('The day their account was created');
  });

  it('lists the pending invitations under the members, with sent / expires, and flags the lapsed one', () => {
    expect(t).toContain('Pending invitations (2)');
    expect(t).toContain('pending@zz-test-907.example admin 2026-10-10 2026-10-17');
    expect(t).toMatch(/lapsed@zz-test-907\.example member 2026-09-01 2026-09-08 EXPIRED/);
    expect(t.indexOf('People (2)')).toBeLessThan(t.indexOf('Pending invitations'));
  });

  it('is read-only: no inputs, no buttons, and the e-mails are plain text, not links', () => {
    expect(html).not.toMatch(/<(input|button|select|textarea|a)\b/);
  });
});

describe('PeopleCard — the edges', () => {
  it('no one attached: says so; no invitations section at all', () => {
    const t = text(renderToStaticMarkup(createElement(PeopleCard, { members: [], invites: [] })));
    expect(t).toContain('People (0)');
    expect(t).toContain('Nobody is attached to this account.');
    expect(t).not.toContain('Pending invitations');
  });

  it('a VC firm seat invitation has no role and no expiry: dashes, never "EXPIRED"', () => {
    const t = text(renderToStaticMarkup(createElement(PeopleCard, {
      members: [], invites: [{ id: 's', email: 'invited@capital.example', role: null, sentAt: '2026-10-09T09:00:00Z', expiresAt: null, expired: false }],
    })));
    expect(t).toContain('invited@capital.example — 2026-10-09 —');
    expect(t).not.toContain('EXPIRED');
  });
});

const linked: TicketAccount = { kind: 'org', id: 'o1', name: 'ABOUT FOOD', role: 'owner', href: '/backoffice/ficha-cliente/org/o1', matches: null };

describe('TicketAccount', () => {
  it('a linked startup: the name links to the Ficha, the role follows in brackets', () => {
    const html = renderToStaticMarkup(createElement(TicketAccountLabel, { account: linked }));
    expect(html).toContain('href="/backoffice/ficha-cliente/org/o1"');
    expect(text(html)).toBe('ABOUT FOOD (owner)');
  });

  it('a VC firm carries a small VC tag', () => {
    const firm: TicketAccount = { kind: 'investor_entity', id: 'f1', name: 'Capital', role: 'member', href: '/backoffice/ficha-cliente/investor_entity/f1', matches: null };
    expect(text(renderToStaticMarkup(createElement(TicketAccountLabel, { account: firm })))).toBe('Capital (member) VC');
  });

  it('a sender with no known role shows just the name', () => {
    expect(text(renderToStaticMarkup(createElement(TicketAccountLabel, { account: { ...linked, role: null } })))).toBe('ABOUT FOOD');
  });

  it('no account: says "No account"; with a match, says which account it is and that the ticket is not linked to it', () => {
    const none: TicketAccount = { kind: 'none', id: null, name: null, role: null, href: null, matches: null };
    expect(text(renderToStaticMarkup(createElement(TicketAccountCell, { account: none })))).toBe('No account');

    const matched: TicketAccount = { ...none, matches: { kind: 'org', id: 'o1', name: 'ABOUT FOOD', href: '/backoffice/ficha-cliente/org/o1' } };
    const cell = renderToStaticMarkup(createElement(TicketAccountCell, { account: matched }));
    expect(text(cell)).toBe('No account matches account ABOUT FOOD — not linked');
    expect(cell).toContain('href="/backoffice/ficha-cliente/org/o1"');
  });

  it('a match that is a user without any company is said plainly', () => {
    const none: TicketAccount = { kind: 'none', id: null, name: null, role: null, href: null, matches: { kind: 'user', id: null, name: null, href: null } };
    expect(text(renderToStaticMarkup(createElement(TicketAccountMatch, { account: none })))).toBe('matches a user with no company — not linked');
  });

  it('TicketAccountMatch renders nothing for a linked ticket', () => {
    expect(renderToStaticMarkup(createElement(TicketAccountMatch, { account: linked }))).toBe('');
  });
});

describe('the pages that use them', () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

  it('the Ficha shows the People card right under the header, before Overview', () => {
    const src = read('src/app/backoffice/ficha-cliente/[kind]/[id]/page.tsx');
    expect(src).toContain("import { PeopleCard } from '@/components/backoffice/PeopleCard'");
    const h1 = src.indexOf('<h1'); const people = src.indexOf('<PeopleCard'); const overview = src.indexOf('<Card title="Overview">');
    expect(h1).toBeGreaterThan(0);
    expect(people).toBeGreaterThan(h1);
    expect(overview).toBeGreaterThan(people);
  });

  it('the ticket list has an Account column right after From, and an account filter that sends ?account=', () => {
    const src = read('src/app/backoffice/support/page.tsx');
    expect(src).toMatch(/<th>From<\/th><th>Account<\/th>/);
    expect(src).toContain('<TicketAccountCell account={t.account} />');
    expect(src).toContain("params.set('account', account)");
    expect(src).toContain('All accounts');
  });

  it('the ticket header reads "subject · status · account (role)"', () => {
    const src = read('src/app/backoffice/support/[id]/page.tsx');
    expect(src).toContain('{ticket.subject}');
    expect(src).toContain('STATUS_LABEL[ticket.status]');
    expect(src).toContain('<TicketAccountLabel account={account} />');
    expect(src.indexOf('{ticket.subject}')).toBeLessThan(src.indexOf('STATUS_LABEL[ticket.status]'));
    expect(src.indexOf('STATUS_LABEL[ticket.status]')).toBeLessThan(src.indexOf('<TicketAccountLabel account={account} />'));
  });
});
