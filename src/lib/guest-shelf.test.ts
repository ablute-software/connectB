import { describe, expect, it } from 'vitest';
import {
  canOpenWithoutConfirmation, decideGuestOpen, groupGuestDocuments, shelfFromFolderKind,
} from './guest-shelf';

// Prompt 547 — this is the security rule, so the tests that matter most are
// the refusals. The whole point of the change is that ONE shelf opens without
// an account; anything that widens it beyond that shelf is the bug.

describe('decideGuestOpen', () => {
  it('opens a Materials document with no NDA — the case the change exists for', () => {
    expect(decideGuestOpen({ shelf: 'materials', ndaRequired: false })).toEqual({ allowed: true });
  });

  it('refuses a Data Room document, with the reason the page renders', () => {
    expect(decideGuestOpen({ shelf: 'data_room', ndaRequired: false }))
      .toEqual({ allowed: false, reason: 'confirmation_required' });
  });

  it('refuses an NDA-marked document even on the Materials shelf', () => {
    // A founder who marked something NDA-required said it is not for open
    // sending; the shelf it happens to sit on does not override that.
    expect(decideGuestOpen({ shelf: 'materials', ndaRequired: true }))
      .toEqual({ allowed: false, reason: 'nda_required' });
  });

  it('reports NDA ahead of the shelf when both would refuse', () => {
    expect(decideGuestOpen({ shelf: 'data_room', ndaRequired: true }))
      .toEqual({ allowed: false, reason: 'nda_required' });
  });
});

describe('canOpenWithoutConfirmation', () => {
  it.each([
    [{ shelf: 'materials' as const, ndaRequired: false }, true],
    [{ shelf: 'materials' as const, ndaRequired: true }, false],
    [{ shelf: 'data_room' as const, ndaRequired: false }, false],
    [{ shelf: 'data_room' as const, ndaRequired: true }, false],
  ])('%o -> %s', (doc, expected) => {
    expect(canOpenWithoutConfirmation(doc)).toBe(expected);
  });
});

describe('groupGuestDocuments', () => {
  const docs = [
    { id: 'a', name: 'Sherlock Deal_ Pitch Deck.pdf', shelf: 'materials' as const, ndaRequired: false },
    { id: 'b', name: '03 Financial', shelf: 'data_room' as const, ndaRequired: false },
    { id: 'c', name: 'Financial Plan_ simplified', shelf: 'materials' as const, ndaRequired: true },
    { id: 'd', name: 'Sherlock Deal_ One Pager.docx', shelf: 'materials' as const, ndaRequired: false },
  ];

  it('puts only openable documents in openNow', () => {
    const { openNow } = groupGuestDocuments(docs);
    expect(openNow.map((d) => d.id)).toEqual(['a', 'd']);
  });

  it('sends the Data Room document and the NDA one to confirmRequired', () => {
    const { confirmRequired } = groupGuestDocuments(docs);
    expect(confirmRequired.map((d) => d.id)).toEqual(['b', 'c']);
  });

  it('loses nothing — every document lands in exactly one group', () => {
    const { openNow, confirmRequired } = groupGuestDocuments(docs);
    expect(openNow.length + confirmRequired.length).toBe(docs.length);
    expect(new Set([...openNow, ...confirmRequired].map((d) => d.id)).size).toBe(docs.length);
  });

  it('handles an empty share without inventing a group', () => {
    expect(groupGuestDocuments([])).toEqual({ openNow: [], confirmRequired: [] });
  });

  it('agrees with the predicate the open route enforces', () => {
    // If these two ever disagree, the page offers a link the route refuses.
    const { openNow } = groupGuestDocuments(docs);
    expect(openNow.every((d) => canOpenWithoutConfirmation(d))).toBe(true);
  });
});

describe('shelfFromFolderKind', () => {
  it('maps the two real enum values', () => {
    expect(shelfFromFolderKind('materials')).toBe('materials');
    expect(shelfFromFolderKind('data_room')).toBe('data_room');
  });

  it.each([null, undefined, '', 'archive', 'MATERIALS'])(
    'falls back to the CLOSED shelf for %o', (kind) => {
      // Unreachable today (NOT NULL enum of two values), but if a third is
      // added the failure must be "asks for a code", never "opens to anyone
      // holding the link". Note the case-sensitivity: 'MATERIALS' is not the
      // enum value and must not be treated as one.
      expect(shelfFromFolderKind(kind as string | null | undefined)).toBe('data_room');
    },
  );
});
