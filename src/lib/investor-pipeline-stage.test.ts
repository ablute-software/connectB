import { describe, expect, it } from 'vitest';
import {
  investorPipelineStage, investorPipelineStageDetail,
  type InvestorPipelineStageInput,
} from './investor-pipeline-stage';

const base: InvestorPipelineStageInput = {
  latestDecision: null, isArchived: false, hasGrantedLevel3: false,
  hasActiveDataRoomGrant: false, hasEvaluationTrace: false,
};

describe('investorPipelineStage — the six rules, in precedence order', () => {
  it('rule 1: a passed decision is always Passed', () => {
    expect(investorPipelineStage({ ...base, latestDecision: 'passed' })).toBe('passed');
  });
  it('rule 2: an active archive entry (no decision) is Archived', () => {
    expect(investorPipelineStage({ ...base, isArchived: true })).toBe('archived');
  });
  it('rule 3a: a granted level-3 request is Due diligence', () => {
    expect(investorPipelineStage({ ...base, hasGrantedLevel3: true })).toBe('due_diligence');
  });
  it('rule 3b: an active data-room grant alone (no level-3 request at all) is Due diligence', () => {
    expect(investorPipelineStage({ ...base, hasActiveDataRoomGrant: true })).toBe('due_diligence');
  });
  it('rule 4: an interested decision (nothing further) is Interested', () => {
    expect(investorPipelineStage({ ...base, latestDecision: 'interested' })).toBe('interested');
  });
  it('rule 5: no decision, but a real evaluation trace, is Evaluating', () => {
    expect(investorPipelineStage({ ...base, hasEvaluationTrace: true })).toBe('evaluating');
  });
  it('rule 6: nothing at all is New', () => {
    expect(investorPipelineStage(base)).toBe('new');
  });
});

describe('investorPipelineStage — precedence combinations (Prompt 681 §1.1 notes)', () => {
  it('passed + archived → Passed (the Pass is final, AP-06)', () => {
    expect(investorPipelineStage({ ...base, latestDecision: 'passed', isArchived: true })).toBe('passed');
  });
  it('archived + interested → Archived (archiving tidies, it does not decide)', () => {
    expect(investorPipelineStage({ ...base, latestDecision: 'interested', isArchived: true })).toBe('archived');
  });
  it('interested + a PENDING level-3 request → still Interested (pending never promotes)', () => {
    // hasGrantedLevel3 stays false for a pending request — only 'granted' sets it.
    expect(investorPipelineStage({ ...base, latestDecision: 'interested', hasGrantedLevel3: false })).toBe('interested');
  });
  it('interested + a GRANTED level-3 request → Due diligence', () => {
    expect(investorPipelineStage({ ...base, latestDecision: 'interested', hasGrantedLevel3: true })).toBe('due_diligence');
  });
  it('no decision + an active data-room grant → Due diligence', () => {
    expect(investorPipelineStage({ ...base, hasActiveDataRoomGrant: true })).toBe('due_diligence');
  });
  it('no decision + a pending reminder/task (evaluation trace) → Evaluating', () => {
    expect(investorPipelineStage({ ...base, hasEvaluationTrace: true })).toBe('evaluating');
  });
  it('a reminder marked done (no trace left) → New', () => {
    expect(investorPipelineStage({ ...base, hasEvaluationTrace: false })).toBe('new');
  });
  it('withdraw interest (decision cleared) falls back to Evaluating when a trace remains', () => {
    // Withdrawing interest is a DB action outside this pure function's scope
    // (it clears investor_relationship_decisions); the caller re-derives
    // with latestDecision: null afterwards — this is that re-derivation.
    expect(investorPipelineStage({ ...base, latestDecision: null, hasEvaluationTrace: true })).toBe('evaluating');
  });
  it('withdraw interest with no trace at all falls back to New', () => {
    expect(investorPipelineStage({ ...base, latestDecision: null, hasEvaluationTrace: false })).toBe('new');
  });
  it('passed still wins over a granted level-3 / active data-room grant recorded before the pass', () => {
    expect(investorPipelineStage({
      ...base, latestDecision: 'passed', hasGrantedLevel3: true, hasActiveDataRoomGrant: true, hasEvaluationTrace: true,
    })).toBe('passed');
  });
});

describe('investorPipelineStageDetail — the Etapa pill suffix', () => {
  it('Interested with a granted level-2 (full profile) shows "Full profile"', () => {
    expect(investorPipelineStageDetail('interested', { hasGrantedLevel2: true, hasGrantedLevel3: false })).toBe('Full profile');
  });
  it('Interested with no level-2 grant shows no detail', () => {
    expect(investorPipelineStageDetail('interested', { hasGrantedLevel2: false, hasGrantedLevel3: false })).toBeNull();
  });
  it('Due diligence via a granted level-3 request shows "Contact granted"', () => {
    expect(investorPipelineStageDetail('due_diligence', { hasGrantedLevel2: true, hasGrantedLevel3: true })).toBe('Contact granted');
  });
  it('Due diligence via an active data-room grant only (no level-3 request) shows "Data room"', () => {
    expect(investorPipelineStageDetail('due_diligence', { hasGrantedLevel2: false, hasGrantedLevel3: false })).toBe('Data room');
  });
  it('New/Evaluating/Passed/Archived never show a detail suffix', () => {
    for (const stage of ['new', 'evaluating', 'passed', 'archived'] as const) {
      expect(investorPipelineStageDetail(stage, { hasGrantedLevel2: true, hasGrantedLevel3: true })).toBeNull();
    }
  });
});
