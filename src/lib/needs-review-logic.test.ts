import { describe, expect, it } from 'vitest';
import { classifyMechanically, decideAutoApply, looksLikeMetadataCard, parseMetadataCard } from './needs-review-logic';
import type { Interaction } from './types';

function interaction(overrides: Partial<Interaction> & Pick<Interaction, 'id' | 'entity_id' | 'direction' | 'occurred_at'>): Interaction {
  return { channel: 'email', content: '', ...overrides };
}

describe('looksLikeMetadataCard', () => {
  it('detects an email + phone + source url contact card', () => {
    expect(looksLikeMetadataCard('Email: geral@fundo.pt / Telefone: 21 000 0000 / Endereço: Rua X / De https://fundo.pt/contacto')).toBe(true);
  });

  it('detects email + phone alone (no address/url needed)', () => {
    expect(looksLikeMetadataCard('Email: x@y.com / Telefone: 912345678')).toBe(true);
  });

  it('rejects ordinary outreach prose that merely mentions an email', () => {
    expect(looksLikeMetadataCard('Obrigado pelo interesse, o meu email é joao@fundo.pt, vamos agendar uma reunião.')).toBe(false);
  });

  it('rejects text with no email at all', () => {
    expect(looksLikeMetadataCard('Reunião marcada para dia 5.')).toBe(false);
  });
});

describe('parseMetadataCard', () => {
  it('extracts email, domain, phone, address, and website', () => {
    const parsed = parseMetadataCard('Email: geral@fundo.pt / Telefone: 21 000 0000 / Endereço: Rua X, Lisboa / De https://fundo.pt/contacto');
    expect(parsed.email).toBe('geral@fundo.pt');
    expect(parsed.emailDomain).toBe('fundo.pt');
    expect(parsed.telefone).toBe('21 000 0000');
    expect(parsed.endereco).toBe('Rua X, Lisboa');
    expect(parsed.website).toBe('https://fundo.pt/contacto');
  });

  it('drops a linkedin.com source url as a bogus site, same filter as the .md import', () => {
    const parsed = parseMetadataCard('Email: x@y.com / Telefone: 912345678 / De https://www.linkedin.com/in/someone');
    expect(parsed.website).toBeUndefined();
  });

  it('still returns the email/phone even when there is no website at all', () => {
    const parsed = parseMetadataCard('Email: x@y.com / Telefone: 912345678');
    expect(parsed.email).toBe('x@y.com');
    expect(parsed.website).toBeUndefined();
  });
});

describe('classifyMechanically', () => {
  it('resolves an outbound message with no reply anywhere after it as awaiting/high', () => {
    const target = interaction({ id: 'i1', entity_id: 'e1', direction: 'out', occurred_at: '2024-01-01' });
    const thread = [target, interaction({ id: 'i2', entity_id: 'e1', direction: 'out', occurred_at: '2024-01-15' })];
    const result = classifyMechanically(target, thread);
    expect(result?.classification).toBe('awaiting');
    expect(result?.confidence).toBe('high');
  });

  it('refuses to resolve an outbound message that a later reply answered', () => {
    const target = interaction({ id: 'i1', entity_id: 'e1', direction: 'out', occurred_at: '2024-01-01' });
    const thread = [target, interaction({ id: 'i2', entity_id: 'e1', direction: 'in', occurred_at: '2024-01-10' })];
    expect(classifyMechanically(target, thread)).toBeNull();
  });

  it('never resolves an inbound message deterministically', () => {
    const target = interaction({ id: 'i1', entity_id: 'e1', direction: 'in', occurred_at: '2024-01-01' });
    expect(classifyMechanically(target, [target])).toBeNull();
  });
});

describe('decideAutoApply', () => {
  it('auto-applies a high-confidence metadata_card proposal with a real parsed field', () => {
    const p = { interactionId: 'i1', kind: 'metadata_card' as const, confidence: 'high' as const, reason: '' };
    expect(decideAutoApply(p, { emailDomain: 'fundo.pt' })).toBe('metadata');
  });

  it('queues a high-confidence metadata_card claim the regex could not back up', () => {
    const p = { interactionId: 'i1', kind: 'metadata_card' as const, confidence: 'high' as const, reason: '' };
    expect(decideAutoApply(p, {})).toBe('queue');
  });

  it('auto-applies a high-confidence interaction classification', () => {
    const p = { interactionId: 'i1', kind: 'interaction' as const, confidence: 'high' as const, proposedClassification: 'pass' as const, reason: '' };
    expect(decideAutoApply(p)).toBe('classify');
  });

  it('queues a low-confidence interaction proposal', () => {
    const p = { interactionId: 'i1', kind: 'interaction' as const, confidence: 'low' as const, proposedClassification: 'pass' as const, reason: '' };
    expect(decideAutoApply(p)).toBe('queue');
  });

  it('queues a high-confidence interaction proposal that gave no classification', () => {
    const p = { interactionId: 'i1', kind: 'interaction' as const, confidence: 'high' as const, reason: '' };
    expect(decideAutoApply(p)).toBe('queue');
  });
});
