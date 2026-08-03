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
      body: 'Matching reads these fields. The more complete your profile is, the more investors we can assess and the more accurately we can determine alignment. When information is missing, fewer investors can be evaluated and the resulting matches are less accurate, as we cannot properly assess their fit with your startup. Click the bar to jump straight to what\'s missing.',
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

  // Prompt 94 — was guide_outbox; renamed along with the page (Outbox is
  // now the Warrants sub-tab of Tasks, itself split into Pending Review /
  // Data Room Mail Access). Selectors point at warrants-* data-tour-ids
  // now (WarrantsPanel.tsx); content is otherwise the same tour.
  guide_warrants: [
    {
      selector: 'warrants-header',
      title: 'Nothing leaves without passing here',
      body: 'The engine drafts, you approve. Anything it can’t do safely stops in this queue with the reason attached.',
    },
    {
      // Dropped if pending.length === 0 — no card exists to anchor to.
      selector: 'warrants-pending-card',
      title: 'Each card says exactly what will happen',
      body: 'The title is the action, the line under it is the reason it was held. Approve executes it; Reject drops it.',
    },
    {
      selector: 'warrants-tick',
      title: 'You can ask for a pass right now',
      body: 'The engine runs on its own schedule too. This button just brings the next pass forward.',
    },
    {
      // Dropped if there's no run history yet.
      selector: 'warrants-pending-recent',
      title: 'Every decision is on the record',
      body: 'Executed and rejected, with timestamps. Nothing the engine did is invisible after the fact.',
    },
  ],

  guide_today: [
    {
      selector: 'today-header',
      title: 'Today is the only page you need to open',
      body: 'It tells you what to do now, in order. If nothing is here, there is nothing to do — that’s a valid answer.',
    },
    {
      selector: 'today-ready',
      title: 'Ready means we found you a hook',
      body: 'These investors have a specific reason to hear from you. The W1/W2 badge is the wave they belong to, and the official channel is listed first.',
    },
    {
      selector: 'today-research',
      title: 'Research needed is not a backlog',
      body: 'An investor without a hook doesn’t get a generic message — they wait. A burnt contact doesn’t come back.',
    },
    {
      selector: 'today-discipline',
      title: 'The caps are the strategy',
      body: 'Four a day, twenty a week. A €1.3M round closes on 15–40 real conversations, not on volume.',
    },
  ],

  guide_dashboard: [
    {
      selector: 'dashboard-top-cards',
      title: 'Where the round actually stands',
      body: 'Active conversations, messages sent this week, follow-ups due. These are counts, not estimates.',
    },
    {
      selector: 'dashboard-funnel',
      title: 'Read the drop, not the total',
      body: 'Contacted → replied → meeting → diligence → committed. The step where the numbers collapse is the step to fix.',
    },
    {
      selector: 'dashboard-pass-reasons',
      title: 'A no with a reason is worth keeping',
      body: 'Every pass is recorded with why. Patterns here change who we put in front of you next.',
    },
    {
      // Dropped if the companyCanon capability is off — this tab doesn't
      // exist for every account.
      selector: 'dashboard-review-tab',
      title: 'Second tab, slower questions',
      body: 'Overview is for this week. Review & Optimization is for what to change about the round itself.',
    },
  ],

  guide_documents: [
    {
      selector: 'documents-folders',
      title: 'Two shelves, not one',
      body: 'Materials is what you send openly — deck, one-pager. Vault Data Room is what you open under access control, numbered 00 to 08 for diligence.',
    },
    {
      // P103 Bloco 3 — was "view-only or downloadable, open or on-grant",
      // describing a choice that didn't exist (downloadable/view-only were
      // never founder-settable). Now describes what's actually real: the
      // 3-level access selector.
      selector: 'documents-panel',
      title: 'Every document has a state',
      body: 'Current or superseded, and one of three access levels — open, on request, or due diligence only. The level travels with the document, not with the person.',
    },
    {
      selector: 'documents-grants',
      title: 'Access follows consent',
      body: 'You grant to a person, not to a link. An invited person sees nothing — no document, no metadata — until they sign in and confirm it’s them.',
    },
    {
      // Dropped when the selected folder has no documents — there's no
      // counter to point at.
      selector: 'documents-views',
      title: 'You see what they read',
      body: 'Views are logged back to the investor entity, so the pipeline knows who is actually doing diligence.',
    },
  ],

  // P104 #2 — gap: /agenda had no tour at all.
  guide_agenda: [
    {
      selector: 'agenda-grid',
      title: 'The month, at a glance',
      body: 'Every task with a due date shows on its day. Overdue tasks turn red so they never quietly disappear.',
    },
    {
      selector: 'agenda-rail',
      title: 'Overdue, due today, this week',
      body: 'The same tasks as the grid, sorted by urgency. Completed ones stay visible — checked off, not gone.',
    },
    {
      selector: 'agenda-export',
      title: 'Take it with you',
      body: 'Export everything open as an .ics file — import it into whatever calendar you actually use.',
    },
  ],

  // P104 #4 — gap: the "People & Access" tab had no tour, only "Documents & Data Room" did.
  guide_people_access: [
    {
      selector: 'people-entities',
      title: 'Pick an entity to see their view',
      body: 'Search finds any entity in your pipeline, even ones with no access yet — that absence is itself the point.',
    },
    {
      selector: 'people-matrix',
      title: 'What they can actually see',
      body: 'Can view, can view after NDA, awaiting confirmation, or can\'t view — one row per document, exactly as that person experiences it.',
    },
  ],

  guide_plans: [
    {
      selector: 'plans-current',
      title: 'What you’re on, and what it unlocks',
      body: 'Your current plan is marked. Features listed with “coming soon” aren’t live yet — they’re on the roadmap, not in your hands today.',
    },
    {
      // §13 bundles the toggle and the promo code field into one step;
      // the toggle is the anchor (Promo code sits directly above it,
      // already visible, just not separately spotlighted).
      selector: 'plans-toggle',
      title: 'Two ways to pay less',
      body: 'Switch to annual, or enter a promo code here. Cancel anytime — nothing here locks you in.',
    },
  ],
};
