// Prompt 416 — "the +Set reopen trigger box (Vega Ventures, passed 8 years
// ago) reads like Sherlock's own answer to 'why reopen', but it's only the
// founder's free text." Prompt 414 §3 already made nextBestAction() honest
// when there's no signal (relationship.ts's "Sherlock hasn't found a
// structural reason to reopen this yet" copy); this is what fills that
// gap — an engine that actively watches for what changed about a passed/
// parked investor and says so, with a suggested path back in.
//
// A SECOND source, never a replacement: the existing reawakeningProposals
// queue (rejection_code-matched, deterministic) stays authoritative when it
// has something — reopenSignal() below defers to it (see the check inside).
// A third, tempting layer — inferring "the pass reason no longer applies"
// from a bare pass_reason_category — was considered and deliberately NOT
// built: a category alone doesn't say what threshold was missing (unlike a
// rejection_code, which has an explicit required_level), so inferring from
// it would be guessing dressed up as detection — the same principle BARS
// already established ("unverified ≠ problem found").
//
// §C — no UI reads this yet (next prompt, same 411→412 two-wave pattern).
//
// Why `db` here isn't types.ts's own Db: entityReopenSnapshots and
// reawakeningProposals ARE real Db fields (this engine reads them off the
// real thing) — but investor_investments/market_companies are platform-
// wide reference tables Db doesn't carry, and "is this catalog entity
// claimed" sits behind investor_entity_claims' claimant-scoped RLS, so a
// founder's own client session can't read it row-by-row (see
// claimed-investor-profile.ts, the existing service-role reader for
// exactly that question, and migration 0262's catalog_entity_claimed_at()
// RPC, the safe derived-fact alternative). ReopenSignalsDb extends the real
// Db with the extra platform-wide arrays; whatever wires this to a real UI
// assembles them (most likely a dedicated route using service-role for the
// investment/claim side, merged onto the founder's own useStore().db).
import type { Db, Entity, EntityReopenSnapshot } from './types';
import { effectiveMode, nextContactPerson } from './relationship';
import { preflight, preflightSummary } from './rules';

export interface ReopenInvestment {
  companyName: string;
  sectors: string[];
  investedAt: string; // ISO date
}

export interface ReopenSignalsDb extends Db {
  // catalog_deliveries — this org's entity_id -> its catalog counterpart's
  // id, when a delivery record exists (manual entities may have none).
  catalogDeliveries: { entity_id: string; catalog_id: string }[];
  // investor_investments, joined with market_companies for citation.
  // investorCatalogId is investor_investments.investor_entity_id.
  investorInvestments: { investorCatalogId: string; companyName: string; sectors: string[]; investedAt: string }[];
  // investor_entity_claims, approved only — never the claimant identity,
  // exactly what catalog_entity_claimed_at() itself refuses to expose.
  approvedClaims: { catalogId: string; approvedAt: string }[];
  // catalog_entities' CURRENT sectors/stage, keyed by catalog id — only
  // needs to carry the entities actually being checked, not the whole table.
  catalogCurrent: { catalogId: string; sectors: string[]; stageMin: string | null; stageMax: string | null }[];
}

function resolveCatalogId(entityId: string, db: ReopenSignalsDb): string | undefined {
  return db.catalogDeliveries.find((d) => d.entity_id === entityId)?.catalog_id;
}

// Prompt 421 §C.3 — investor_declared_investments (an investor's own
// self-reported history, Import tab) complements investor_investments
// (market-researched, migration 0201) — never replaces it. Both feed
// db.investorInvestments identically once mapped through this: whichever
// caller eventually wires reopen-signals.ts to a real UI (deferred by
// Prompt 416 itself, "no UI this wave") merges both sources through this
// same shape rather than newInvestmentsSince needing to know there are two
// origins. sector (singular, nullable) becomes a 1-item or empty array —
// the declared-investment form only ever collects one.
export function declaredInvestmentToReopenRecord(row: {
  catalog_entity_id: string; company_name: string; sector: string | null; invested_at: string | null;
}): { investorCatalogId: string; companyName: string; sectors: string[]; investedAt: string } | null {
  if (!row.invested_at) return null; // no date on record — nothing to compare against sinceDate
  return {
    investorCatalogId: row.catalog_entity_id, companyName: row.company_name,
    sectors: row.sector ? [row.sector] : [], investedAt: row.invested_at,
  };
}

// §B.1 — doesn't need entity_reopen_snapshots at all: works even for a
// pass from years before this table existed (the Vega Ventures case).
export function newInvestmentsSince(entity: Entity, db: ReopenSignalsDb, sinceDate: string): ReopenInvestment[] {
  const catalogId = resolveCatalogId(entity.id, db);
  if (!catalogId) return [];
  return db.investorInvestments
    .filter((inv) => inv.investorCatalogId === catalogId && inv.investedAt > sinceDate)
    .map(({ companyName, sectors, investedAt }) => ({ companyName, sectors, investedAt }))
    .sort((a, b) => b.investedAt.localeCompare(a.investedAt));
}

// §B.2 — same "no snapshot needed" property as above. Returns the approval
// date (not a boolean) so reopenSignal can cite it and compare it to
// sinceDate in one read.
export function claimedProfileSince(entity: Entity, db: ReopenSignalsDb, sinceDate: string): string | null {
  const catalogId = resolveCatalogId(entity.id, db);
  if (!catalogId) return null;
  const claim = db.approvedClaims.find((c) => c.catalogId === catalogId && c.approvedAt > sinceDate);
  return claim?.approvedAt ?? null;
}

export interface CatalogFieldChange { field: 'sectors' | 'stage'; from: string; to: string }

