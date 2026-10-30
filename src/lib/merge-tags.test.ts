// Prompt 924 (acerto, 29/10/2026) — merge tags, the pure half: the stored value is the code, the screen shows tags, an unknown field is a red tag that keeps what was written.
import { describe, expect, it } from 'vitest';
import { codesToTags, plainWithCodes, tagHtml, tagsToCodes, unknownCodes, type MergeField } from './merge-tags';

const FIELDS: MergeField[] = [{ key: 'applicant_name', label: 'Applicant name' }, { key: 'call_title', label: 'Call title' }];

describe('merge tags', () => {
  it('a code in the text becomes a tag with the name of the field, in one block that is not edited inside', () => {
    const html = codesToTags('<p>Dear {applicant_name}, about {call_title}.</p>', FIELDS);
    expect(html).toContain('<span class="merge-tag" data-merge="applicant_name" contenteditable="false">Applicant name</span>');
    expect(html).toContain('>Call title</span>');
    expect(html.replace(/<[^>]*>/g, '')).toBe('Dear Applicant name, about Call title.');
  });
  it('what is stored is the code: tags go back to codes exactly, and the round trip changes nothing', () => {
    const stored = '<p>Dear {applicant_name},</p><p>Re: {call_title} &amp; more</p>';
    expect(tagsToCodes(codesToTags(stored, FIELDS))).toBe(stored);
  });
  it('an old message with {…} codes opens with tags, and opening it again does not nest them', () => {
    const once = codesToTags('<p>Hi {applicant_name}</p>', FIELDS);
    expect(codesToTags(once, FIELDS)).toBe(once);
  });
  it('an unknown field is a red tag that says so and keeps its code, so saving it back changes nothing', () => {
    const html = codesToTags('<p>Hi {applicant_nam}</p>', FIELDS);
    expect(html).toContain('merge-tag-unknown');
    expect(html).toContain('>Unknown field</span>');
    expect(html).not.toContain('>applicant_nam<');
    expect(tagsToCodes(html)).toBe('<p>Hi {applicant_nam}</p>');
    expect(unknownCodes('<p>Hi {applicant_nam} {call_title} {applicant_nam} {other}</p>', FIELDS)).toEqual(['applicant_nam', 'other']);
  });
  it('markup is never touched: a brace inside an attribute is not a field, and text that is not a code stays as it is', () => {
    const html = codesToTags('<a href="https://x.test/?q={call_title}">{ not a code } and {1abc}</a>', FIELDS);
    expect(html).toContain('href="https://x.test/?q={call_title}"');
    expect(html).toContain('{ not a code } and {1abc}');
  });
  it('a tag copied is plain text with its code for any other place', () => {
    expect(plainWithCodes(`<p>Dear ${tagHtml('applicant_name', FIELDS)},</p><p>Bye</p>`)).toBe('Dear {applicant_name},\nBye');
  });
});
