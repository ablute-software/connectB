// Prompt 86 Bloco 2 — page tour content registry (§13 of the spec).
// Separate from content.ts's ONBOARDING_CONTENT (modal/coachmark, budget-
// capped at 3 for the account's lifetime) — tours are per-page, unlimited,
// and explicitly not subject to that budget per the Prompt 86 doctrine
// override. Each entry's `selector` must resolve to a `data-tour-id`
// attribute placed on the real DOM anchor; steps whose selector doesn't
// resolve are dropped by PageTour, never invented.
export interface TourStep {
  selector: string;
  title: string;
  body: string;
}

export const TOUR_CONTENT: Record<string, TourStep[]> = {
  // /settings — destination of the welcome popup's CTA, built first per
  // the spec's own build order.
  guide_settings: [
    {
      selector: 'settings-completeness',
      title: 'The percentage is not vanity',
      body: 'Matching reads these fields. An incomplete profile gets matched against fewer investors, and the ones it does get are worse. Click the bar to jump straight to what’s missing.',
    },
    {
      selector: 'settings-identity',
      title: 'Start with sector, stage and phase',
      body: 'These three do most of the matching work. The “needed for 100%” badges mark exactly what’s still missing.',
    },
    {
      selector: 'settings-round',
      title: 'Tell us the round you’re actually running',
      body: 'Target, valuation, instrument, close date. This is what decides whether an investor’s ticket size and stage fit you at all.',
    },
    {
      selector: 'settings-traction',
      title: 'Three to five numbers, chosen by you',
      body: 'They appear on the investor snapshot card in the order you add them. Pick the ones that make the story, not the ones that are easiest to fill.',
    },
  ],
};
