import { describe, expect, it } from 'vitest';
import {
  classifyFragment, classifyMechanically, decideAutoApply, invertTriageAction, isPlaceholderDate,
  looksLikeMetadataCard, mergeCandidates, mergeFragmentIntoTarget, parseMetadataCard, parsePersonHint, suggestDateFromContent,
  type TriageAction,
} from './needs-review-logic';
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

describe('suggestDateFromContent (PT month names)', () => {
  it('parses the Alantra case "25 de maio de 2022"', () => {
    expect(suggestDateFromContent('Reunião remota a 25 de maio de 2022 com a equipa.')).toBe('2022-05-25');
  });

  it('parses "1 de janeiro de 2020"', () => {
    expect(suggestDateFromContent('Enviado a 1 de janeiro de 2020.')).toBe('2020-01-01');
  });

  it('handles "março" with the diacritic', () => {
    expect(suggestDateFromContent('12 de março de 2021')).toBe('2021-03-12');
  });

  it('parses month + year with no day, defaulting to the 1st', () => {
    expect(suggestDateFromContent('Falámos algures em maio de 2022.')).toBe('2022-05-01');
  });

  it('parses a numeric DD/MM/YYYY date', () => {
    expect(suggestDateFromContent('data: 25/05/2022')).toBe('2022-05-25');
  });

  it('parses an ISO date already present', () => {
    expect(suggestDateFromContent('logged 2022-05-25 by hand')).toBe('2022-05-25');
  });

  it('returns undefined when there is no parseable date', () => {
    expect(suggestDateFromContent('sem qualquer data mencionada aqui')).toBeUndefined();
  });
});

describe('isPlaceholderDate', () => {
  it('recognizes the 2018-01-01 import placeholder', () => {
    expect(isPlaceholderDate('2018-01-01T00:00:00.000Z')).toBe(true);
  });

  it('is false for a real date', () => {
    expect(isPlaceholderDate('2022-05-25T12:00:00.000Z')).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isPlaceholderDate(undefined)).toBe(false);
  });
});

describe('parsePersonHint', () => {
  it('derives name and email from "merce.tell@rocagroupventures.com"', () => {
    const hint = parsePersonHint('Falei com a Merce (merce.tell@rocagroupventures.com) sobre o dossier.');
    expect(hint.email).toBe('merce.tell@rocagroupventures.com');
    expect(hint.name).toBe('Merce Tell');
  });

  it('returns email but no derived name when the local part has no separator', () => {
    const hint = parsePersonHint('contacto: merce@roca.com');
    expect(hint.email).toBe('merce@roca.com');
    expect(hint.name).toBeUndefined();
  });

  it('returns nothing when there is no email', () => {
    expect(parsePersonHint('sem email no texto')).toEqual({ name: undefined, email: undefined });
  });
});

describe('invertTriageAction', () => {
  it('inverts an interaction edit by re-applying the prior fields', () => {
    const action: TriageAction = { type: 'editInteraction', interactionId: 'i1', prev: { occurred_at: '2018-01-01T00:00:00.000Z', classification: undefined, needs_review: true } };
    expect(invertTriageAction(action)).toEqual([
      { kind: 'updateInteraction', id: 'i1', patch: { occurred_at: '2018-01-01T00:00:00.000Z', classification: undefined, needs_review: true } },
    ]);
  });

  it('inverts a person route by unlinking each interaction then removing the person', () => {
    const action: TriageAction = {
      type: 'routePerson', personId: 'p1',
      links: [{ interactionId: 'i1', prevPersonId: undefined }, { interactionId: 'i2', prevPersonId: 'p-old' }],
    };
    expect(invertTriageAction(action)).toEqual([
      { kind: 'updateInteraction', id: 'i1', patch: { person_id: undefined } },
      { kind: 'updateInteraction', id: 'i2', patch: { person_id: 'p-old' } },
      { kind: 'removePerson', id: 'p1' },
    ]);
  });

  it('inverts an entity-data route by restoring entity fields and re-flagging the item', () => {
    const action: TriageAction = {
      type: 'routeEntityData', entityId: 'e1', interactionId: 'i1',
      prevEntity: { email: undefined, phone: undefined, notes: undefined }, prevNeedsReview: true,
    };
    expect(invertTriageAction(action)).toEqual([
      { kind: 'updateEntity', id: 'e1', patch: { email: undefined, phone: undefined, notes: undefined } },
      { kind: 'updateInteraction', id: 'i1', patch: { needs_review: true } },
    ]);
  });

  it('inverts an added interaction by removing it', () => {
    const action: TriageAction = { type: 'addInteraction', interactionId: 'i-new' };
    expect(invertTriageAction(action)).toEqual([{ kind: 'removeInteraction', id: 'i-new' }]);
  });
});

