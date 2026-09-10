import { describe, expect, it } from 'vitest';
import { buildHookPack, buildHookSystemPrompt, CHANNEL_CHAR_LIMITS, type HookPackInput } from './hook-pack';

const baseInput: HookPackInput = {
  targetKind: 'person',
  channel: 'linkedin',
  startup: {
    name: 'ablute_', oneLiner: 'Health tracking for X', sectors: ['healthtech'], orgTopics: ['oncology'],
    stage: 'seed', roundTargetEur: 1300000, traction: [{ label: 'MRR', value: '€12k' }],
    introProblem: 'Problem text', introSolution: 'Solution text',
  },
  entity: {
    name: 'Acme Capital', thesis: 'We back health', sectors: ['healthtech'], stageMin: 'seed', stageMax: 'series_a',
    checkMinEur: 100000, checkMaxEur: 500000, hqCountry: 'PT',
    evidence: [
      { id: 'ev-entity-1', kind: 'article_about', title: 'Acme raises fund III', publishedAt: '2026-01-01', excerpt: 'Acme announced', topics: ['oncology'], isPersonal: false },
    ],
    lastInvestments: [{ companyName: 'OtherCo', investedAt: '2025-01-01', roundType: 'seed' }],
  },
  person: {
    fullName: 'Maria Silva', title: 'Partner', seniorityLabel: 'Partner',
    bioRaw: 'x'.repeat(2000),
    evidence: [
      { id: 'ev-person-1', kind: 'podcast', title: 'Talked about early detection', publishedAt: '2026-02-01', excerpt: 'quote', topics: ['oncology'], isPersonal: false },
    ],
  },
  relationship: { hasPriorContact: false, lastPassReason: null },
  watchOuts: [],
  killWords: ['guarantee'],
};

describe('buildHookPack', () => {
  it('includes both entity and person evidence in the pool for a person target', () => {
    const pack = buildHookPack(baseInput);
    const ids = pack.evidencePool.map((e) => e.id);
    expect(ids).toContain('ev-entity-1');
    expect(ids).toContain('ev-person-1');
  });

  it('truncates bio to 1500 chars in the prompt text', () => {
    const pack = buildHookPack(baseInput);
    expect(pack.promptText).not.toContain('x'.repeat(1501));
    expect(pack.promptText).toContain('x'.repeat(1500));
  });

  it('rule 6 — excludes is_personal evidence from an entity-target pack even if the caller passed it', () => {
    const entityTarget: HookPackInput = {
      ...baseInput, targetKind: 'entity', person: null,
      entity: {
        ...baseInput.entity,
        evidence: [
          ...baseInput.entity.evidence,
          { id: 'ev-personal', kind: 'statement', title: 'A personal statement', publishedAt: null, excerpt: null, topics: [], isPersonal: true },
        ],
      },
    };
    const pack = buildHookPack(entityTarget);
    expect(pack.evidencePool.map((e) => e.id)).not.toContain('ev-personal');
  });

  it('never includes person evidence for an entity-target pack', () => {
    const entityTarget: HookPackInput = { ...baseInput, targetKind: 'entity', person: null };
    const pack = buildHookPack(entityTarget);
    expect(pack.evidencePool.map((e) => e.id)).not.toContain('ev-person-1');
  });

  it('picks the char limit from the channel', () => {
    expect(buildHookPack({ ...baseInput, channel: 'form' }).charLimit).toBe(CHANNEL_CHAR_LIMITS.form);
    expect(buildHookPack({ ...baseInput, channel: 'email' }).charLimit).toBe(CHANNEL_CHAR_LIMITS.email);
  });

  it('mentions kill words in the prompt so the model knows to avoid them', () => {
    const pack = buildHookPack(baseInput);
    expect(pack.promptText).toContain('guarantee');
  });
});

describe('buildHookSystemPrompt', () => {
  it('tells the model never to address a named person for an entity target', () => {
    const prompt = buildHookSystemPrompt('entity', 900);
    expect(prompt).toContain('never to a named person');
  });

  it('includes the char limit', () => {
    expect(buildHookSystemPrompt('person', 400)).toContain('400');
  });
});
