import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUESTION_TEMPLATES, ruleG1, ruleG3, ruleG3b, ruleG3c, ruleG6, templateFor } from './company-gaps';
import { CLAIM_CATEGORY_LABEL } from './claim-category-labels';
import type { CompanyClaim } from './types';

// Prompt 613 §A — "um teste que corra os modelos de mensagem à procura de
// tokens snake_case e falhe a build — é a única forma de isto não voltar,
// porque é o tipo de coisa que ninguém vê em revisão de código e toda a
// gente vê no ecrã."
//
// TWO instruments, because either alone would miss the case that actually
// shipped:
//
//  - a RUNTIME scan of the messages the rules produce catches an id that
//    arrives through an interpolation, but only for the rules a test happens
//    to fire;
//  - a SOURCE scan of the message/question literals catches every rule
//    whether or not it is exercised — and the sentence that shipped
//    ("nothing in tracao_gtm shows money at risk") was a plain string
//    literal, so the source scan is the one that would have caught it.
//
// Asking which failure the instrument can actually show is the rule that
// this codebase learned three times the hard way; here the answer is that it
// takes both.

// A lowercase word with an underscore inside it: the shape of every internal
// id in this codebase (ClaimCategory keys, rule meta keys, column names).
const SNAKE_CASE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

// Deliberately empty. Adding to it is a decision someone has to justify in a
// diff, which is the point — the alternative is a check that quietly erodes.
const ALLOWED: string[] = [];

function offenders(text: string): string[] {
  return [...text.matchAll(SNAKE_CASE)].map((m) => m[0]).filter((t) => !ALLOWED.includes(t));
}

describe('no internal identifier reaches a sentence a founder reads (Prompt 613 §A)', () => {
  it('the question templates are clean', () => {
    for (const t of QUESTION_TEMPLATES) {
      expect({ rule: t.rule, found: offenders(t.question) }).toEqual({ rule: t.rule, found: [] });
      expect({ rule: t.rule, found: offenders(t.freeTextLabel) }).toEqual({ rule: t.rule, found: [] });
      for (const o of t.options) expect({ rule: t.rule, found: offenders(o) }).toEqual({ rule: t.rule, found: [] });
    }
  });

  it('the messages the rules actually produce are clean', () => {
    const claim = (id: string, category: CompanyClaim['category'], statement: string): CompanyClaim => ({
      id, orgId: 'o', category, statement, evidenceClass: 3, specificity: 'low',
      sourceKind: 'founder_answer', status: 'accepted', createdAt: new Date().toISOString(),
    } as unknown as CompanyClaim);

    const context = { founders: [{ name: 'Ana Silva' }, { name: 'Rui Costa' }], stage: 'seed', now: new Date() };
    const messages = [
      ...ruleG1([]),
      ...ruleG3([claim('e1', 'equipa', 'the team is strong')]),
      ...ruleG3b([claim('e2', 'equipa', 'Ana Silva ran clinical ops at Hospital de Braga')], context),
      ...ruleG3c([], context),
      ...ruleG6([]),
    ].map((g) => g.message);

    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) expect({ m, found: offenders(m) }).toEqual({ m, found: [] });

    // templateFor fills meta into the question — an id smuggled through meta
    // would land in the founder's question rather than in the message.
    for (const gap of [...ruleG3c([], context), ...ruleG6([])]) {
      const t = templateFor(gap);
      expect({ rule: gap.rule, found: offenders(t.question) }).toEqual({ rule: gap.rule, found: [] });
    }
  });

  it('no message or question LITERAL in company-gaps.ts carries an internal id', () => {
    const source = readFileSync(join(__dirname, 'company-gaps.ts'), 'utf8');
    // Only the literal text of the founder-facing fields, and only the parts
    // outside ${...} — an interpolation is a value, checked at runtime above.
    const FIELD = /(?:message|question|freeTextLabel):\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
    const found: { snippet: string; token: string }[] = [];
    for (const m of source.matchAll(FIELD)) {
      const literal = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, ' ');
      for (const token of offenders(literal)) found.push({ snippet: m[1].slice(0, 60), token });
    }
    expect(found).toEqual([]);
  });

  it('every claim category has a label a founder can read', () => {
    for (const label of Object.values(CLAIM_CATEGORY_LABEL)) {
      expect(label.length).toBeGreaterThan(2);
      expect(offenders(label)).toEqual([]);
    }
    // 'funding' is its own label on purpose: it is already an English word.
    // The property that matters is readability, not difference from the key.
    expect(CLAIM_CATEGORY_LABEL.tracao_gtm).toBe('traction and go-to-market');
  });

  // The positive control. Without it, all of the above passing proves only
  // that the scanner ran — not that it can see the thing it exists to see.
  it('would have caught the sentence that shipped', () => {
    const shipped = 'No paid traction: nothing in tracao_gtm shows money at risk (paying customer, paid pilot, purchase order).';
    expect(offenders(shipped)).toEqual(['tracao_gtm']);
    expect(offenders('Team narrative gap: only 0 named person(s).')).toEqual([]);
  });
});
