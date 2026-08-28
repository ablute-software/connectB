import { describe, expect, it } from 'vitest';
import { applicableQuestions } from './bars-scoring';
import { TEAM_V1 } from '../content/bars/team_v1';
import { MARKET_V1 } from '../content/bars/market_v1';
import { PRODUCT_V1 } from '../content/bars/product_v1';
import { TECHNOLOGY_V1 } from '../content/bars/technology_v1';
import { sherlockPrep, buildPrepSessions, prepActionForQuestion, type SherlockPrepSources, type PrepQuestionResult } from './sherlock-prep';

const BANKS = [TEAM_V1, MARKET_V1, PRODUCT_V1, TECHNOLOGY_V1];

function emptySources(): SherlockPrepSources {
  return {
    claims: [], documents: [], extractions: [], tractionMetrics: [], roadmapMilestones: [],
    people: [], fundingRounds: [], market: { rings: 0, competitors: 0, trends: 0, regulatory: 0 },
    capTableEntries: [], clarifications: [],
  };
}

describe('sherlockPrep — every applicable question has a table entry', () => {
  it('never returns undefined for any question in any bank, at any phase', () => {
    const phases = ['concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth'] as const;
    for (const phase of phases) {
      expect(() => sherlockPrep(emptySources(), phase)).not.toThrow();
    }
  });
});

describe('sherlockPrep — empty sources', () => {
  const report = sherlockPrep(emptySources(), 'concept_idea');

  it('marks every applicable question missing', () => {
    expect(report.perQuestion.length).toBeGreaterThan(0);
    expect(report.perQuestion.every((r) => r.state === 'missing')).toBe(true);
    expect(report.perQuestion.every((r) => r.matches.length === 0)).toBe(true);
  });

  it('sessions cover every applicable question exactly once', () => {
    const expectedIds = new Set(BANKS.flatMap((bank) => applicableQuestions(bank, 'concept_idea').map((q) => q.id)));
    const sessionIds = report.sessions.flatMap((s) => s.questionIds);
    expect(new Set(sessionIds)).toEqual(expectedIds);
    expect(sessionIds.length).toBe(expectedIds.size); // exactly once, no duplicates
  });

  it('never mixes axes within one session', () => {
    const byId = new Map(report.perQuestion.map((r) => [r.questionId, r.axis]));
    for (const session of report.sessions) {
      const axes = new Set(session.questionIds.map((id) => byId.get(id)));
      expect(axes.size).toBe(1);
      expect([...axes][0]).toBe(session.axis);
    }
  });

  it('respects maxPerSession', () => {
    for (const session of report.sessions) {
      expect(session.questionIds.length).toBeLessThanOrEqual(5);
      expect(session.estMinutes).toBe(session.questionIds.length * 2);
    }
  });

  it('a custom maxPerSession is honored', () => {
    const sessions = buildPrepSessions(report.perQuestion, 2);
    for (const s of sessions) expect(s.questionIds.length).toBeLessThanOrEqual(2);
  });
});

describe('sherlockPrep — transversal rule (accepted claim + document_refs forces covered)', () => {
  it('forces covered on any question whose table references that claim category, even without matching its own pattern', () => {
    const sources = emptySources();
    sources.claims = [{
      id: 'c1', category: 'equipa', statement: 'Prior startup experience, no specific keywords here',
      evidence_class: 4, document_refs: [{ documentId: 'd1' }],
    }];
    const report = sherlockPrep(sources, 'concept_idea');
    const byId = new Map(report.perQuestion.map((r) => [r.questionId, r]));
    // team.commitment's own WEAK pattern (/full.?time|dedica/i) does not
    // match this statement — only the transversal rule can cover it.
    expect(byId.get('team.commitment')?.state).toBe('covered');
    expect(byId.get('team.technical_capability')?.state).toBe('covered');
    expect(byId.get('team.commitment')?.matches.some((m) => m.source === 'claim' && m.id === 'c1')).toBe(true);
  });

  it('does not cover a question whose table never references the claim category', () => {
    const sources = emptySources();
    sources.claims = [{ id: 'c1', category: 'ask', statement: 'Raising 1.3M', evidence_class: 1, document_refs: [{ documentId: 'd1' }] }];
    const report = sherlockPrep(sources, 'concept_idea');
    // 'ask' is never referenced by any question's matcher table.
    expect(report.perQuestion.every((r) => r.state === 'missing')).toBe(true);
  });

  it('does NOT force covered when the claim has no document_refs (declaration alone is only ever weak)', () => {
    const sources = emptySources();
    sources.claims = [{ id: 'c1', category: 'equipa', statement: 'Full-time founders', evidence_class: 4, document_refs: [] }];
    const report = sherlockPrep(sources, 'concept_idea');
    const byId = new Map(report.perQuestion.map((r) => [r.questionId, r]));
    expect(byId.get('team.commitment')?.state).toBe('weak');
  });
});

describe('sherlockPrep — marketHas', () => {
  it('marketHas(rings) covers market.size_credibility', () => {
    const sources = emptySources();
    sources.market = { rings: 3, competitors: 0, trends: 0, regulatory: 0 };
    const report = sherlockPrep(sources, 'concept_idea');
    const q = report.perQuestion.find((r) => r.questionId === 'market.size_credibility');
    expect(q?.state).toBe('covered');
    expect(q?.matches.some((m) => m.source === 'market')).toBe(true);
  });
});

