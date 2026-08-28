import { describe, expect, it } from 'vitest';
import { vaultAccessAdvice, type VaultAccessAdviceInput } from './vault-access-advice';

const NOW = new Date('2026-08-28T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function baseInput(overrides: Partial<VaultAccessAdviceInput> = {}): VaultAccessAdviceInput {
  return {
    entities: [{ id: 'e1', name: 'Acme Ventures' }],
    interactions: [],
    grants: [],
    people: [],
    ...overrides,
  };
}

describe('vaultAccessAdvice — inConversationWithoutAccess', () => {
  it('flags an entity with both inbound and outbound interactions in the last 30 days, no grant', () => {
    const input = baseInput({
      interactions: [
        { entity_id: 'e1', at: new Date(NOW.getTime() - 5 * DAY).toISOString(), direction: 'out' },
        { entity_id: 'e1', at: new Date(NOW.getTime() - 3 * DAY).toISOString(), direction: 'in' },
      ],
    });
    const result = vaultAccessAdvice(input, NOW);
    expect(result.inConversationWithoutAccess).toEqual([{ entityId: 'e1', name: 'Acme Ventures' }]);
  });

  it('does not count an outbound-only sequence as a conversation', () => {
    const input = baseInput({
      interactions: [
        { entity_id: 'e1', at: new Date(NOW.getTime() - 5 * DAY).toISOString(), direction: 'out' },
        { entity_id: 'e1', at: new Date(NOW.getTime() - 2 * DAY).toISOString(), direction: 'out' },
      ],
    });
    expect(vaultAccessAdvice(input, NOW).inConversationWithoutAccess).toEqual([]);
  });

  it('does not count an inbound-only sequence as a conversation', () => {
    const input = baseInput({
      interactions: [{ entity_id: 'e1', at: new Date(NOW.getTime() - 1 * DAY).toISOString(), direction: 'in' }],
    });
    expect(vaultAccessAdvice(input, NOW).inConversationWithoutAccess).toEqual([]);
  });

  it('does not count a conversation outside the 30-day window', () => {
    const input = baseInput({
      interactions: [
        { entity_id: 'e1', at: new Date(NOW.getTime() - 40 * DAY).toISOString(), direction: 'out' },
        { entity_id: 'e1', at: new Date(NOW.getTime() - 35 * DAY).toISOString(), direction: 'in' },
      ],
    });
    expect(vaultAccessAdvice(input, NOW).inConversationWithoutAccess).toEqual([]);
  });

  it('does not flag an entity that already has a grant, resolved via person_id', () => {
    const input = baseInput({
      interactions: [
        { entity_id: 'e1', at: new Date(NOW.getTime() - 5 * DAY).toISOString(), direction: 'out' },
        { entity_id: 'e1', at: new Date(NOW.getTime() - 3 * DAY).toISOString(), direction: 'in' },
      ],
      people: [{ id: 'p1', entity_id: 'e1', email: 'investor@fund.com' }],
      grants: [{ person_id: 'p1', nda_required: false }],
    });
    expect(vaultAccessAdvice(input, NOW).inConversationWithoutAccess).toEqual([]);
  });

  it('does not flag an entity that already has a grant, resolved via email (invited, no person_id yet)', () => {
    const input = baseInput({
      interactions: [
        { entity_id: 'e1', at: new Date(NOW.getTime() - 5 * DAY).toISOString(), direction: 'out' },
        { entity_id: 'e1', at: new Date(NOW.getTime() - 3 * DAY).toISOString(), direction: 'in' },
      ],
      people: [{ id: 'p1', entity_id: 'e1', email: 'Investor@Fund.com' }],
      grants: [{ email: 'investor@fund.com', nda_required: false }],
    });
    expect(vaultAccessAdvice(input, NOW).inConversationWithoutAccess).toEqual([]);
  });
});

describe('vaultAccessAdvice — hasNoNdaProtectedDocuments', () => {
  it('is false when the org has zero grants at all', () => {
    expect(vaultAccessAdvice(baseInput({ grants: [] }), NOW).hasNoNdaProtectedDocuments).toBe(false);
  });

  it('is true when the org has grants but none require an NDA', () => {
    const input = baseInput({ grants: [{ person_id: 'p1', nda_required: false }, { email: 'a@b.com', nda_required: false }] });
    expect(vaultAccessAdvice(input, NOW).hasNoNdaProtectedDocuments).toBe(true);
  });

  it('is false when at least one grant requires an NDA', () => {
    const input = baseInput({ grants: [{ person_id: 'p1', nda_required: false }, { email: 'a@b.com', nda_required: true }] });
    expect(vaultAccessAdvice(input, NOW).hasNoNdaProtectedDocuments).toBe(false);
  });
});
