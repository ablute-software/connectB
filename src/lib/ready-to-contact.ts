// Prompt 398 §2 / 400 §A.1 — the "who's ready to contact right now" logic,
// extracted out of ReadyToContactPanel.tsx's own useReadyToContact hook so
// sherlock-next.ts's pure sherlockNext(db, now) can reuse the EXACT same
// computation for its "ready to contact" priority step, instead of a second
// copy that could drift. The hook below is now a thin wrapper.
import type { Db, Person } from './types';
import { outboundCounts, preflight, preflightSummary } from './rules';

export interface ReadyToContact {
  ready: Person[];
  capReached: boolean;
  caps: ReturnType<typeof outboundCounts>;
}

// Prompt 414 (found while extracting liveOverdueEntities alongside this)
// — now was never threaded through to outboundCounts/preflight below,
// so this silently used the REAL system clock regardless of what a
// caller passed. Harmless for the interactive UI hook (which always
// wants "right now" anyway, and never passed one), but broke
// sherlockNext(db, now)'s own contract of being a pure function of BOTH
// arguments — step 5's cap check ignored its caller's now entirely.
// Confirmed live: sherlock-next.test.ts's own "5b: caps reached" test
// (hardcoded NOW = 2026-08-27) started failing the moment the real
// clock crossed that date, exactly the symptom this fix closes.
export function readyToContact(db: Db, now: Date = new Date()): ReadyToContact {
  const caps = outboundCounts(db, now);
  const capReached = caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap;
  const ready = db.people
    .filter((p) => !p.do_not_contact)
    .filter((p) => {
      const e = db.entities.find((x) => x.id === p.entity_id);
      return e && ['not_contacted', 'contacted'].includes(e.status);
    })
    .filter((p) => preflightSummary(preflight(db, p, null, now)).green)
    .sort((a, b) => {
      const ea = db.entities.find((x) => x.id === a.entity_id); const eb = db.entities.find((x) => x.id === b.entity_id);
      return (ea?.wave ?? 9) - (eb?.wave ?? 9) || a.seniority_rank - b.seniority_rank;
    });
  return { ready, capReached, caps };
}
