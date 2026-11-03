// Prompt 927 (F) — call names: the comparison ignores case, accents and extra spaces; what counts (active, archived, deleted-within-30-days; not purged); the suggestions are free names made without AI; the default
// name and the name of a copy are always free.
import { describe, expect, it } from 'vitest';
import { DEFAULT_CALL_NAME, freeCopyName, freeDefaultName, findNameClash, nameClashBody, nameKey, suggestNames, type NamedCall } from './call-names';

const NOW = new Date('2026-11-03T10:00:00Z');
const call = (id: string, name: string, extra: Partial<NamedCall> = {}): NamedCall => ({ id, name, ...extra });

describe('the comparison', () => {
  it('ignores case, accents and extra spaces', () => {
    expect(nameKey('  INNOV-ID  ')).toBe('innov-id');
    expect(nameKey('Innov-ID')).toBe(nameKey('innov-id'));
    expect(nameKey('Candidatura   Saúde')).toBe(nameKey('candidatura saude'));
    expect(nameKey('Ação')).toBe('acao');
    expect(nameKey('INNOV-ID')).not.toBe(nameKey('INNOV ID'));                              // punctuation still tells two names apart
  });
  it('finds the call that has the name, never the call itself', () => {
    const calls = [call('a', 'INNOV-ID'), call('b', 'Saúde 2026')];
    expect(findNameClash(calls, ' innov-id ')?.id).toBe('a');
    expect(findNameClash(calls, 'SAUDE 2026')?.id).toBe('b');
    expect(findNameClash(calls, 'INNOV-ID', 'a')).toBeNull();                               // renaming a call to what it already is
    expect(findNameClash(calls, 'Something else')).toBeNull();
    expect(findNameClash(calls, '   ')).toBeNull();
  });
  it('counts active, archived and deleted-within-30-days calls; a call already purged does not count', () => {
    const calls = [
      call('active', 'A'), call('archived', 'B'),                                           // an archived call is just a call
      call('deleted', 'C', { deletedAt: '2026-10-20T00:00:00Z', purgeAfter: '2026-11-19T00:00:00Z' }),
      call('purged', 'D', { deletedAt: '2026-09-01T00:00:00Z', purgeAfter: '2026-10-01T00:00:00Z' }),
    ];
    for (const n of ['A', 'B', 'C']) expect(findNameClash(calls, n, null, NOW), n).not.toBeNull();
    expect(findNameClash(calls, 'D', null, NOW)).toBeNull();
    expect(findNameClash(calls, 'C', null, NOW)?.deletedAt).toBeTruthy();
  });
});

describe('the message and the suggestions', () => {
  it('names the call, says where it is when it is deleted, and offers free names', () => {
    const calls = [call('a', 'INNOV-ID')];
    const body = nameClashBody(calls, 'innov-id', null, NOW)!;
    expect(body).toMatchObject({ code: 'duplicate_name', error: 'There is already a call named «INNOV-ID» in your organisation.', existing: { id: 'a', name: 'INNOV-ID', deleted: false } });
    expect(body.suggestions).toEqual(['INNOV-ID 2026', 'INNOV-ID — 2nd edition', 'INNOV-ID 2']);
    const del = nameClashBody([call('d', 'Pitch', { deletedAt: '2026-10-30T00:00:00Z', purgeAfter: '2026-11-29T00:00:00Z' })], 'Pitch', null, NOW)!;
    expect(del.error).toBe('There is already a call named «Pitch» in your organisation (in Deleted calls).');
    expect(del.existing.deleted).toBe(true);
    expect(nameClashBody(calls, 'Other', null, NOW)).toBeNull();
  });
  it('every suggestion is free: a taken year, edition or number is skipped; a name with a year moves on to the next', () => {
    const taken = [call('1', 'INNOV-ID'), call('2', 'INNOV-ID 2026'), call('3', 'INNOV-ID — 2nd edition'), call('4', 'INNOV-ID 2')];
    const s = suggestNames(taken, 'INNOV-ID', NOW);
    expect(s).toHaveLength(3);
    for (const x of s) expect(findNameClash(taken, x, null, NOW), x).toBeNull();
    expect(s).toEqual(['INNOV-ID — 3rd edition', 'INNOV-ID — 4th edition', 'INNOV-ID 3']);
    expect(suggestNames([call('1', 'Call 2026')], 'Call 2026', NOW)[0]).toBe('Call 2027');   // not "Call 2026 2026"
    expect(suggestNames([], 'X', NOW, 2)).toHaveLength(2);
  });
});

describe('the default name and the name of a copy', () => {
  it('"Untitled call", then "Untitled call 2", "Untitled call 3"… — the first one that is free (another organisation\'s names are not passed in)', () => {
    expect(freeDefaultName([], NOW)).toBe(DEFAULT_CALL_NAME);
    expect(freeDefaultName([call('1', 'Untitled call')], NOW)).toBe('Untitled call 2');
    expect(freeDefaultName([call('1', 'Untitled call'), call('2', 'untitled call 2')], NOW)).toBe('Untitled call 3');
    expect(freeDefaultName([call('1', 'Untitled call', { deletedAt: '2026-10-30T00:00:00Z', purgeAfter: '2026-11-29T00:00:00Z' })], NOW)).toBe('Untitled call 2');   // a deleted one still counts
  });
  it('a copy is born with a free name: "X (copy)", then "X (copy 2)"…, within 200 characters', () => {
    expect(freeCopyName([call('1', 'INNOV-ID')], 'INNOV-ID', NOW)).toBe('INNOV-ID (copy)');
    expect(freeCopyName([call('1', 'INNOV-ID'), call('2', 'INNOV-ID (copy)')], 'INNOV-ID', NOW)).toBe('INNOV-ID (copy 2)');
    const long = 'x'.repeat(200);
    expect(freeCopyName([call('1', long)], long, NOW).length).toBeLessThanOrEqual(200);
  });
});
