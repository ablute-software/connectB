// Prompt 893 §C — "learn the channel", Fase 1: MEASURE only. The engine
// (relationship.ts's recommendChannel) never sees this module — Fase 1 is
// deliberately display-only, per the spec's own instruction ("nunca
// sobrepõe 'verificado antes de não verificado'"): a founder's own reply
// rate is shown ALONGSIDE the recommendation, never used to override it.
// Fase 2 (>=10 first contacts, tie-break between equally-possible channels
// only) is explicitly NOT built here — flagged as a TODO in DECISIONS.md.
import type { Channel, Db, EntityType, Interaction } from './types';

export interface ChannelOutcome {
  channel: Channel;
  // "primeiros contactos de saída" — the number of (entity, person) pairs
  // whose FIRST-EVER outbound interaction used this channel. A follow-up
  // on the same channel to the same pair is not a second first contact.
  outboundFirstContacts: number;
  // Any inbound interaction for that same (entity, person) pair, dated
  // within 14 days (inclusive) of the first contact — never a bare "any
  // reply, ever" count, which would flatter a channel with one lucky late
  // reply months later.
  repliedWithin14d: number;
  rate: number; // repliedWithin14d / outboundFirstContacts, always in (0,1]
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Prompt 893 §C — optional slice filters for Fase 2 (segmenting by entity
// type or the contacted person's seniority rank). Fase 1 always calls this
// with no filter (org-wide), but the shape exists now so Fase 2 doesn't
// need a signature change — see this file's own header for why Fase 2's
// actual tie-break logic is deliberately NOT implemented here yet.
export interface ChannelOutcomeFilter {
  entityType?: EntityType;
  seniority?: number;
}

export function channelOutcomes(db: Db, filter?: ChannelOutcomeFilter): ChannelOutcome[] {
  // Step 1 — the first outbound interaction per (entity_id, person_id) pair.
  // person_id undefined (a general/no-specific-person send) is its own pair,
  // keyed by entity alone — a firm can have at most one "no specific person"
  // first contact, same as any other pair.
  const firstOutboundByPair = new Map<string, Interaction>();
  for (const i of db.interactions) {
    if (i.direction !== 'out') continue;
    if (i.channel === 'stage_change') continue; // not a real outreach channel
    if (filter?.entityType) {
      const entity = db.entities.find((e) => e.id === i.entity_id);
      if (entity?.type !== filter.entityType) continue;
    }
    if (filter?.seniority != null) {
      const person = i.person_id ? db.people.find((p) => p.id === i.person_id) : undefined;
      if (!person || person.seniority_rank !== filter.seniority) continue;
    }
    const key = `${i.entity_id}::${i.person_id ?? ''}`;
    const existing = firstOutboundByPair.get(key);
    if (!existing || i.occurred_at.localeCompare(existing.occurred_at) < 0) {
      firstOutboundByPair.set(key, i);
    }
  }

  // Step 2 — for each such first contact, was there a reply (any inbound
  // interaction for the SAME pair) within 14 days? "Within 14 days" is
  // inclusive of day 14 and excludes day 15 — the spec's own worked case.
  const byChannel = new Map<Channel, { total: number; replied: number }>();
  for (const [key, contact] of firstOutboundByPair) {
    const [entityId, personId] = key.split('::');
    const contactMs = new Date(contact.occurred_at).getTime();
    const replied = db.interactions.some((i) => {
      if (i.direction !== 'in') return false;
      if (i.entity_id !== entityId) return false;
      if ((i.person_id ?? '') !== personId) return false;
      const diffDays = (new Date(i.occurred_at).getTime() - contactMs) / MS_PER_DAY;
      return diffDays >= 0 && diffDays <= 14;
    });
    const bucket = byChannel.get(contact.channel) ?? { total: 0, replied: 0 };
    bucket.total += 1;
    if (replied) bucket.replied += 1;
    byChannel.set(contact.channel, bucket);
  }

  // Most-used channel first — the founder's own busiest channel is the
  // most useful comparison point, and this keeps the order stable across
  // renders (Map iteration order is insertion order, which is arbitrary
  // here otherwise).
  return [...byChannel.entries()]
    .map(([channel, { total, replied }]) => ({ channel, outboundFirstContacts: total, repliedWithin14d: replied, rate: replied / total }))
    .sort((a, b) => b.outboundFirstContacts - a.outboundFirstContacts);
}

// Prompt 893 §C — the exact display copy: "Your replies by channel:
// LinkedIn note 3/7 · Email 1/4" with zero data reading "No outcome data
// yet". A tiny formatter, kept here (not duplicated in the guide card)
// since the wording is itself part of the spec.
const CHANNEL_SHORT_LABEL: Record<Channel, string> = {
  linkedin_dm: 'LinkedIn DM', linkedin_note: 'LinkedIn note', email: 'Email', web_form: 'Web form',
  call: 'Call', meeting: 'Meeting', event: 'Event', intro: 'Intro', stage_change: 'Stage change',
};

export function channelOutcomesSummary(outcomes: ChannelOutcome[]): string {
  if (outcomes.length === 0) return 'No outcome data yet.';
  return `Your replies by channel: ${outcomes
    .map((o) => `${CHANNEL_SHORT_LABEL[o.channel]} ${o.repliedWithin14d}/${o.outboundFirstContacts}`)
    .join(' · ')}`;
}
