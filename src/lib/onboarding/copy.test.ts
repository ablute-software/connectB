import { describe, expect, it } from 'vitest';
import { COMPANY_FALLBACK, COMPANY_TOKEN, renderOnboardingCopy } from './copy';
import { ONBOARDING_CONTENT } from './content';
import { TOUR_CONTENT } from './tourContent';

// Prompt 552 — the Welcome modal's first screen printed "About [Company]"
// to a real founder, with the sidebar beside it correctly showing "about
// ablute_". The copy was pasted verbatim from a brief that used [Company]
// as a stand-in, and nothing anywhere interpolated it.

describe('renderOnboardingCopy', () => {
  it('substitutes the company name', () => {
    expect(renderOnboardingCopy('About {company} is where…', { company: 'ablute_' }))
      .toBe('About ablute_ is where…');
  });

  it('falls back to the sidebar’s own wording when there is no name', () => {
    // shell.tsx:157 renders "about your company" for a nameless org. The
    // modal must not invent a different phrase for the same state.
    expect(COMPANY_FALLBACK).toBe('your company');
    for (const empty of ['', null, undefined, '   ', '\t\n']) {
      expect(renderOnboardingCopy('About {company} is where…', { company: empty }))
        .toBe('About your company is where…');
    }
  });

  it('trims a padded name rather than printing the padding', () => {
    expect(renderOnboardingCopy('About {company}.', { company: '  ablute_  ' })).toBe('About ablute_.');
  });

  it('treats the name as LITERAL text, not a replacement pattern', () => {
    // The reason this uses split/join and not String.replace(token, name):
    // in a string replacement `$&`, `$1`, `` $` `` and `$'` are substitution
    // patterns, so these names would come out mangled or duplicated.
    expect(renderOnboardingCopy('About {company}.', { company: 'M&A $1 Ventures' }))
      .toBe('About M&A $1 Ventures.');
    expect(renderOnboardingCopy('About {company}.', { company: '$& Capital' }))
      .toBe('About $& Capital.');
    expect(renderOnboardingCopy('About {company}.', { company: "$` and $' Ltd" }))
      .toBe("About $` and $' Ltd.");
  });

  it('replaces EVERY occurrence, not just the first', () => {
    expect(renderOnboardingCopy('{company} and {company}', { company: 'Acme' }))
      .toBe('Acme and Acme');
  });

  it('returns text without the token completely unchanged', () => {
    const plain = 'Dashboard tracks your progress over time.';
    expect(renderOnboardingCopy(plain, { company: 'ablute_' })).toBe(plain);
    // Including text that merely looks bracket-ish.
    expect(renderOnboardingCopy('See [the docs] for more.', { company: 'ablute_' }))
      .toBe('See [the docs] for more.');
  });
});

describe('the onboarding copy itself', () => {
  const allText = [
    ...ONBOARDING_CONTENT.flatMap((i) => [
      i.title, i.body, i.primaryCta ?? '', i.secondaryCta ?? '',
      ...(i.steps ?? []).flatMap((s) => [s.title, s.body]),
    ]),
    ...Object.values(TOUR_CONTENT).flatMap((steps) => steps.flatMap((s) => [s.title, s.body])),
  ];

  it('contains no square-bracket placeholder anywhere', () => {
    // The shape that shipped. A bare [Company] reads like prose a writer
    // meant to keep, which is exactly how it survived review.
    for (const text of allText) {
      expect(text, `"${text.slice(0, 60)}…" still carries a [Company] placeholder`)
        .not.toMatch(/\[compan(y|ies)\]/i);
    }
  });

  it('uses no curly token other than {company}', () => {
    // A token nothing interpolates is the original bug wearing new braces.
    for (const text of allText) {
      for (const token of text.match(/\{[^}]*\}/g) ?? []) {
        expect(token, `unknown token ${token} in "${text.slice(0, 60)}…"`).toBe(COMPANY_TOKEN);
      }
    }
  });

  it('the Welcome step that reported the bug now carries the token', () => {
    const welcome = ONBOARDING_CONTENT.find((i) => i.key === 'welcome');
    expect(welcome?.steps?.[0].body).toContain(COMPANY_TOKEN);
    expect(renderOnboardingCopy(welcome!.steps![0].body, { company: 'ablute_' }))
      .toMatch(/^About ablute_ is where/);
  });
});
