// Prompt 420 — content and pure "should this show" rule for the Evaluation
// Tools intro pamphlet. Same order as Prompt 418's TOOLS array (the funnel:
// orient -> crudest estimate -> qualitative judgment -> real-deal math ->
// hypotheticals -> full probabilistic model).
export interface EvaluationToolsIntroEntry {
  key: 'compare' | 'berkus' | 'scorecard' | 'calculator' | 'simulator' | 'return';
  title: string;
  what: string;
  how: string;
  concludes: string;
}

export const EVALUATION_TOOLS_INTRO_CONTENT: EvaluationToolsIntroEntry[] = [
  {
    key: 'compare', title: 'Compare startups',
    what: 'See several startups side by side.',
    how: 'Up to 3 from your Pipeline, the same metrics in columns.',
    concludes: 'Where to look more closely first.',
  },
  {
    key: 'berkus', title: 'Berkus Method',
    what: 'A pre-revenue valuation estimate, with no real financials needed.',
    how: 'Score across 5 risk factors — team, idea, product, relationships, distribution.',
    concludes: 'A reasonable valuation ceiling when there are no numbers yet to justify more.',
  },
  {
    key: 'scorecard', title: 'Scorecard criteria',
    what: 'YOUR own qualitative evaluation criteria, private to you.',
    how: 'Weights that sum to 100%, dragged to adjust.',
    concludes: 'A score you can compare across startups, on your own terms.',
  },
  {
    key: 'calculator', title: 'Ownership calculator',
    what: "How much you'd end up owning, using this startup's real round data.",
    how: "Your ticket over the round's actual size and valuation.",
    concludes: 'The concrete equity % of this investment, today.',
  },
  {
    key: 'simulator', title: 'Equity simulator',
    what: 'The same math, with your own hypothetical numbers.',
    how: 'Test tickets and valuations different from the real ones.',
    concludes: 'How your position changes depending on what you negotiate.',
  },
  {
    key: 'return', title: 'Scenarios & returns',
    what: 'The expected return, from failure scenarios to a big exit.',
    how: 'Probability × MOIC/IRR for each scenario, weighted.',
    concludes: 'The weighted expected return, and the minimum exit that justifies the entry price.',
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
