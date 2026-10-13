// Prompt 900 — the screen behind Startups › "Closed & deleted", rendered for real with react-dom/server (no DOM needed, like the 907
// components): the account cards, the people with their other hats, the two actions on, and — when one is off — the button off AND
// its reason written next to it. Plus the panel copy of each action, the written confirmation, the Delete wording that stopped
// promising a lock-out it no longer gives, and the audit-log sentences of the two new events.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClosedAccountsView } from '@/components/backoffice/ClosedDeletedTab';
import { panelCanConfirm } from '@/components/backoffice/AccountActionPanel';
import { panelSpec } from '@/lib/closed-accounts-panels';
import { moderationCascadeLines } from '@/lib/moderation-cascade-copy';
import { describeAuditEvent } from '@/lib/audit-log-format';
import type { ClosedAccount, ClosedAccountMember } from '@/lib/closed-accounts';

const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
const noop = () => {};

function member(over: Partial<ClosedAccountMember> = {}): ClosedAccountMember {
  return {
    userId: 'u1', email: 'alex@zz-test.example', role: 'owner', emailConfirmed: true,
    hats: { ecosystem: [], investor: [{ name: 'zz-test-invest-green', role: 'member', live: true }] },
    blocked: false, gdpr: null, signIn: 'Signs in through Investor — zz-test-invest-green', release: { ok: true }, ...over,
  };
}
function account(over: Partial<ClosedAccount> = {}): ClosedAccount {
  return {
    orgId: 'o1', name: 'zz-test-caramel', isTest: true, isInternal: true, createdAt: '2026-07-31T09:00:00Z',
    moderationStatus: 'deleted', closedAt: null, closedReason: null, purgeAfter: null,
    ways: ['moderation_deleted'], deleted: { at: '2026-09-29T10:00:00Z', by: 'admin@zz-test.example', reason: 'ciau' }, closed: null, when: '2026-09-29T10:00:00Z', gdprErasure: null,
    members: [member()], reopen: { ok: true }, ownerReopenable: false, daysToPurge: null,
    trail: [{ at: '2026-09-29T10:00:00Z', action: 'delete', by: 'admin@zz-test.example', text: 'Deleted by moderation — “ciau”' }],
    ...over,
  };
}
const view = (accounts: ClosedAccount[]) => renderToStaticMarkup(createElement(ClosedAccountsView, { accounts, onRelease: noop, onReopen: noop, onOwnerReopen: noop }));
const buttonTag = (html: string, label: string) => (html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`)) ?? [''])[0];
// the class list carries Tailwind's disabled: variants, so only the ATTRIBUTE (React renders it as disabled="") says the button is off
const isOff = (tag: string) => / disabled=""/.test(tag);

describe('ClosedAccountsView — the real case', () => {
  const html = view([account()]);
  const t = text(html);

  it('titles the tab with the count and says what the account is, how it ended, when, by whom and why', () => {
    expect(t).toContain('Closed & deleted (1)');
    expect(t).toContain('zz-test-caramel');
    expect(t).toMatch(/test.*internal/);
    expect(t).toContain('Deleted by moderation');
    expect(t).toContain('Deleted 2026-09-29 by admin@zz-test.example — “ciau”');
    expect(t).toContain('no purge date');
  });

  it('lists the person with role, confirmation, what else they hold and what the door does to them', () => {
    expect(t).toContain('alex@zz-test.example owner confirmed');
    expect(t).toContain('Investor · zz-test-invest-green (member)');
    expect(t).toContain('Signs in through Investor — zz-test-invest-green');
    expect(html).toContain('text-emerald-700'); // the sign-in line is green when a live hat lets them in
  });

  it('has both actions on — no disabled attribute, no "off" explanation', () => {
    expect(isOff(buttonTag(html, 'Release email alex@zz-test.example'))).toBe(false);
    expect(isOff(buttonTag(html, 'Reopen account zz-test-caramel'))).toBe(false);
    expect(t).not.toContain('off:');
  });

  it('keeps the history one click away', () => {
    expect(html).toContain('<details');
    expect(t).toContain('History (1)');
    expect(t).toContain('Deleted by moderation — “ciau”');
  });
});

describe('ClosedAccountsView — when an action is off, the reason is written next to the button', () => {
  it('a member in a GDPR erasure: both buttons off, the account flagged, the reason visible (not only a tooltip)', () => {
    const reason = 'A member of this account is in a GDPR erasure (pending) — nothing is reopened or released from it.';
    const html = view([account({
      gdprErasure: 'pending', reopen: { ok: false, reason },
      members: [member({ gdpr: 'pending', release: { ok: false, reason } })],
    })]);
    const t = text(html);
    expect(t).toContain('GDPR erasure (pending)');
    expect(isOff(buttonTag(html, 'Release email alex@zz-test.example'))).toBe(true);
    expect(isOff(buttonTag(html, 'Reopen account zz-test-caramel'))).toBe(true);
    expect(t).toContain(`Release email off: ${reason}`);
    expect(t).toContain(`Reopen account off: ${reason}`);
  });

  it('a blocked e-mail: only that person’s Release is off', () => {
    const reason = 'The e-mail is on the blocked list — that was decided for security and has its own screen.';
    const html = view([account({
      reopen: { ok: false, reason: 'A member’s e-mail is on the blocked list — that was decided for security and has its own screen.' },
      members: [
        member({ userId: 'u1', email: 'blocked@zz-test.example', blocked: true, signIn: 'E-mail on the blocked list — cannot sign in', release: { ok: false, reason } }),
        member({ userId: 'u2', email: 'fine@zz-test.example', role: 'member' }),
      ],
    })]);
    expect(isOff(buttonTag(html, 'Release email blocked@zz-test.example'))).toBe(true);
    expect(isOff(buttonTag(html, 'Release email fine@zz-test.example'))).toBe(false);
    expect(html).toContain('text-[#B00000]'); // the sign-in line of the blocked person is red
  });

  it('a hat that is not live is shown as such, and does not count as a way in', () => {
    const html = view([account({
      members: [member({
        hats: { ecosystem: [{ name: 'zz-test-hub', role: 'owner', status: 'invited', live: false }], investor: [] },
        signIn: 'Locked out by this account — holds nothing else live',
      })],
    })]);
    const t = text(html);
    expect(t).toContain('Ecosystem · zz-test-hub (owner, invited) — not live');
    expect(t).toContain('Locked out by this account');
  });
});

describe('ClosedAccountsView — closures that are not moderation deletes', () => {
  it('deleted and then closed: each way of ending keeps its own date, person and words', () => {
    const t = text(view([account({
      closedAt: '2026-10-12T10:00:00Z', closedReason: 'last_member_deleted', ways: ['moderation_deleted', 'last_member'], members: [],
      closed: { at: '2026-10-12T10:00:00Z', by: 'admin@zz-test.example', reason: 'owner invite needs the e-mail' }, when: '2026-10-12T10:00:00Z',
      reopen: { ok: false, reason: 'It is also closed (since 2026-10-12): reopening the moderation status alone would not bring it back.' },
    })]));
    expect(t).toContain('Deleted by moderation');
    expect(t).toContain('Closed when its last member was released');
    expect(t).toContain('Deleted 2026-09-29 by admin@zz-test.example — “ciau” · Closed 2026-10-12 by admin@zz-test.example — “owner invite needs the e-mail”');
  });

  it('closed by its owner, window open: says how long the owner has, and offers the existing reopen', () => {
    const html = view([account({
      moderationStatus: 'active', closedAt: '2026-10-01T10:00:00Z', closedReason: 'owner', purgeAfter: '2026-10-31T10:00:00Z', daysToPurge: 18, ownerReopenable: true,
      ways: ['owner_closed'], deleted: null, closed: { at: '2026-10-01T10:00:00Z', by: 'owner@zz-test.example', reason: null }, reopen: { ok: false, reason: 'Closed by its owner, not deleted by moderation — use the owner reopen above.' },
      members: [member({ release: { ok: false, reason: 'Closed by its owner — the owner can still reopen it until 2026-10-31. Releasing a member now would leave nothing to reopen.' } })],
    })]);
    const t = text(html);
    expect(t).toContain('Closed by its owner');
    expect(t).toContain('they can still get it back for 18 more days');
    expect(t).toContain('18d to purge (2026-10-31)');
    expect(html).toMatch(/<button[^>]*>Reopen account…<\/button>/);
    expect(t).toContain('Release email off: Closed by its owner');
  });

  it('closed by its owner, window ended: says it is not reopenable from the app', () => {
    const t = text(view([account({
      moderationStatus: 'active', closedAt: '2026-08-01T10:00:00Z', closedReason: 'owner', purgeAfter: '2026-08-31T10:00:00Z', daysToPurge: 0, ownerReopenable: false, ways: ['owner_closed'],
    })]));
    expect(t).toContain('the retention window ended 2026-08-31: not reopenable from the app');
    expect(t).toContain('retention ended 2026-08-31');
  });

  it('an account nobody is attached to has its own Reopen, and says so', () => {
    const html = view([account({ members: [] })]);
    expect(text(html)).toContain('No member is attached to this account any more.');
    expect(html).toMatch(/<button[^>]*>Reopen account<\/button>/);
  });

  it('says so when there is nothing to show', () => {
    expect(text(view([]))).toContain('No closed or deleted accounts.');
  });
});

describe('the panel of each action', () => {
  it('Release email: says the account stays dead, the person and the blocked list are not touched, and asks for the e-mail typed', () => {
    const a = account({ members: [member({}), member({ userId: 'u2', email: 'second@zz-test.example', role: 'member' })] });
    const spec = panelSpec({ kind: 'release', account: a, member: a.members[0] });
    expect(spec.title).toBe('Release email');
    expect(spec.confirmPhrase).toBe('alex@zz-test.example');
    expect(spec.lines.join(' ')).toContain('The account itself stays deleted.');
    expect(spec.lines.join(' ')).toContain('the sign-in (auth user) and the blocked list are not touched');
    expect(spec.lines.join(' ')).toContain('Investor — zz-test-invest-green');
    expect(spec.lines.join(' ')).not.toContain('last member'); // there is a second member
    expect(spec.url).toBe('/api/backoffice/closed-accounts/release-email');
    expect(spec.body('asked by Nuno')).toEqual({ orgId: 'o1', userId: 'u1', reason: 'asked by Nuno' });
  });

  it('Release email of the LAST member of an account that is not closed yet: says out loud what the existing rule does', () => {
    const a = account();
    const spec = panelSpec({ kind: 'release', account: a, member: a.members[0] });
    const lines = spec.lines.join(' ');
    expect(lines).toContain('This is the last member');
    expect(lines).toContain('closed_at is set');
    expect(lines).toContain('data-room grants are revoked');
    expect(spec.success({ closedByThisRelease: true })).toContain('also closed');
    expect(spec.success({ closedByThisRelease: false })).not.toContain('also closed');
  });

  it('...but not when the account is already closed (nothing new would be closed)', () => {
    const a = account({ closedAt: '2026-10-01T00:00:00Z', closedReason: 'platform', ways: ['moderation_deleted', 'platform_closed'] });
    expect(panelSpec({ kind: 'release', account: a, member: a.members[0] }).lines.join(' ')).not.toContain('last member');
  });

  it('Reopen account: restores to active, clears the clocks, records who and why — typed confirmation is the account name', () => {
    const a = account();
    const spec = panelSpec({ kind: 'reopen', account: a });
    expect(spec.title).toBe('Reopen account');
    expect(spec.tone).toBe('restore');
    expect(spec.confirmPhrase).toBe('zz-test-caramel');
    expect(spec.lead).toContain('deleted by moderation on 2026-09-29');
    expect(spec.lines.join(' ')).toContain('back to active');
    expect(spec.lines.join(' ')).toContain('quarantine and suspension dates');
    expect(spec.url).toBe('/api/backoffice/closed-accounts/reopen');
    expect(spec.body('Nuno asked')).toEqual({ orgId: 'o1', reason: 'Nuno asked' });
  });

  it('the owner reopen keeps its own endpoint (Prompt 602), now in this tab', () => {
    const a = account({ closedAt: '2026-10-01T10:00:00Z', closedReason: 'owner', daysToPurge: 18 });
    const spec = panelSpec({ kind: 'owner_reopen', account: a });
    expect(spec.url).toBe('/api/backoffice/reopen-org');
    expect(spec.lead).toContain('18 days left');
    expect(spec.lines.join(' ')).toContain('data-room grants revoked');
  });
});

describe('the written confirmation', () => {
  it('Confirm needs a reason, and — when the caller asks — the exact phrase (case and edges ignored)', () => {
    expect(panelCanConfirm({ reason: '', typed: '' })).toBe(false);
    expect(panelCanConfirm({ reason: '   ', typed: '' })).toBe(false);
    expect(panelCanConfirm({ reason: 'asked by Nuno', typed: '' })).toBe(true); // no phrase asked for: exactly what the panel did before
    expect(panelCanConfirm({ reason: 'asked by Nuno', confirmPhrase: 'alex@zz-test.example', typed: '' })).toBe(false);
    expect(panelCanConfirm({ reason: 'asked by Nuno', confirmPhrase: 'alex@zz-test.example', typed: 'alex@zz-test' })).toBe(false);
    expect(panelCanConfirm({ reason: 'asked by Nuno', confirmPhrase: 'alex@zz-test.example', typed: '  ALEX@zz-test.example ' })).toBe(true);
    expect(panelCanConfirm({ reason: '', confirmPhrase: 'x', typed: 'x' })).toBe(false);
  });
});

describe('Delete no longer promises a lock-out it does not give', () => {
  it('Suspend still says "whatever else they hold"; Delete says who it blocks, who still gets in, and how to lock a person out', () => {
    const suspend = moderationCascadeLines('org', 'suspend').join(' ');
    const del = moderationCascadeLines('org', 'delete').join(' ');
    expect(suspend).toContain('Blocks sign-in for every member of this startup, whatever else they hold.');
    expect(del).not.toContain('whatever else they hold.');
    expect(del).toContain('nothing else live to sign in to');
    expect(del).toContain('ecosystem organisation, or holds an investor seat');
    expect(del).toContain('suspend instead, or block their e-mail');
    expect(moderationCascadeLines('investor', 'suspend').join(' ')).toContain('whatever else they hold');
    expect(moderationCascadeLines('investor', 'delete').join(' ')).toContain('nothing else live to sign in to');
  });
});

describe('the two new events read as sentences in the audit log', () => {
  const row = (action: string, detail: unknown) => ({ id: '1', admin_user_id: 'u1', action, subject_type: 'org', subject_id: 'o1', detail, created_at: '2026-10-13T10:00:00Z' });

  it('org_moderation_reopened', () => {
    expect(describeAuditEvent(row('org_moderation_reopened', { orgName: 'zz-test-caramel', reason: 'Nuno asked' }), 'alexandrameira'))
      .toBe('alexandrameira reopened zz-test-caramel (it had been deleted by moderation) — "Nuno asked"');
  });

  it('org_member_released, and when it was the last member', () => {
    expect(describeAuditEvent(row('org_member_released', { orgName: 'zz-test-caramel', email: 'alex@zz-test.example', reason: 'owner invite', closedByThisRelease: false }), 'alexandrameira'))
      .toBe('alexandrameira released alex@zz-test.example from zz-test-caramel so the e-mail can be used elsewhere — "owner invite"');
    expect(describeAuditEvent(row('org_member_released', { orgName: 'zz-test-caramel', email: 'alex@zz-test.example', reason: 'owner invite', closedByThisRelease: true }), 'alexandrameira'))
      .toContain('it was the last member, so the account was closed');
  });
});

describe('the Startups page', () => {
  const page = readFileSync(path.resolve(__dirname, '../../app/backoffice/startups/page.tsx'), 'utf8');

  it('has the new tab, hosts it, and keeps the accounts that ended out of the live list — saying where they went', () => {
    expect(page).toContain("{ key: 'closed', label:");
    expect(page).toContain('<ClosedDeletedTab');
    expect(page).toMatch(/\.filter\(\(o\) => !isDeadOrg\(o\)\)/);
    expect(page).toContain('Closed &amp; deleted');
    expect(page).toContain('onOpenClosed');
  });

  it('no longer carries the owner-closure Reopen in the Orgs list (it moved to the tab with its account)', () => {
    expect(page).not.toContain('window.prompt');
    expect(page).not.toContain("'/api/backoffice/reopen-org'");
  });
});
