// Prompt 920 — what is added to /investors (approved in docs/site-copy-920.md §3). The page itself is untouched apart from these additions:
// three questions appended to the accordion it already has, and one section between "Access" and "Pricing", built from the page's own
// styles. The existing four questions stay in src/app/investors/page.tsx; the FAQPage schema is built from the page's whole list, so the
// schema can never describe a question the page does not show.

export interface InvestorFaq { q: string; a: string }

export const INVESTOR_FAQ_EXTRA: InvestorFaq[] = [
  {
    q: 'How do investors find startups that match their investment thesis?',
    a: 'They write the thesis down as criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have startups measured against it, instead of waiting for introductions. On Sherlock Deal an investor builds a mandate once; startups that match it arrive in curated waves, scored against the mandate with the criteria shown, and an introduction happens only when both sides opt in.',
  },
  {
    q: 'Can I compare startups side by side?',
    a: 'Yes. The comparison view puts startups next to each other on match score and the criteria behind it, round size and stage, together with your own scorecard and valuation estimate if you use them. Your scores and notes are private to your organisation; the founder never sees them.',
  },
  {
    q: 'Can I keep following startups I did not invest in, and re-evaluate them later?',
    a: 'Yes. Add a startup to your Watching list and choose what should bring it back to your attention: new evidence of traction, a new round or a changed target, a roadmap milestone, or a match score that rises above a level you set. The list, its order and the thresholds are private to you.',
  },
];

export const INVESTOR_FIT_SECTION = {
  eyebrow: 'First contact',
  title: 'How to find startups that fit your thesis',
  /** The direct answer, first. */
  lead: 'The most reliable way to find startups that fit your thesis is to turn the thesis into criteria — sectors, stages, cheque range, geographies, instruments and exclusions — and have every startup measured against them before anyone sends you a deck. That is what Sherlock Deal does: you write your mandate once, and startups that match it reach you in curated waves, scored against your criteria.',
  cards: [
    {
      title: 'What “fit” means in practice',
      body: 'Every match is measured on sector, stage, cheque plausibility, geography and instrument. Exclusions are hard filters: a startup in a sector you exclude is scored zero instead of being ranked lower. Each match shows which criteria it met and which are still unconfirmed, so a missing fact is never counted as a match.',
    },
    {
      title: 'How Sherlock Deal delivers first contact',
      body: 'Startups arrive in waves, and you work each wave — pass or express interest — before the next one opens. Your plan sets how many new startups arrive each month, so the pipeline stays workable. A startup appears in your pipeline only once its core profile is complete, and its evidence is labelled: fact, company claim, estimate, unknown or stale. You browse in private: founders are not notified while you look. When you want to go further, the introduction happens on MatchDeal, and only when both sides opt in. The first conversation is with a startup that already fits your mandate.',
    },
    {
      title: 'What you never see',
      body: "Sherlock Deal never shows investors a founder's internal performance data — not the founder's outreach activity, not their notes, and not where they stand with other investors. You see the profile the founder chose to show, and more only as the founder grants it.",
    },
  ],
} as const;
