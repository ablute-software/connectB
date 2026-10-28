// Prompt 918 (I3) — "Possible duplicate": the signals, what does not count (generic mailboxes), and that nothing is ever blocked — it only tells.
import { describe, expect, it } from 'vitest';
import { domainOf, duplicateSentence, findPossibleDuplicates, hostOf, type DuplicateFacts } from './duplicates';

const app = (id: string, over: Partial<DuplicateFacts> = {}): DuplicateFacts => ({ applicationId: id, reference: `REF-${id}`, startup: `Startup ${id}`, website: null, emails: [], people: [], taxId: null, ...over });

describe('the pieces', () => {
  it('a website is compared by its host; an email by its domain', () => {
    expect(hostOf('https://www.Acme.pt/about?x=1')).toBe('acme.pt');
    expect(hostOf('acme.pt')).toBe('acme.pt');
    expect(hostOf('not a url')).toBeNull();
    expect(hostOf(null)).toBeNull();
    expect(domainOf('Ana@Acme.PT')).toBe('acme.pt');
  });
});

describe('what is shared', () => {
  it('the same normalised name (case, punctuation and the legal suffix do not matter)', () => {
    const m = findPossibleDuplicates([app('a', { startup: 'Acme Robotics, Lda.' }), app('b', { startup: 'ACME ROBOTICS Unipessoal Lda' })]);
    expect(m.get('a')?.[0]).toMatchObject({ applicationId: 'b', signals: ['same_name'] });
    expect(m.get('b')?.[0]).toMatchObject({ applicationId: 'a', signals: ['same_name'] });
  });
  it('the same website; the same company email domain — but never a generic mailbox', () => {
    const site = findPossibleDuplicates([app('a', { website: 'https://acme.pt' }), app('b', { website: 'http://www.acme.pt/en' })]);
    expect(site.get('a')?.[0].signals).toEqual(['same_website']);
    const mail = findPossibleDuplicates([app('a', { emails: ['ana@acme.pt'] }), app('b', { emails: ['bruno@acme.pt'] })]);
    expect(mail.get('a')?.[0].signals).toEqual(['same_email_domain']);
    const generic = findPossibleDuplicates([app('a', { emails: ['ana@gmail.com'] }), app('b', { emails: ['bruno@gmail.com'] }), app('c', { emails: ['c@hotmail.com'] }), app('d', { emails: ['d@hotmail.com'] })]);
    expect(generic.size).toBe(0);
  });
  it('the same person in two startups; the same tax ID (nine digits, spaces ignored)', () => {
    const p = findPossibleDuplicates([app('a', { people: ['u1', 'u2'] }), app('b', { people: ['u3', 'u2'] })]);
    expect(p.get('a')?.[0].signals).toEqual(['same_person']);
    const t = findPossibleDuplicates([app('a', { taxId: '513 456 789' }), app('b', { taxId: '513456789' }), app('c', { taxId: '12345' }), app('d', { taxId: '12345' })]);
    expect(t.get('a')?.[0].signals).toEqual(['same_tax_id']);
    expect(t.has('c')).toBe(false);
  });
  it('several signals at once are all listed; nothing in common is nothing', () => {
    const m = findPossibleDuplicates([app('a', { startup: 'Acme', website: 'acme.pt', emails: ['a@acme.pt'] }), app('b', { startup: 'Acme', website: 'acme.pt', emails: ['b@acme.pt'] }), app('z', { startup: 'Other', website: 'other.pt' })]);
    expect(m.get('a')?.[0].signals).toEqual(['same_name', 'same_website', 'same_email_domain']);
    expect(m.has('z')).toBe(false);
  });
  it('says it in a sentence', () => {
    expect(duplicateSentence({ applicationId: 'b', reference: 'APP-1', startup: 'Acme', signals: ['same_name', 'same_website'] })).toBe('Acme (APP-1): the same company name, the same website.');
  });
});
