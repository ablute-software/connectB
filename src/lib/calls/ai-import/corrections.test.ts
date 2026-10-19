// Prompt 917 (Adenda 1, Part B) — what people correct in the review is kept per run and summarised for the back office: the corrections that happen most are where the
// rules of the platform's own reader get better.
import { describe, expect, it } from 'vitest';
import { diffCorrections, summariseCorrections } from './corrections';
import type { ProposalFieldItem } from './proposal';

const f = (over: Partial<ProposalFieldItem> & { tmpId: string }): ProposalFieldItem => ({ page: 1, kind: 'short_text', label: 'Q', instruction: null, required: true, options: [], expectedType: null, maxAgeMonths: null, ...over });

describe('what the person changed against the proposal', () => {
  const proposed = [
    f({ tmpId: 'a', number: '1.1', label: '1.1 Name', source: 'internal' }),
    f({ tmpId: 'b', number: '1.2', label: '1.2 Sector', kind: 'single_choice', options: ['A', 'B'], source: 'internal' }),
    f({ tmpId: 'c', number: '1.3', label: '1.3 Concorda?', kind: 'yes_no', source: 'ai' }),
    f({ tmpId: 'd', number: '1.4', label: '1.4 Notes', source: 'ai' }),
    f({ tmpId: 'e', number: '1.5', label: '1.5 Link', kind: 'url', source: 'internal' }),
  ];
  it('nothing changed: nothing recorded', () => { expect(diffCorrections(proposed, proposed)).toEqual([]); });
  it('a deleted question, a changed kind, label, required flag and options — each with its number and who made the item', () => {
    const accepted = [
      { ...proposed[0], label: '1.1 Full name' },
      { ...proposed[1], options: ['A', 'B', 'C'] },
      { ...proposed[2], kind: 'short_text' as const },
      // d deleted
      { ...proposed[4], required: false },
    ];
    expect(diffCorrections(proposed, accepted)).toEqual([
      { kind: 'label_changed', number: '1.1', source: 'internal', detail: { kind: 'short_text' } },
      { kind: 'options_changed', number: '1.2', source: 'internal', detail: { from: 2, to: 3, kind: 'single_choice' } },
      { kind: 'kind_changed', number: '1.3', source: 'ai', detail: { from: 'yes_no', to: 'short_text', label: '1.3 Concorda?' } },
      { kind: 'field_deleted', number: '1.4', source: 'ai', detail: { kind: 'short_text', label: '1.4 Notes' } },
      { kind: 'required_changed', number: '1.5', source: 'internal', detail: { from: true, to: false, kind: 'url' } },
    ]);
  });
  it('a question the person ADDED by hand is not a correction of the engine; whitespace is not an edit', () => {
    const accepted = [...proposed.map((p) => ({ ...p, label: `${p.label}  ` })), f({ tmpId: 'new', label: 'Mine' })];
    expect(diffCorrections(proposed, accepted)).toEqual([]);
  });
  it('everything deleted is recorded as deleted', () => { expect(diffCorrections(proposed, []).map((c) => c.kind)).toEqual(Array(5).fill('field_deleted')); });
});

describe('the back office\'s view', () => {
  const rows = [
    { kind: 'kind_changed', source: 'internal', detail: { from: 'short_text', to: 'long_text' } },
    { kind: 'kind_changed', source: 'internal', detail: { from: 'short_text', to: 'long_text' } },
    { kind: 'kind_changed', source: 'ai', detail: { from: 'short_text', to: 'long_text' } },
    { kind: 'kind_changed', source: 'ai', detail: { from: 'yes_no', to: 'short_text' } },
    { kind: 'field_deleted', source: 'internal', detail: { kind: 'file' } },
    { kind: 'field_deleted', source: null, detail: { kind: 'file' } },
    { kind: 'field_deleted', source: 'ai', detail: { kind: 'group' } },
    { kind: 'label_changed', source: 'internal', detail: null },
  ];
  it('the most frequent first: kinds, the kind changes with who made them, the kinds deleted', () => {
    const s = summariseCorrections(rows);
    expect(s.total).toBe(8);
    expect(s.byKind.map((k) => [k.kind, k.count])).toEqual([['kind_changed', 4], ['field_deleted', 3], ['label_changed', 1]]);
    expect(s.kindChanges[0]).toEqual({ from: 'short_text', to: 'long_text', count: 3, internal: 2, ai: 1 });
    expect(s.kindChanges[1]).toMatchObject({ from: 'yes_no', to: 'short_text', count: 1 });
    expect(s.deleted).toEqual([{ kind: 'file', count: 2 }, { kind: 'group', count: 1 }]);
    expect(s.bySource).toEqual({ internal: 4, ai: 3, unknown: 1 });
  });
  it('no corrections: an empty summary, not an error', () => {
    expect(summariseCorrections([])).toEqual({ total: 0, byKind: [], kindChanges: [], deleted: [], bySource: { internal: 0, ai: 0, unknown: 0 } });
  });
});
