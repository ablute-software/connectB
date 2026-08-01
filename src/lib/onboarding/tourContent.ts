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

  guide_pipeline: [
    {
      selector: 'pipeline-list',
      title: 'This is your round, in one list',
      body: 'Every investor you’re talking to lives here, with their stage and last contact. Nothing gets tracked anywhere else.',
    },
    {
      selector: 'pipeline-import',
      title: 'Bring in the people you already know',
      body: 'Import a CSV or add contacts one by one. Investors we assign you from the catalog show up here automatically.',
    },
    {
      // Dropped automatically if this control isn't in the DOM yet (e.g. a
      // brand-new account with an empty pipeline) — see PageTour's anchor
      // resolution. Not invented: confirmed present for an active pipeline.
      selector: 'pipeline-filters',
      title: 'Stage is the only status that matters',
      body: 'Not contacted, contacted, in conversation, passed, invested, dormant. Move an investor as reality moves — the dashboard reads from this.',
    },
  ],

  guide_outbox: [
    {
      selector: 'outbox-header',
      title: 'Nothing leaves without passing here',
      body: 'The engine drafts, you approve. Anything it can’t do safely stops in this queue with the reason attached.',
    },
    {
      // Dropped if pending.length === 0 — no card exists to anchor to.
      selector: 'outbox-card',
      title: 'Each card says exactly what will happen',
      body: 'The title is the action, the line under it is the reason it was held. Approve executes it; Reject drops it.',
    },
    {
      selector: 'outbox-tick',
      title: 'You can ask for a pass right now',
      body: 'The engine runs on its own schedule too. This button just brings the next pass forward.',
    },
    {
      // Dropped if there's no run history yet.
      selector: 'outbox-recent',
      title: 'Every decision is on the record',
      body: 'Executed and rejected, with timestamps. Nothing the engine did is invisible after the fact.',
    },
  ],
};
