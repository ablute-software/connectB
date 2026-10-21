// What the Roadmap tab says to a founder whose roadmap is missing something investors look for.
//
// Nuno, 20/10/2026, on Mob2is: "if the company has existed for at least a year it must have roadmap data, at least the history; if it does not fill in the future
// it should be said that investors appreciate this information; if the engine can get hints about this from the company's documents it should suggest milestones to
// add — as cards — leaving the user the right to take them in, change them or ignore them."
//   · the HISTORY is asked of a company that has existed for a year (and scored: companyCompleteness.ts, `roadmap.history`);
//   · the FUTURE is only said — investors appreciate it — never scored, never required;
//   · the suggestion cards already exist (SuggestedEventsPanel: Add / Add as event to edit / Dismiss, from documents and profile). They draw themselves when the
//     engine has something; this is the line that tells a founder with an empty Data Room how to get them, and no AI is run from here.
// Pure, so the sentence is tested. Only STORED events count: the derived "Company founded" mark is not a milestone the founder reached.
import { companyAgeYears, ROADMAP_HISTORY_MIN_AGE_YEARS } from './companyCompleteness';

export interface RoadmapGuidance {
  /** Which part of the roadmap investors would still like to see. */
  needs: ('history' | 'future')[];
  title: string;
  body: string;
  /** The button that opens the add-a-milestone form. */
  cta: string;
  /** Only when the Data Room is empty: what a document can do for the roadmap. */
  documentsHint: string | null;
}

export function roadmapGuidance(args: {
  events: { status: string }[];
  foundedYear: number | null | undefined;
  companyName?: string | null;
  now: Date;
  /** Is there at least one document in the Data Room? */
  hasDocuments: boolean;
}): RoadmapGuidance | null {
  const done = args.events.filter((e) => e.status === 'done').length;
  const planned = args.events.filter((e) => e.status === 'planned').length;
  const age = companyAgeYears({ founded_year: args.foundedYear ?? undefined }, args.now);
  const needsHistory = done === 0 && age !== null && age >= ROADMAP_HISTORY_MIN_AGE_YEARS;
  const needsFuture = planned === 0;
  if (!needsHistory && !needsFuture) return null;

  const name = args.companyName?.trim() || 'Your company';
  const documentsHint = args.hasDocuments ? null
    : 'Tip: documents in your Data Room (a pitch deck, a business plan, a certificate) can give Sherlock dates and awards to suggest milestones from. They appear on this page as cards that you can add, edit or ignore.';

  if (needsHistory && needsFuture) {
    return {
      needs: ['history', 'future'],
      title: 'Your roadmap is empty',
      body: `${name} was founded in ${args.foundedYear}. Investors read a company by what it has already done and by where it is going: add the milestones you have already reached — they count towards your profile’s completeness — and what you plan next.`,
      cta: 'Add a milestone',
      documentsHint,
    };
  }
  if (needsHistory) {
    return {
      needs: ['history'],
      title: 'Add what you have already achieved',
      body: `${name} was founded in ${args.foundedYear}, and investors read a company by what it has already done: a first customer, the launch, a prize, a funding round, a certification. These milestones count towards your profile’s completeness.`,
      cta: 'Add a milestone',
      documentsHint,
    };
  }
  // The future only. Not scored, not required — said once, calmly.
  if (done === 0) {
    // a company too young to be asked for history, with nothing at all on its roadmap yet
    return {
      needs: ['future'],
      title: 'Your roadmap is empty',
      body: 'Investors like to see what a company has already done and where it is going. Add the milestones you have reached so far and what you plan next — optional, but investors appreciate it.',
      cta: 'Add a milestone',
      documentsHint,
    };
  }
  return {
    needs: ['future'],
    title: 'Show investors where you are going',
    body: 'Investors appreciate seeing what you plan next — the next release, the next round, the key hires. Add a few planned milestones. It is optional.',
    cta: 'Add a planned milestone',
    documentsHint,
  };
}
