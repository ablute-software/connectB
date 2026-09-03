// Prompt 540 RC2 — "Company founded", derived, never stored.
//
// WHAT IT WAS. There is no derived founding event on main. The "Company
// founded — YYYY-01-01" the founder sees is an AI SUGGESTION:
// /api/roadmap/suggest-events reads orgs.founded_year with the service role,
// feeds "Company founded in YYYY" to the model (whose instructions say a
// year alone is fine, use January 1st), writes a
// roadmap_event_suggestions row, and the founder accepts it into a real
// roadmap_events row. Two failures follow from that, and both are structural
// rather than incidental:
//
//  - FRESHNESS. updateOrg commits locally and POSTs /api/org/update
//    fire-and-forget; SuggestedEventsPanel fetches once on mount. Save "Year
//    founded", click straight to Roadmap, and the GET reads the database
//    before the POST has landed — knowledge signature without `founded:`,
//    so nothing is proposed. Refresh and the row is there, a new signature
//    triggers a new AI pass, and the suggestion appears. "Only after a
//    refresh", exactly as reported.
//  - DUPLICATES. Change 2020 to 2021 and the signature changes again, so a
//    second "Company founded" is proposed for 2021-01-01.
//    isDuplicateRoadmapEvent gates on the YEAR, so it does not recognise the
//    2020 one as the same fact. If the founder had already accepted 2020,
//    the roadmap now carries two founding events.
//
// WHAT IT IS NOW. The founding date is not a fact the founder recorded on
// the timeline — it is a projection of a field they already filled in
// somewhere else. So it is computed at render time from org.founded_year and
// never written anywhere. Change the year and the memo recomputes and the
// marker moves; nothing is persisted, so navigation, refetch and refresh
// cannot duplicate it, and there is no write to race a fire-and-forget save.
import { isDuplicateRoadmapEvent } from './roadmap-duplicate';

export const DERIVED_FOUNDED_ID = 'derived:founded';
export const DERIVED_FOUNDED_TITLE = 'Company founded';
// The lane a founding belongs in when the founder has that category. Matched
// by label because the default lanes are seeded per org and have no stable
// machine key; a founder who renamed or deleted it simply gets General, which
// is the same lookup-miss contract the rest of the roadmap uses.
export const FOUNDED_CATEGORY_LABEL = 'Team & Company';

export interface DerivedFoundedOrg { founded_year?: number | null }
export interface DerivedFoundedCategory { id: string; label: string }
export interface DerivedFoundedEventLike { title: string; date: string }

export interface DerivedRoadmapEvent {
  id: string;
  title: string;
  date: string;
  status: 'done';
  date_precision: 'approx';
  category_id: string | null;
  /** Read-only in every surface: it has no row to update. */
  derived: true;
}

/**
 * The founding marker for this org, or null when there shouldn't be one.
 *
 * Null in three cases, and the third is the one that matters: when a REAL
 * event already describes the founding. Founders who accepted the old AI
 * suggestion have a genuine roadmap_events row — that is their data and this
 * function does not compete with it, it steps aside. isDuplicateRoadmapEvent
 * is reused rather than a bespoke title match so "Company founded",
 * "Founded the company" and "Company founded in Lisbon" all count as the
 * same fact, which is exactly what it was built for.
 */
export function derivedFoundedEvent(
  org: DerivedFoundedOrg,
  events: DerivedFoundedEventLike[],
  categories: DerivedFoundedCategory[] = [],
): DerivedRoadmapEvent | null {
  const year = org.founded_year;
  if (year == null || !Number.isFinite(year)) return null;
  // A year outside any plausible range is a typo, not a founding date, and
  // would drag the canvas's time domain with it.
  if (year < 1800 || year > 2200) return null;

  const date = `${String(year).padStart(4, '0')}-01-01`;
  if (isDuplicateRoadmapEvent({ title: DERIVED_FOUNDED_TITLE, date }, events)) return null;

  const category = categories.find((c) => c.label.trim().toLowerCase() === FOUNDED_CATEGORY_LABEL.toLowerCase());
  return {
    id: DERIVED_FOUNDED_ID,
    title: DERIVED_FOUNDED_TITLE,
    date,
    status: 'done',
    date_precision: 'approx',
    category_id: category?.id ?? null,
    derived: true,
  };
}

/** True for the one synthetic event above — every editing surface checks this. */
export function isDerivedEvent(e: { id?: string; derived?: boolean } | null | undefined): boolean {
  return !!e && (e.derived === true || e.id === DERIVED_FOUNDED_ID);
}

// Prompt 540 RC2 §4 — the filter that stops the model proposing this again.
// Word-stem "found" plus the org's own founded year: a candidate that is
// about the founding, in the founding year, is the thing this module now
// derives, so it must never become a suggestion or a stored row again.
// Deliberately narrow — "Founded the Berlin office in 2023" in a different
// year is a real, different event and stays.
export function isFoundingCandidate(
  candidate: { title: string; date?: string | null }, foundedYear: number | null | undefined,
): boolean {
  if (foundedYear == null) return false;
  const words = candidate.title.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
  // NOT a bare "found" stem. "Found a lead investor" is an ordinary event
  // that happens to share three letters with "founded", and in the founding
  // year a stem match would silently delete it from the suggestions. Only
  // the forms that actually mean incorporation count.
  const mentionsFounding = words.some((w) => /^found(ed|ing|er|ers|ation)$/.test(w));
  if (!mentionsFounding) return false;
  const year = String(foundedYear);
  // The year can be in the date or spelled out in the title ("Company
  // founded 2021"), and the model has produced both shapes.
  return candidate.date?.slice(0, 4) === year || candidate.title.includes(year);
}
