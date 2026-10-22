// Prompt 918, Adenda 2 (C) — the words and numbers of deleting a call, in pure functions: what the dialog lists, the name that confirms, the days left, what the applicants are told. The screen and the server
// share these, so the screen cannot promise what the server does not do.
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_NAME_ERROR, DELETE_NOTIFY_TEXT, DELETE_OPEN_TEXT, DELETE_RETENTION_TEXT, GONE_MESSAGE, PURGE_DAYS, cancelledNoticeText, daysLeft, deletedLine, impactLines, nameMatches, purgeDateFrom,
} from './deletion';
import { availableActions, canDeleteCall } from './lifecycle';
import type { Call, CallStatus } from './types';

describe('the summary before deleting', () => {
  it('one line per thing that is there, with the right plural; nothing for what is not', () => {
    expect(impactLines({ submitted: 3, drafts: 2, files: 7 })).toEqual(['3 submitted applications', '2 applicants with a draft (not submitted yet)', '7 uploaded files']);
    expect(impactLines({ submitted: 1, drafts: 1, files: 1 })).toEqual(['1 submitted application', '1 applicant with a draft (not submitted yet)', '1 uploaded file']);
    expect(impactLines({ submitted: 0, drafts: 2, files: 0 })).toEqual(['2 applicants with a draft (not submitted yet)']);
  });
  it('a call nobody applied to says so, instead of an empty list', () => {
    expect(impactLines({ submitted: 0, drafts: 0, files: 0 })).toEqual(['Nobody has applied to this call yet.']);
  });
  it('never names anyone (numbers only)', () => {
    for (const l of impactLines({ submitted: 4, drafts: 9, files: 12 })) expect(l).toMatch(/^\d+ [a-z ()]+$/);
  });
});

describe('the promises', () => {
  it('say where the call goes, for how long, and what happens after — with the same 30 as the rule', () => {
    expect(PURGE_DAYS).toBe(30);
    expect(DELETE_RETENTION_TEXT).toContain('“Deleted calls”');
    expect(DELETE_RETENTION_TEXT).toContain('restored for 30 days');
    expect(DELETE_RETENTION_TEXT).toContain('removed for good');
    expect(DELETE_OPEN_TEXT).toContain('closes it immediately');
    expect(DELETE_OPEN_TEXT).toContain('This call is no longer available');
    expect(DELETE_NOTIFY_TEXT).toContain('download');
    expect(GONE_MESSAGE).toBe('This call is no longer available');
  });
  it('the purge date is 30 days on', () => {
    expect(purgeDateFrom(new Date('2026-10-21T10:00:00Z')).toISOString()).toBe('2026-11-20T10:00:00.000Z');
  });
});

describe('the name that confirms', () => {
  it('matches whatever the spaces and the case; never an empty name; never a part of it', () => {
    expect(nameMatches('INNOV-ID', 'INNOV-ID')).toBe(true);
    expect(nameMatches('  innov-id ', 'INNOV-ID')).toBe(true);
    expect(nameMatches('My   Call', 'my call')).toBe(true);
    expect(nameMatches('INNOV', 'INNOV-ID')).toBe(false);
    expect(nameMatches('', '')).toBe(false);
    expect(nameMatches('anything', '   ')).toBe(false);
    expect(CONFIRM_NAME_ERROR).toBe('Type the name of the call to confirm.');
  });
});

describe('the days left', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it('counts whole days up (a part of a day is a day), never below zero', () => {
    expect(daysLeft('2026-11-20T10:00:00Z', now)).toBe(30);
    expect(daysLeft('2026-11-20T09:59:00Z', now)).toBe(30);
    expect(daysLeft('2026-10-22T10:00:00Z', now)).toBe(1);
    expect(daysLeft('2026-10-21T10:30:00Z', now)).toBe(1);
    expect(daysLeft('2026-10-20T10:00:00Z', now)).toBe(0);
    expect(daysLeft(null, now)).toBe(0);
  });
  it('says it in a sentence', () => {
    expect(deletedLine('2026-11-20T10:00:00Z', now)).toBe('30 days left to restore');
    expect(deletedLine('2026-10-22T10:00:00Z', now)).toBe('1 day left to restore');
    expect(deletedLine('2026-10-21T10:00:00Z', now)).toBe('Removed for good today');
  });
});

describe('what the applicants are told', () => {
  it('«Entity» has cancelled the call «Title». Your application will be deleted on «date»., and where to take their files from', () => {
    const t = cancelledNoticeText('Portugal Ventures', 'INNOV-ID', '20 Nov 2026');
    expect(t.title).toBe('Portugal Ventures has cancelled the call INNOV-ID');
    expect(t.body).toContain('Portugal Ventures has cancelled the call INNOV-ID. Your application will be deleted on 20 Nov 2026.');
    expect(t.body).toContain('download your files');
    expect(t.body).toContain('Calls → My applications');
  });
});

describe('who may delete, and when (the rule the screen and the server share)', () => {
  const call = (status: CallStatus): Call => ({
    id: 'c', promoterKind: 'catalog_entity', promoterId: 'e', name: 'X', description: null, opensAt: '2026-01-01T00:00:00Z', closesAt: '2027-01-01T00:00:00Z', timezone: 'Europe/Lisbon',
    visibility: 'listed', limitUnit: 'project', allowMultiple: false, contentLanguage: 'en', currency: 'EUR', status, linkToken: null, configVersion: 1,
    validatedAt: null, publishedAt: null, closedAt: null, archivedAt: null, duplicatedFrom: null, createdBy: 'u', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  it('any state, with or without applications: there is no state in which "Delete call" is switched off', () => {
    expect(canDeleteCall()).toBe(true);
    for (const status of ['draft', 'validated', 'scheduled', 'open', 'closed', 'evaluating', 'results_published', 'archived'] as CallStatus[]) {
      for (const apps of [0, 1, 40]) {
        const a = availableActions(call(status), [], new Date('2026-10-21T10:00:00Z'), apps);
        expect(a.canDelete, `${status}/${apps}`).toBe(true);
        expect(a, `${status}/${apps}`).not.toHaveProperty('deleteProblem');                    // no sentence that sends the person to do something else
      }
    }
  });
});
