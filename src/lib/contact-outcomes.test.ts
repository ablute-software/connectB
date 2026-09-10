import { describe, expect, it } from 'vitest';
import { deriveContactOutcomeLink } from './contact-outcomes';

describe('deriveContactOutcomeLink', () => {
  it('links a person-target hook and carries the person id', () => {
    const result = deriveContactOutcomeLink({ id: 'hook-1', targetKind: 'person', targetId: 'person-1' }, false);
    expect(result).toEqual({ hookSuggestionId: 'hook-1', personId: 'person-1' });
  });

  it('links an entity-target hook without a person id', () => {
    const result = deriveContactOutcomeLink({ id: 'hook-1', targetKind: 'entity', targetId: 'entity-1' }, false);
    expect(result).toEqual({ hookSuggestionId: 'hook-1', personId: null });
  });

  it('links nothing when there is no candidate hook', () => {
    expect(deriveContactOutcomeLink(null, false)).toEqual({ hookSuggestionId: null, personId: null });
  });

  it('links nothing when the candidate hook is already linked to another outcome', () => {
    const result = deriveContactOutcomeLink({ id: 'hook-1', targetKind: 'person', targetId: 'person-1' }, true);
    expect(result).toEqual({ hookSuggestionId: null, personId: null });
  });
});
