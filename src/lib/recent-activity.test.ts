// Prompt 884 — Recent activity feed assembly.
import { describe, expect, it } from 'vitest';
import { buildRecentActivity, formatActivityTime, PIPELINE_ADD_NOTE_CONTENT } from './recent-activity';
import type { CompanyFact, Db, Entity, Interaction } from './types';

function entity(id: string, name: string): Entity {
  return {
    id, name, type: 'vc', invests_in_geographies: [], sectors: [], website_verified: false, email_domain_verified: false,
    submission_channel_type: 'unknown', hard_filter_status: 'not_applicable', status: 'not_contacted', source: 'catalog',
  };
}
function interaction(over: Partial<Interaction> & { id: string; entity_id: string }): Interaction {
  return { occurred_at: '2026-08-01T00:00:00.000Z', direction: 'out', channel: 'email', content: 'x', ...over };
}
function fact(over: Partial<CompanyFact> & { id: string }): CompanyFact {
  return { category: 'traction', statement: 'x', status: 'confirmed', source: 'user', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z', ...over };
}

describe('buildRecentActivity', () => {
  const db: Pick<Db, 'entities' | 'interactions' | 'companyFacts'> = {
    entities: [entity('e1', 'Acme Ventures')],
    interactions: [
      interaction({ id: 'i-meeting', entity_id: 'e1', channel: 'meeting', occurred_at: '2026-08-05T10:00:00.000Z' }),
      interaction({ id: 'i-reply', entity_id: 'e1', channel: 'email', direction: 'out', occurred_at: '2026-08-04T10:00:00.000Z' }),
      interaction({ id: 'i-inbound', entity_id: 'e1', channel: 'email', direction: 'in', occurred_at: '2026-08-03T10:00:00.000Z' }),
      interaction({ id: 'i-added', entity_id: 'e1', channel: 'stage_change', content: PIPELINE_ADD_NOTE_CONTENT, occurred_at: '2026-08-01T10:00:00.000Z' }),
      interaction({ id: 'i-other-note', entity_id: 'e1', channel: 'stage_change', content: 'Dismissed — parked by choice.', occurred_at: '2026-08-02T10:00:00.000Z' }),
    ],
    companyFacts: [fact({ id: 'f1', category: 'traction', updated_at: '2026-08-06T10:00:00.000Z' })],
  };

  it('produces one event per meeting/reply/pipeline-add, and skips inbound + non-marker stage_change notes', () => {
    const events = buildRecentActivity(db);
    expect(events.map((e) => e.id)).toEqual(['f:f1', 'i:i-meeting', 'i:i-reply', 'i:i-added']);
  });

  it('labels each event type correctly', () => {
    const events = buildRecentActivity(db);
    const byId = Object.fromEntries(events.map((e) => [e.id, e.label]));
    expect(byId['i:i-meeting']).toBe('Meeting completed with Acme Ventures');
    expect(byId['i:i-reply']).toBe('Replied to Acme Ventures');
    expect(byId['i:i-added']).toBe('Added Acme Ventures to pipeline');
    expect(byId['f:f1']).toBe('Updated company fact: traction');
  });

  it('sorts newest first', () => {
    const events = buildRecentActivity(db);
    const times = events.map((e) => e.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});

describe('formatActivityTime', () => {
  const NOW = new Date('2026-08-11T15:00:00.000Z');
  it('today -> "Today, <time>"', () => {
    expect(formatActivityTime('2026-08-11T09:00:00.000Z', NOW)).toMatch(/^Today, /);
  });
  it('yesterday -> "Yesterday"', () => {
    expect(formatActivityTime('2026-08-10T09:00:00.000Z', NOW)).toBe('Yesterday');
  });
  it('older -> a short date', () => {
    expect(formatActivityTime('2026-08-01T09:00:00.000Z', NOW)).toBe('Aug 1');
  });
});