describe('classifyFragment — Prompt 371 §3b', () => {
  it('a bare "HH:MM" is a time fragment (the reported "13:18" case)', () => {
    expect(classifyFragment('13:18')).toBe('time');
    expect(classifyFragment(' 9:05 ')).toBe('time');
  });

  it('an "HHhMM" reading is also a time fragment', () => {
    expect(classifyFragment('13h18')).toBe('time');
  });

  it('a bare date is a date fragment', () => {
    expect(classifyFragment('25 de maio de 2022')).toBe('date');
  });

  it('ordinary prose mentioning a date is text, not a bare date fragment', () => {
    expect(classifyFragment('Falámos a 25 de maio de 2022 sobre o pitch e o founder ficou de enviar o deck atualizado.')).toBe('text');
  });

  it('a name or short note is text', () => {
    expect(classifyFragment('Duarte Mineiro')).toBe('text');
  });
});

describe('mergeFragmentIntoTarget — Prompt 371 §3b', () => {
  it('a time fragment overwrites the target time, preserving its day', () => {
    const fragment = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: '13:18' });
    const target = interaction({ id: 'target', entity_id: 'e1', direction: 'in', occurred_at: '2018-12-21T09:00:00.000Z', content: 'Atendeu Pedro Santos.' });
    const result = mergeFragmentIntoTarget(fragment, target);
    expect(result.targetPatch).toEqual({ occurred_at: '2018-12-21T13:18:00.000Z' });
  });

  it('a date fragment corrects the target date', () => {
    const fragment = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: '25 de maio de 2022' });
    const target = interaction({ id: 'target', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: 'Reunião remota.' });
    expect(mergeFragmentIntoTarget(fragment, target).targetPatch).toEqual({ occurred_at: '2022-05-25T12:00:00.000Z' });
  });

  it('plain text is appended to the target content with " / "', () => {
    const fragment = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: 'fiquei de enviar pitch ao cuidado de duarte mineiro' });
    const target = interaction({ id: 'target', entity_id: 'e1', direction: 'in', occurred_at: '2018-12-21T09:00:00.000Z', content: 'Atendeu pedro santos' });
    expect(mergeFragmentIntoTarget(fragment, target).targetPatch).toEqual({ content: 'Atendeu pedro santos / fiquei de enviar pitch ao cuidado de duarte mineiro' });
  });

  it('appending to an empty target content does not leave a stray separator', () => {
    const fragment = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: 'Duarte Mineiro' });
    const target = interaction({ id: 'target', entity_id: 'e1', direction: 'in', occurred_at: '2018-12-21T09:00:00.000Z', content: '' });
    expect(mergeFragmentIntoTarget(fragment, target).targetPatch).toEqual({ content: 'Duarte Mineiro' });
  });
});

describe('mergeCandidates', () => {
  it('excludes the fragment itself and stage_change rows, sorted most-recent-first', () => {
    const frag = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: '13:18' });
    const older = interaction({ id: 'older', entity_id: 'e1', direction: 'in', occurred_at: '2018-06-01T00:00:00.000Z', content: 'older note' });
    const newer = interaction({ id: 'newer', entity_id: 'e1', direction: 'in', occurred_at: '2018-12-21T09:00:00.000Z', content: 'Atendeu pedro santos' });
    const stageChange = interaction({ id: 'sc', entity_id: 'e1', direction: 'in', occurred_at: '2019-01-01T00:00:00.000Z', channel: 'stage_change', content: 'Stage changed to Engaged.' });
    const result = mergeCandidates(frag, [frag, older, newer, stageChange]);
    expect(result.map((i) => i.id)).toEqual(['newer', 'older']);
  });
});

describe('invertTriageAction — mergeFragment', () => {
  it('restores the target fields and re-adds the fragment', () => {
    const fragment = interaction({ id: 'frag', entity_id: 'e1', direction: 'in', occurred_at: '2018-01-01T00:00:00.000Z', content: '13:18', needs_review: true });
    const action: TriageAction = { type: 'mergeFragment', fragment, targetId: 'target', prevTargetPatch: { occurred_at: '2018-12-21T09:00:00.000Z' } };
    expect(invertTriageAction(action)).toEqual([
      { kind: 'updateInteraction', id: 'target', patch: { occurred_at: '2018-12-21T09:00:00.000Z' } },
      { kind: 'restoreInteraction', interaction: fragment },
    ]);
  });
});
