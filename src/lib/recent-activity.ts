// Prompt 884 — Recent activity feed: real events built from data that
// already exists (interactions, company_facts), never a new event-logging
// system. Four event types, chosen and scoped exactly as the prompt asked:
//
// - "Meeting completed with X" — an interaction logged with channel
//   'meeting' (the ONLY way one is created, per this same prompt's "Add
//   meeting summary" flow — see MeetingsCard.tsx / entities/[id]/page.tsx).
// - "Replied to X" — any other outbound interaction (excluding the
//   'stage_change' channel, which is this codebase's internal system-note
//   channel, not a real outreach touch — see logSystemNote in
//   store-supabase.tsx).
// - "Added X to pipeline" — deliverCatalogMatches() (catalog-delivery-
//   core.ts) now writes a marker interactions row (channel: 'stage_change',
//   content === PIPELINE_ADD_NOTE_CONTENT) right after creating the entity;
//   this is the only stage_change content this feed recognises, so every
//   OTHER stage_change note (park/dismiss/dormant confirm-decline, all of
//   which are internal decisions, not "activity" the founder did today) is
//   correctly left out rather than mis-labelled.
// - "Updated note for X" — the prompt's own literal ask (wire this off
//   addCompanyFact()) is architecturally impossible: CompanyFact has no
//   entity_id at all (org-wide, not per-entity — checked types.ts and both
//   store-supabase.tsx/store-demo.tsx's addCompanyFact implementations), and
//   interactions.entity_id is NOT NULL. So this reads company_facts
//   directly instead, labelled without an entity name ("Updated company
//   fact: {category}") — a real event, just not entity-scoped the way the
//   prompt assumed. Documented in DECISIONS.md.
//
// "Marked X as warm" does NOT exist as a feature anywhere in this codebase
// (checked pipeline-temperature.ts — Prompt 660's work computes temperature
// live from days-since-touch, nothing is ever "marked") and is deliberately
// left out of v1, per this prompt's own explicit instruction not to build a
// temperature-tagging feature just to populate this feed.
import type { CompanyFact, Db } from './types';

export const PIPELINE_ADD_NOTE_CONTENT = 'Added to your pipeline via a Sherlock catalog match.';

export type RecentActivityType = 'meeting_completed' | 'replied' | 'added_to_pipeline' | 'note_updated';

export interface RecentActivityEvent {
  id: string;
  type: RecentActivityType;
  label: string;
  entityId?: string;
  occurredAt: string;
}

function entityName(db: Pick<Db, 'entities'>, entityId?: string): string {
  return (entityId && db.entities.find((e) => e.id === entityId)?.name) || 'an investor';
}

function companyFactLabel(f: CompanyFact): string {
  return `Updated company fact: ${f.category}`;
}

export function buildRecentActivity(db: Pick<Db, 'entities' | 'interactions' | 'companyFacts'>): RecentActivityEvent[] {
  const events: RecentActivityEvent[] = [];

  for (const i of db.interactions) {
    if (i.channel === 'meeting') {
      events.push({ id: `i:${i.id}`, type: 'meeting_completed', label: `Meeting completed with ${entityName(db, i.entity_id)}`, entityId: i.entity_id, occurredAt: i.occurred_at });
    } else if (i.channel === 'stage_change') {
      if (i.content === PIPELINE_ADD_NOTE_CONTENT) {
        events.push({ id: `i:${i.id}`, type: 'added_to_pipeline', label: `Added ${entityName(db, i.entity_id)} to pipeline`, entityId: i.entity_id, occurredAt: i.occurred_at });
      }
      // every other stage_change note is an internal system decision
      // (park/dismiss/dormant confirm-decline) — not an "activity" event.
    } else if (i.direction === 'out') {
      events.push({ id: `i:${i.id}`, type: 'replied', label: `Replied to ${entityName(db, i.entity_id)}`, entityId: i.entity_id, occurredAt: i.occurred_at });
    }
  }

  for (const f of db.companyFacts) {
    events.push({ id: `f:${f.id}`, type: 'note_updated', label: companyFactLabel(f), occurredAt: f.updated_at });
  }

  return events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

export function formatActivityTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const wasYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (sameDay) return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  if (wasYesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
