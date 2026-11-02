// Prompt 930 (B) — the pure parts of the eligibility screen: which list of rules opens first, and the filters of the list of applications with their counts.
import { describe, expect, it } from 'vitest';
import { initialRuleTab, RULE_TABS } from './ApplicationEligibility';
import { changedByAPerson, filterCounts, isFilter, shown } from './SubmissionsTab';

describe('which list of rules opens first', () => {
  const rules = (...e: ('fail' | 'validate' | 'pass')[]) => e.map((effective) => ({ effective }));
  it('Unmet for a Not a fit, To validate for a To validate, Met for a Fit', () => {
    expect(initialRuleTab('not_fit', rules('fail', 'pass'))).toBe('unmet');
    expect(initialRuleTab('to_validate', rules('validate', 'pass'))).toBe('validate');
    expect(initialRuleTab('fit', rules('pass', 'pass'))).toBe('met');
  });
  it('when that list is empty (a person reclassified it with no rule behind) the first list that has something opens', () => {
    expect(initialRuleTab('not_fit', rules('pass'))).toBe('met');
    expect(initialRuleTab('not_fit', rules('validate', 'pass'))).toBe('validate');
    expect(initialRuleTab('to_validate', rules())).toBe('validate');
    expect(RULE_TABS.map((t) => t.label)).toEqual(['Unmet', 'To validate', 'Met']);
  });
});

describe('the filters of the list', () => {
  const item = (state: 'fit' | 'not_fit' | 'to_validate' | 'processing', source: string | null = 'engine') => ({ applicationId: Math.random().toString(), reference: null, startup: 's', submittedAt: '', eligibility: { state: state === 'processing' ? 'queued' as const : state, view: state, reason: '', source } });
  const items = [item('fit'), item('fit', 'human'), item('not_fit'), item('not_fit', 'human'), item('to_validate', 'flag'), item('processing', null)];
  it('count every filter from the list itself; "Changed by a person" is a decision or a flag by someone, not the automatic check', () => {
    expect(filterCounts(items as never)).toEqual({ all: 6, fit: 2, not_fit: 2, to_validate: 1, processing: 1, changed: 3 });
    expect(changedByAPerson(item('fit') as never)).toBe(false);
    expect(changedByAPerson(item('fit', 'human') as never)).toBe(true);
    expect(changedByAPerson(item('to_validate', 'flag') as never)).toBe(true);
  });
  it('show the applications of one filter; a filter in the address is read only if it is one of ours', () => {
    expect(shown(items as never, 'not_fit')).toHaveLength(2);
    expect(shown(items as never, 'changed')).toHaveLength(3);
    expect(shown(items as never, 'all')).toHaveLength(6);
    expect(['all', 'fit', 'not_fit', 'to_validate', 'processing', 'changed'].every(isFilter)).toBe(true);
    expect(isFilter('drop table')).toBe(false);
    expect(isFilter(undefined)).toBe(false);
  });
});
