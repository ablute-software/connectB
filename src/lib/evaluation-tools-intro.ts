// Prompt 420 — content and pure "should this show" rule for the Evaluation
// Tools intro pamphlet. Same order as Prompt 418's TOOLS array (the funnel:
// orient -> crudest estimate -> qualitative judgment -> real-deal math ->
// hypotheticals -> full probabilistic model).
//
// Prompt 430 §B.1 — each entry also carries `detail`: what a tool's card
// opens into when clicked (purpose + numbered steps + an optional tip),
// verified against each tool's own real code (CompareStartupsTool/
// ComparisonView, BerkusMethodTool, ScorecardCriteriaTool,
// OwnershipCalculatorTool, EquitySimulatorTool, ScenariosReturnsTool).
export interface EvaluationToolsIntroDetail {
  purpose: string;
  steps: string[];
  tip?: string;
}

export interface EvaluationToolsIntroEntry {
  key: 'compare' | 'berkus' | 'scorecard' | 'calculator' | 'simulator' | 'return';
  title: string;
  what: string;
  how: string;
  concludes: string;
  detail: EvaluationToolsIntroDetail;
}

export const EVALUATION_TOOLS_INTRO_CONTENT: EvaluationToolsIntroEntry[] = [
  {
    key: 'compare', title: 'Compare startups',
    what: 'See several startups side by side.',
    how: 'Up to 3 from your Pipeline, the same metrics in columns.',
    concludes: 'Where to look more closely first.',
    detail: {
      purpose: 'Put up to three startups from your Pipeline next to each other, on the exact same rows, so the differences that matter are easy to see at a glance instead of buried across separate dossier pages.',
      steps: [
        'Open "Compare startups" from the tool list.',
        'Tick up to 3 startups from your Pipeline (the same list the other tools use).',
        'Click "Compare" — a table appears with one column per startup: one-liner, stage, sectors, round size, valuation, match score and reasons, and your own Scorecard average and Berkus estimate for each, wherever you’ve already filled those in.',
      ],
      tip: 'Your Scorecard and Berkus numbers only show up here once you’ve entered them for that startup — blank means not yet scored, not zero.',
    },
  },
  {
    key: 'berkus', title: 'Berkus Method',
    what: 'A pre-revenue valuation estimate, with no real financials needed.',
    how: 'Score across 5 risk factors — team, idea, product, relationships, distribution.',
    concludes: 'A reasonable valuation ceiling when there are no numbers yet to justify more.',
    // Prompt 430's own note: this used to describe the pre-428 5-slider
    // UI, flagged as a known staleness risk once Berkus changed — Prompt
    // 428 (Simplified/Detailed) shipped earlier in this same session, so
    // this describes the tool as it actually exists now rather than
    // repeating the prompt's own now-outdated draft text.
    detail: {
      purpose: 'A rough, defensible pre-revenue valuation ceiling — built by picking an explicit level (0-5) for each of five separate risk areas, never a single guessed number, and never a level derived automatically from your Sherlock/BARS scores. A shared calibration (default €500,000 per factor) converts your levels into euros, and every illustrative value rescales the moment you change it.',
      steps: [
        'Pick a startup from the list on the left, then choose Simplified (one fast, generic 5-level scale for every factor) or Detailed (a full descriptor per level, Sherlock’s own read-only score where one exists, an evidence list, and a confidence badge).',
        'For each factor — Sound idea, Prototype, Quality of the team, Strategic relationships, Early sales/rollout — pick the level that matches your own judgment of how much risk has been reduced.',
        'Optionally adjust the calibration — every level recalculates proportionally, and the total is labeled "Investor-calibrated Berkus" once it differs from the €500,000 default.',
        'In Detailed mode, read the Diagnostic (strongest contributor, largest remaining risk, critical unknown) and Sensitivity (which factor’s next level would move the total most) before saving.',
        'Click "Save estimate" to keep it privately on your seat; every save is kept in your history below, so you can restore an earlier one any time.',
      ],
      tip: 'This is your own private judgment — never shown to the startup, and not investment advice. Sherlock’s context (Detailed mode) informs your pick; it never chooses the level for you.',
    },
  },
  {
    key: 'scorecard', title: 'Scorecard criteria',
    what: 'YOUR own qualitative evaluation criteria, private to you.',
    how: 'Weights that sum to 100%, dragged to adjust.',
    concludes: 'A score you can compare across startups, on your own terms.',
    detail: {
      purpose: 'Your own qualitative criteria for judging any startup — the things you personally weigh, each with a weight that sums to 100%. Defining them here is a one-time setup; scoring a specific startup against them happens on that startup’s own dossier page.',
      steps: [
        'Add a criterion, name it, and set its weight — drag to adjust, the weights always sum to 100%.',
        'Reorder or remove criteria as your thinking evolves.',
        'Go to a startup’s dossier page to actually score it against these criteria, tab by tab.',
        'Come back here any time — your Scorecard average for a startup is one of the rows in "Compare startups".',
      ],
      tip: 'These criteria are private to you — a colleague at your firm defines their own set independently.',
    },
  },
  {
    key: 'calculator', title: 'Ownership calculator',
    what: "How much you'd end up owning, using this startup's real round data.",
    how: "Your ticket over the round's actual size and valuation.",
    concludes: 'The concrete equity % of this investment, today.',
    detail: {
      purpose: 'How much of a real deal your ticket actually buys — using the round size and valuation that startup registered, not a hypothetical. This is the "what do I get in this specific deal" question.',
      steps: [
        'Pick a startup that already has a valuation on file.',
        'Type your ticket size and choose whether that valuation is pre- or post-money.',
        'Read your ownership % after this round, and the resulting post-money valuation.',
        'Optionally fill in expected dilution (%) for future rounds, to see how your stake shrinks round by round.',
        'If the startup has a cap table on file, see it charted below — tick "Include my estimated stake" to add your own slice to it.',
      ],
      tip: 'No valuation on file yet? The calculator points you to the Equity simulator instead, so you’re never stuck.',
    },
  },
  {
    key: 'simulator', title: 'Equity simulator',
    what: 'The same math, with your own hypothetical numbers.',
    how: 'Test tickets and valuations different from the real ones.',
    concludes: 'How your position changes depending on what you negotiate.',
    detail: {
      purpose: 'The exact same ownership math as the Ownership calculator, but with numbers you choose yourself — for testing a ticket size or valuation you’re negotiating, independent of whatever the startup has actually registered.',
      steps: [
        'Optionally click "Prefill from [startup]" to start from that startup’s real numbers, then edit freely.',
        'Set ticket, valuation, and whether it’s pre- or post-money (pre-money also asks for the round size).',
        'Read the resulting ownership % and post-money valuation for that scenario.',
        'Add up to 3 scenarios side by side to compare different tickets or valuations at once.',
      ],
      tip: 'Nothing here is saved back to the startup’s real data — it’s yours to experiment with.',
    },
  },
  {
    key: 'return', title: 'Scenarios & returns',
    what: 'The expected return, from failure scenarios to a big exit.',
    how: 'Probability × MOIC/IRR for each scenario, weighted.',
    concludes: 'The weighted expected return, and the minimum exit that justifies the entry price.',
    detail: {
      purpose: 'The expected return on a ticket, from a total loss to a big exit — up to five weighted scenarios (Failure, Downside, Base, Upside, Outlier), each with its own probability, exit value, and time horizon.',
      steps: [
        'Pick a startup (or stay hypothetical, with your own valuation and round size).',
        'For each scenario, set a probability, an exit value — typed by hand, or pulled from your Berkus estimate × a multiple — and a horizon in years.',
        'Read the probability-weighted MOIC and IRR across all your scenarios, and the expected value of the ticket.',
        'Show advanced: option pool expansion and pro-rata participation per future round, if those apply.',
        'Check "Required exit (VC Method)": the minimum exit value that would hit your own target multiple (e.g. 10×) at today’s entry price — the same method, run in reverse.',
      ],
      tip: 'Every number here is arithmetic over assumptions you typed — never a platform forecast.',
    },
  },
];

// §B.1 — "first time this tab is opened, per login (fresh session)". Pure
// so it's testable without a component: the caller supplies both booleans
// (muted from onboarding_state, shownThisSession from a session-lifetime
// flag — see EvaluationToolsPanel.tsx for why that can't be plain
// component state, since this panel unmounts on every tab switch).
export function shouldShowEvaluationToolsIntro(opts: { muted: boolean; shownThisSession: boolean }): boolean {
  return !opts.muted && !opts.shownThisSession;
}