// §B.3 — the only one of the three that needs a snapshot, and only ever
// reports fields that actually differ — no snapshot, no live catalog match
// today, or nothing changed all return an empty list, never an invented one.
export function catalogDriftSince(entity: Entity, db: ReopenSignalsDb, snapshot: EntityReopenSnapshot | undefined): CatalogFieldChange[] {
  if (!snapshot) return [];
  const catalogId = resolveCatalogId(entity.id, db);
  if (!catalogId) return [];
  const current = db.catalogCurrent.find((c) => c.catalogId === catalogId);
  if (!current) return [];

  const changes: CatalogFieldChange[] = [];
  const prevSectors = [...snapshot.sectors_at_time].sort().join(', ');
  const nowSectors = [...current.sectors].sort().join(', ');
  if (prevSectors !== nowSectors) {
    changes.push({ field: 'sectors', from: prevSectors || '(none on file)', to: nowSectors || '(none on file)' });
  }
  const prevMin = snapshot.stage_min_at_time ?? null;
  const prevMax = snapshot.stage_max_at_time ?? null;
  if (prevMin !== current.stageMin || prevMax !== current.stageMax) {
    const fmt = (min: string | null, max: string | null) => (min || max ? `${min ?? '?'}–${max ?? '?'}` : '(none on file)');
    changes.push({ field: 'stage', from: fmt(prevMin, prevMax), to: fmt(current.stageMin, current.stageMax) });
  }
  return changes;
}

export type ReopenSignalTier = 'investment' | 'claim' | 'drift' | 'none';

export interface ReopenSignal {
  tier: ReopenSignalTier;
  detail: string;
  since: string; // ISO — the pass/park date this signal is measured from
  lowConfidenceNudge?: true;
}

const LOW_CONFIDENCE_NUDGE_DAYS = 90;

// The date §B.4 measures "since" from: the classified-pass interaction's
// date when one exists (mirrors nextBestAction's own lastPass in
// relationship.ts), else dormant_since (a park with no formal pass).
function sinceDateFor(entity: Entity, db: Db): string | undefined {
  const lastPass = db.interactions
    .filter((i) => i.entity_id === entity.id && i.direction === 'in' && i.classification === 'pass')
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  return lastPass?.occurred_at ?? entity.dormant_since;
}

// §B.4 — investment > claim > drift > none, by priority. null when the
// entity isn't parked/closed (or is 'invested' — already a closed WIN,
// nothing to "reopen"), when the existing rejection-code-matched
// reawakeningProposals queue already has something pending (that queue is
// the FIRST source and never gets contradicted by this second one), or
// when there's no since-date to measure from at all.
export function reopenSignal(entity: Entity, db: ReopenSignalsDb, now: Date = new Date()): ReopenSignal | null {
  if (entity.status === 'invested') return null;
  const mode = effectiveMode(db, entity.id);
  if (mode !== 'parked' && mode !== 'closed') return null;

  const hasExistingProposal = db.reawakeningProposals.some(
    (p) => p.entity_id === entity.id && p.status === 'pending' && p.reopens && p.rejection_code_id,
  );
  if (hasExistingProposal) return null;

  const since = sinceDateFor(entity, db);
  if (!since) return null;

  const investments = newInvestmentsSince(entity, db, since);
  if (investments.length > 0) {
    const top = investments[0];
    const sectorNote = top.sectors[0] ? ` (${top.sectors[0]})` : '';
    return { tier: 'investment', detail: `Invested in ${top.companyName}${sectorNote} on ${top.investedAt.slice(0, 10)}.`, since };
  }

  const claimedAt = claimedProfileSince(entity, db, since);
  if (claimedAt) {
    return { tier: 'claim', detail: `Claimed their profile on ${claimedAt.slice(0, 10)} — the contact and thesis on file are now investor-confirmed.`, since };
  }

  const snapshot = db.entityReopenSnapshots
    .filter((s) => s.entity_id === entity.id)
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0];
  const drift = catalogDriftSince(entity, db, snapshot);
  if (drift.length > 0) {
    const detail = drift.map((d) => `${d.field} ${d.from} → ${d.to}`).join('; ');
    return { tier: 'drift', detail: `Their profile changed — ${detail}.`, since };
  }

  const daysSince = Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000);
  if (daysSince >= LOW_CONFIDENCE_NUDGE_DAYS) {
    const months = Math.round(daysSince / 30);
    return {
      tier: 'none',
      detail: `${months} month${months === 1 ? '' : 's'} since — no specific new information, but worth a fresh look.`,
      since,
      lowConfidenceNudge: true,
    };
  }
  return null;
}

export interface SuggestedReapproach {
  personId?: string;
  personName?: string;
  preflightGreen: boolean;
  // Set only when the live signal is an 'investment' — the data point to
  // open with, same spirit as "line 1 is the hook, specific and true".
  // This never drafts the message itself, only points at the fact.
  openingHook?: string;
}

// §B.5 — reuses nextContactPerson + preflightSummary(preflight(...))
// exactly as the existing "Ready for first contact" advice does (same
// contact-order doctrine, not a new judgment call) to say WHO and whether
// pre-flight is already green.
export function suggestedReapproach(entity: Entity, db: ReopenSignalsDb, now: Date = new Date()): SuggestedReapproach {
  const person = nextContactPerson(db, entity.id);
  const preflightGreen = person ? preflightSummary(preflight(db, person, null)).green : false;
  const signal = reopenSignal(entity, db, now);
  return {
    personId: person?.id,
    personName: person?.full_name,
    preflightGreen,
    openingHook: signal?.tier === 'investment' ? signal.detail : undefined,
  };
}
