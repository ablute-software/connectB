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

export function readyToContact(db: Db): ReadyToContact {
  const caps = outboundCounts(db);
  const capReached = caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap;
  const ready = db.people
    .filter((p) => !p.do_not_contact)
    .filter((p) => {
      const e = db.entities.find((x) => x.id === p.entity_id);
      return e && ['not_contacted', 'contacted'].includes(e.status);
    })
    .filter((p) => preflightSummary(preflight(db, p, null)).green)
    .sort((a, b) => {
      const ea = db.entities.find((x) => x.id === a.entity_id); const eb = db.entities.find((x) => x.id === b.entity_id);
      return (ea?.wave ?? 9) - (eb?.wave ?? 9) || a.seniority_rank - b.seniority_rank;
    });
  return { ready, capReached, caps };
}
