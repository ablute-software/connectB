// Prompt 525 — the four cases the prompt names, built on the REAL incident:
// Watson quoted Dr. Golnaz Borghei (APEX Ventures) with words she did not
// write. Her hook is correct and verified against the source; what was wrong
// is that the draft shortened the quote and kept the quotation marks.
import { describe, it, expect } from 'vitest';
import { lintMessage, extractQuotedSpans, unsourcedQuotes, QUOTE_MIN_WORDS } from './rules';
import type { Person, Entity } from './types';

// Verbatim from people.hook in production, itself verbatim from the APEX
// Ventures "Meet Our Team" interview of 11/11/2025.
const REAL_QUOTE = 'Is there a clear path to market? Is there an exit strategy that makes sense within our time horizon?';
// What the draft actually said: "Is there a", "Is there an" and "that makes
// sense" removed, quote marks kept.
const CUT_QUOTE = 'clear path to market? exit strategy within our time horizon?';

// The ACTUAL people.hook row in production (org ablute_, person
// 6485907c-dc6b-4958-8e53-303c6ccbc779), copied verbatim. Using the real
// string matters: it wraps the quote in SINGLE quotes and prefixes it with
// "So, in every deal, I ask:", so it exercises the real containment case
// rather than a tidied-up paraphrase of it.
const PRODUCTION_HOOK =
  "In APEX's own 'Meet Our Team' interview (11 Nov 2025) she published her screening question verbatim: "
  + "'So, in every deal, I ask: Is there a clear path to market? Is there an exit strategy that makes sense "
  + "within our time horizon?' - and named the European techbio bottleneck as 'access to growth capital, "
  + "pathways to exit, and expansion into the US market'. She is also lecturing on VC at Cambridge Judge "
  + 'this academic year.';

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', entity_id: 'e1', full_name: 'Golnaz Borghei', kill_words: [],
  hook: PRODUCTION_HOOK,
  hook_status: 'researched', ...over,
} as Person);

const entity = { id: 'e1', name: 'APEX Ventures' } as Entity;
const lint = (draft: string, p = person(), sources?: { threadSnippets?: string[] }) =>
  lintMessage(draft, p, entity, 'email', sources);
const quoteErrors = (draft: string, p = person(), s?: { threadSnippets?: string[] }) =>
  lint(draft, p, s).filter((f) => f.severity === 'error' && f.message.includes('misattributes'));

describe('(a) the real incident must be caught', () => {
  it('flags the shortened quote as misattributed', () => {
    const draft = `Golnaz — you ask "${CUT_QUOTE}" and that is exactly our framing.\n\nBest, Nuno`;
    const errors = quoteErrors(draft);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Golnaz Borghei');
    expect(errors[0].severity).toBe('error');
  });

  it('is an error, not a warning — same severity as a kill word', () => {
    // The risk is the same kind: it burns the contact. A warning would let
    // the founder send it anyway without noticing.
    const draft = `You ask "${CUT_QUOTE}".`;
    expect(quoteErrors(draft)[0].severity).toBe('error');
  });
});

describe('(b) the full, verbatim quote must pass', () => {
  it('does not flag the exact words from the hook', () => {
    const draft = `Golnaz — in your APEX interview you ask "${REAL_QUOTE}" and that is exactly our framing.`;
    expect(quoteErrors(draft)).toHaveLength(0);
  });

  it('tolerates typography and whitespace, never wording', () => {
    // Curly quotes and a line break inside the quote are the same words.
    const curly = REAL_QUOTE.replace(/\?/g, '?').replace('market? Is', 'market?\n  Is');
    expect(quoteErrors(`She asks “${curly}”.`)).toHaveLength(0);
    // One word changed is not the same words.
    expect(quoteErrors(`She asks "${REAL_QUOTE.replace('clear', 'obvious')}".`)).toHaveLength(1);
  });

  it('accepts the other real quote in the same hook (the techbio bottleneck)', () => {
    // Proves the check works against the production hook as a whole, not just
    // the one span the incident happened to involve.
    expect(quoteErrors('You named it "access to growth capital, pathways to exit, and expansion into the US market".')).toHaveLength(0);
  });

  it('accepts a shorter but still word-for-word sub-span', () => {
    // Exactly what the new prompt rule tells the model to do instead of cutting.
    expect(quoteErrors('You ask "Is there a clear path to market?" — here is ours.')).toHaveLength(0);
  });
});

describe('(c) a short term in scare quotes is not attributed speech', () => {
  it('ignores a single quoted kill word', () => {
    const p = person({ kill_words: [] });
    expect(quoteErrors('We never describe ourselves as "wellness".', p)).toHaveLength(0);
  });

  it('ignores any quoted span below the word threshold', () => {
    expect(QUOTE_MIN_WORDS).toBeGreaterThanOrEqual(4);
    const short = Array.from({ length: QUOTE_MIN_WORDS - 1 }, (_, i) => `w${i}`).join(' ');
    expect(quoteErrors(`They called it "${short}".`)).toHaveLength(0);
  });

  it('does not treat apostrophes or single quotes as quotation', () => {
    // Contractions and possessives would otherwise produce constant noise.
    expect(quoteErrors("Don't worry — the founder's deck isn't the issue here at all.")).toHaveLength(0);
  });
});

describe('sources beyond the hook', () => {
  it('accepts a quote taken verbatim from watch_outs or background', () => {
    const p = person({ hook: undefined, watch_outs: `She has said: ${REAL_QUOTE}` });
    expect(quoteErrors(`You ask "${REAL_QUOTE}".`, p)).toHaveLength(0);
    const p2 = person({ hook: undefined, background: `Background note — ${REAL_QUOTE}` });
    expect(quoteErrors(`You ask "${REAL_QUOTE}".`, p2)).toHaveLength(0);
  });

  it('accepts a quote from a prior message in the thread', () => {
    const p = person({ hook: undefined });
    const draft = 'You wrote "we only look at post-revenue companies in this vertical" — that is us now.';
    expect(quoteErrors(draft, p)).toHaveLength(1);
    expect(quoteErrors(draft, p, {
      threadSnippets: ['we only look at post-revenue companies in this vertical'],
    })).toHaveLength(0);
  });
});

describe('extraction primitives', () => {
  it('finds both straight and curly double-quoted spans', () => {
    expect(extractQuotedSpans('a "one two three four five" b')).toEqual(['one two three four five']);
    expect(extractQuotedSpans('a “one two three four five” b')).toEqual(['one two three four five']);
  });

  it('unsourcedQuotes returns only what is not backed by a source', () => {
    const draft = `"${REAL_QUOTE}" and "something she never said at all here"`;
    expect(unsourcedQuotes(draft, [REAL_QUOTE])).toEqual(['something she never said at all here']);
  });

  it('ignores empty and missing sources without crashing', () => {
    expect(unsourcedQuotes(`"${REAL_QUOTE}"`, [null, undefined, '  '])).toHaveLength(1);
  });
});