describe('sherlockPrep — phase gating matches applicableQuestions', () => {
  it('excludes Product questions that only apply from pilot+ at concept_idea', () => {
    const report = sherlockPrep(emptySources(), 'concept_idea');
    const productIds = new Set(report.perQuestion.filter((r) => r.axis === 'product').map((r) => r.questionId));
    const expected = new Set(applicableQuestions(PRODUCT_V1, 'concept_idea').map((q) => q.id));
    expect(productIds).toEqual(expected);
    // value_delivered only enters at pilot+ — must be absent here.
    expect(productIds.has('product.value_delivered')).toBe(false);
  });
});

describe('sherlockPrep — fully covered startup', () => {
  it('returns sessions === [] (success, not an error state)', () => {
    const sources: SherlockPrepSources = {
      claims: (['problema', 'solucao', 'prova_tecnica', 'validacao_externa', 'tracao_gtm', 'equipa', 'mercado_timing'] as const)
        .map((category, i) => ({
          id: `claim-${i}`, category, statement: `${category} statement`, evidence_class: 2,
          document_refs: [{ documentId: 'shared-doc' }],
        })),
      documents: [
        { id: 'd-leadership', name: 'Org chart and hiring plan' },
        { id: 'd-governance', name: 'Shareholder agreement' },
        { id: 'd-keyperson', name: 'Succession and handbook' },
        { id: 'd-delivery', name: 'SOP and implementation guide' },
        { id: 'd-validation', name: 'Peer-reviewed clinical study' },
        { id: 'd-security', name: 'GDPR and ISO security compliance' },
        { id: 'd-risk', name: 'Technical risk roadmap' },
      ],
      extractions: [],
      tractionMetrics: [
        { id: 't-active', label: 'Active users', value: '500' },
        // Lowercase deliberately — tractionMatching is case-SENSITIVE (only
        // docsNamed gets the case-insensitive treatment §1 asks for), and
        // this fixture is meant to exercise the real, literal regex.
        { id: 't-retention', label: 'retention rate', value: '85%' },
      ],
      roadmapMilestones: [{ id: 'm1', period_year: 2026, items: ['Shipped v2 platform'] }],
      people: [
        { id: 'p1', full_name: 'Alice', title: 'CEO', is_founder: true, bio: 'Operator background.' },
        { id: 'p2', full_name: 'Bob', title: 'CTO', is_founder: true, bio: 'Engineering background.' },
      ],
      fundingRounds: [{ id: 'f1', label: 'Pre-seed' }],
      market: { rings: 2, competitors: 3, trends: 1, regulatory: 1 },
      capTableEntries: [{ id: 'ct1', category: 'founders' }],
      clarifications: [{ id: 'cl1' }],
    };

    const report = sherlockPrep(sources, 'growth');
    const notCovered: PrepQuestionResult[] = report.perQuestion.filter((r) => r.state !== 'covered');
    expect(notCovered.map((r) => `${r.questionId}:${r.state}`)).toEqual([]);
    expect(report.sessions).toEqual([]);
  });
});

describe('prepActionForQuestion', () => {
  it('returns a non-empty href for every applicable question in every bank', () => {
    for (const bank of BANKS) {
      for (const q of applicableQuestions(bank, 'growth')) {
        const action = prepActionForQuestion(q.id);
        expect(action, `missing PrepAction for ${q.id}`).toBeDefined();
        expect(action.href).toBeTruthy();
        expect(action.label).toBeTruthy();
      }
    }
  });

  it('routes to /documents for a document-evidenced question', () => {
    expect(prepActionForQuestion('tech.novelty').href).toBe('/documents');
  });

  it('routes to /readiness?tab=market_data for a market-evidenced question', () => {
    expect(prepActionForQuestion('market.size_credibility').href).toBe('/readiness?tab=market_data');
  });

  it('routes to /settings#settings-traction for a traction-evidenced question', () => {
    expect(prepActionForQuestion('product.adoption_engagement').href).toBe('/settings#settings-traction');
  });

  it('routes to /settings#settings-facts for a document-backed-claim question', () => {
    expect(prepActionForQuestion('team.entrepreneurial_track').href).toBe('/settings#settings-facts');
  });

  it('routes to /settings#settings-team for team.complementarity', () => {
    expect(prepActionForQuestion('team.complementarity').href).toBe('/settings#settings-team');
  });

  it('routes to /settings?tab=roadmap for team.execution_velocity', () => {
    expect(prepActionForQuestion('team.execution_velocity').href).toBe('/settings?tab=roadmap');
  });

  it('never opens a new tab (no target=_blank baked into the href)', () => {
    for (const bank of BANKS) {
      for (const q of applicableQuestions(bank, 'growth')) {
        expect(prepActionForQuestion(q.id).href.startsWith('/')).toBe(true);
      }
    }
  });
});

describe('sherlockPrep — whatGreatLooksLike', () => {
  it('is the bank L5 anchor verbatim, with l5b appended when present', () => {
    const report = sherlockPrep(emptySources(), 'growth');
    const withPath = report.perQuestion.find((r) => r.questionId === 'team.founder_opportunity_fit')!;
    expect(withPath.whatGreatLooksLike).toBe(`${TEAM_V1.questions[0].anchors.l5} / ${TEAM_V1.questions[0].anchors.l5b}`);
    const withoutPath = report.perQuestion.find((r) => r.questionId === 'team.commercial_capability')!;
    expect(withoutPath.whatGreatLooksLike).toBe(TEAM_V1.questions[1].anchors.l5);
  });
});
