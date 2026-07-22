// IRM_SPEC §8a — AI outreach composer context builder. Pure function, shared
// between client (assembles the context to POST) and server (re-derives the
// same shape for the lint check) — mirrors the relationship.ts pattern.
import type { Channel, Db } from './types';
import { LINKEDIN_DM_MAX, LOCK_DAYS, outboundCounts } from './rules';
import { relationshipSummary } from './relationship';

export type ComposerIntent = 'first_touch' | 'follow_up' | 'reply' | 'meeting_ask';

export const INTENT_LABEL: Record<ComposerIntent, string> = {
  first_touch: 'First touch', follow_up: 'Follow-up', reply: 'Reply', meeting_ask: 'Meeting ask',
};

export interface ComposerContext {
  startup: {
    name: string; sector?: string; stage?: string; roundTargetEur?: number;
    country?: string; oneLiner?: string;
  };
  investor: {
    entityName: string; entityType: string; thesis?: string; ourAngle?: string; theAsk?: string;
    checkMinEur?: number; checkMaxEur?: number; sectors: string[]; submissionChannel?: string;
  };
  person: {
    fullName: string; role?: string; hook?: string; killWords: string[]; watchOuts?: string;
    preferredLanguage: 'en' | 'pt';
  };
  relationship: {
    stage: string; whoseTurn: string; daysSinceLastTouch?: number; touchCount: number;
    firstContactAt?: string; lastTouchAt?: string;
    priorThread: { direction: string; channel: string; occurredAt: string; snippet: string }[];
  };
  constraints: {
    dailyCap: number; weeklyCap: number; todayCount: number; weekCount: number;
    linkedinMax: number; lockDays: number; locked: boolean; lockUntil?: string;
    thirdUnansweredRisk: boolean;
  };
}

export function pickIntent(db: Db, entityId: string): ComposerIntent {
  const s = relationshipSummary(db, entityId);
  if (s.touchCount === 0) return 'first_touch';
  if (s.whoseTurn === 'us') return 'reply';
  if (s.stage === 'meeting') return 'meeting_ask';
  return 'follow_up';
}

export function buildComposerContext(db: Db, entityId: string, personId: string, channel: Channel): ComposerContext {
  const entity = db.entities.find((e) => e.id === entityId);
  const person = db.people.find((p) => p.id === personId);
  const s = relationshipSummary(db, entityId);
  const caps = outboundCounts(db);
  const locked = !!(entity?.contact_lock_until && new Date(entity.contact_lock_until) > new Date());

  const priorThread = db.interactions
    .filter((i) => i.entity_id === entityId && i.channel !== 'stage_change')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, 5)
    .map((i) => ({
      direction: i.direction, channel: i.channel, occurredAt: i.occurred_at,
      snippet: i.content.slice(0, 200),
    }));

  const outsToPerson = db.interactions.filter((i) => i.person_id === personId && i.direction === 'out').length;
  const insFromPerson = db.interactions.filter((i) => i.person_id === personId && i.direction === 'in').length;

  return {
    startup: {
      name: db.org.name, sector: db.org.sector, stage: db.org.stage,
      roundTargetEur: db.org.round_target_eur, country: db.org.country, oneLiner: db.org.one_liner,
    },
    investor: {
      entityName: entity?.name ?? '', entityType: entity?.type ?? '', thesis: entity?.thesis,
      ourAngle: entity?.our_angle, theAsk: entity?.the_ask, checkMinEur: entity?.check_min_eur,
      checkMaxEur: entity?.check_max_eur, sectors: entity?.sectors ?? [], submissionChannel: entity?.submission_channel,
    },
    person: {
      fullName: person?.full_name ?? '', role: person?.role, hook: person?.hook,
      killWords: person?.kill_words ?? [], watchOuts: person?.watch_outs,
      preferredLanguage: person?.preferred_language ?? 'en',
    },
    relationship: {
      stage: s.stage, whoseTurn: s.whoseTurn, daysSinceLastTouch: s.daysSinceLastTouch,
      touchCount: s.touchCount, firstContactAt: s.firstContactAt, lastTouchAt: s.lastTouchAt, priorThread,
    },
    constraints: {
      dailyCap: caps.dailyCap, weeklyCap: caps.weeklyCap, todayCount: caps.today, weekCount: caps.week,
      linkedinMax: LINKEDIN_DM_MAX, lockDays: LOCK_DAYS, locked, lockUntil: entity?.contact_lock_until,
      thirdUnansweredRisk: outsToPerson >= 2 && insFromPerson === 0,
    },
  };
}
