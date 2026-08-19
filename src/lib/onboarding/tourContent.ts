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
      body: 'Not contacted, contacted, in conversation, passed, invested, frozen. Move an investor as reality moves — the dashboard reads from this.',
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
      // Prompt 115 Block B — the feature this step describes moved out of
      // Dashboard into its own nav tab; the step stays here (still shown
      // while touring Dashboard) but now points at the sidebar entry
      // instead of a tab button that no longer exists. Dropped if the
      // companyCanon capability is off — this entry doesn't exist for
      // every account.
      selector: 'nav-readiness',
      title: 'A separate workspace, slower questions',
      body: 'Overview is for this week. Readiness & Train is for what to change about the round itself — and for practicing how you answer for it.',
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

  // Prompt 255 — the entity dossier page had no tour at all (LampButton
  // showed "No page guide here yet"). Seven steps, one per anchor placed on
  // this page: header, journey stepper, actions, contact history, Sherlock
  // Tip, entity summary (covers Approach + Round too, kept as one step to
  // match the length of other tours), and the People panel.
  guide_entity: [
    {
      selector: 'entity-header',
      title: 'Two ways to reach out from here',
      body: 'Log interaction records something that already happened. Message investor sends through the platform — both keep the pre-flight checks in the loop.',
    },
    {
      selector: 'entity-journey',
      title: 'Where this relationship stands',
      body: 'Each stage lights up as you pass it, with a badge when a document was involved. A greyed-out Declined chip is clickable — it opens the evidence behind that pass.',
    },
    {
      selector: 'entity-actions',
      title: 'Moving the relationship forward',
      body: 'Advancing a stage needs a fact behind it — a reply, a meeting. Decision needs an outcome and a reason. Something else covers passing or parking, and asks why.',
    },
    {
      selector: 'entity-history',
      title: 'Everything sent and received',
      body: 'Every logged interaction, in order. Open Thread view to read a message exchange the way it actually happened, not as a flat list.',
    },
    {
      selector: 'entity-tip',
      title: 'One suggestion, not a queue',
      body: 'Sherlock Tip tells you the single next thing worth doing here — and when it can check its own advice for you, like pre-flight, it runs the check and shows the result instead of just telling you to.',
    },
    {
      selector: 'entity-summary',
      title: 'What this card actually stores',
      body: 'Entity summary is who they are. Approach is why you\'re contacting them. Round is what they\'d be putting in — all editable, all feeding into pre-flight and matching.',
    },
    {
      selector: 'entity-people',
      title: 'The order isn\'t optional',
      body: 'Numbered by seniority — you approach rank 1 first, and rank 2 only unlocks once rank 1 replies or goes dormant. The badges show email/LinkedIn verification and hook research status; the dot is that person\'s own pre-flight status.',
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

  // Prompt 121 §2.1 — the investor workspace never had this system at all
  // (confirmed: InvestorWorkspaceShell.tsx had zero data-tour-id/tour
  // references before this). One guide per tab, same mechanism as the
  // founder side's own guide_documents/guide_people_access split in
  // documents/page.tsx — a first-entry walk across Pipeline → About →
  // Access → Plans is 4 separate per-tab guides, not one tour spanning tabs
  // that aren't simultaneously in the DOM. guide_investor_access ships
  // alongside the Access granted page itself (Prompt 121 §2.5), not here.
  guide_investor_pipeline: [
    {
      selector: 'investor-pipeline-list',
      title: 'Startups matched to your thesis',
      body: 'Shown in waves by fit — the next wave unlocks once you\'ve decided on every card in this one. A locked data room just means the founder hasn\'t opened it to you yet; Express interest is how that conversation starts.',
    },
    {
      selector: 'investor-pipeline-filters',
      title: 'Narrow it down',
      body: 'Filter by sector, geography or stage — this only changes what you see inside the current wave, it never unlocks the next one early.',
    },
  ],
  guide_investor_about: [
    {
      selector: 'investor-about-completeness',
      title: 'This percentage drives your matches',
      body: 'The more complete your mandate, the more accurately we can tell which startups actually fit it.',
    },
    {
      selector: 'investor-about-form',
      title: 'Your thesis, in detail',
      body: 'Ticket range, sectors, stages, exclusions — everything here is what decides who shows up in your Pipeline.',
    },
  ],
  // Prompt 121 §2.5 — ships alongside the Access granted page itself, the
  // 4th and last point of the first-entry tour named in §2.1.
  guide_investor_access: [
    {
      selector: 'access-granted-tabs',
      title: 'Three states, one place',
      body: 'Granted is what you can open right now. Requested is what you\'ve asked for and are waiting on. Expired is access that ran out — Request again picks the conversation back up.',
    },
    {
      selector: 'access-granted-list',
      title: 'Grouped by startup, then by folder',
      body: 'Expand a startup to see exactly which folders and documents you can open — the same structure the founder organized their data room in.',
    },
  ],
  guide_investor_plans: [
    {
      selector: 'plans-current',
      title: 'What you’re on, and what it unlocks',
      body: 'Your current plan is marked here, with its seat count and monthly opportunity cap.',
    },
    {
      selector: 'plans-toggle',
      title: 'Monthly or annual',
      body: 'Switch the whole grid between monthly and annual pricing. Requesting a different tier doesn\'t charge you automatically — the team applies it manually.',
    },
  ],
};
