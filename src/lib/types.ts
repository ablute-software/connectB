// ablute_ Investor CRM — domain types (mirror of supabase/migrations/0001_init.sql)

export type EntityType =
  | 'vc' | 'corporate_vc' | 'family_office' | 'angel_fund'
  | 'angel_network' | 'public_body' | 'accelerator';
// 'other' added for migration 0037 (Company tab redesign, Round card) — the
// enum only needed an escape hatch there; entities.stage_min/max never use
// it (investor stage ranges are always one of the original four).
export type Stage = 'pre_seed' | 'seed' | 'series_a' | 'later' | 'other';
export type FitScore = 'high' | 'medium_high' | 'medium' | 'low';
// Prompt 277 A.1 — 'resolved_not_a_fit' is a new value ("not even the
// right kind of investor", e.g. an accelerator), deliberately not a reuse
// of 'not_applicable' (which means "no hard-filter rule was ever
// evaluated here" — see the field's own comment below). 'resolved_blocked'
// is now reserved exclusively for reported/confirmed fraud — see
// HardFilterBanner and entity_fraud_flags (migration 0196).
export type HardFilterStatus = 'open' | 'resolved_ok' | 'resolved_blocked' | 'resolved_not_a_fit' | 'not_applicable';
export type EntityStatus =
  | 'not_contacted' | 'contacted' | 'in_conversation' | 'diligence'
  | 'passed' | 'invested' | 'dormant';
export type HookStatus = 'researched' | 'to_research' | 'none_found';
export type Direction = 'out' | 'in';
export type Channel =
  | 'linkedin_dm' | 'linkedin_note' | 'email' | 'web_form'
  | 'call' | 'meeting' | 'event' | 'intro' | 'stage_change';
export type RelationshipStage =
  | 'not_contacted' | 'contacted' | 'engaged' | 'meeting' | 'diligence' | 'decision';
export type Classification =
  | 'awaiting' | 'interested' | 'meeting_request' | 'question'
  | 'pass' | 'out_of_office' | 'bounce' | 'unclear';
export type PassReasonCategory =
  | 'valuation' | 'check_size' | 'geography' | 'stage_too_early'
  | 'thesis_mismatch' | 'team' | 'traction' | 'other';
export type TaskKind = 'follow_up' | 'meeting' | 'research' | 'admin';
// "Tipo de compromisso" — a finer label than TaskKind, tied to WHY the task
// exists from an outreach-discipline standpoint (first contact vs a
// specific follow-up flavor vs a research gate), not just what kind of
// task it is. TaskKind stays as-is alongside this, unrelated axis.
export type ActionType = 'first_contact' | 'follow_up_no_reply' | 'follow_up_thread' | 'research_hook' | 'other';
export type OverrideRule =
  | 'contact_lock' | 'seniority_order' | 'hard_filter'
  | 'daily_cap' | 'weekly_cap' | 'follow_up_limit';
export type SubmissionChannelType = 'email' | 'form' | 'none' | 'unknown';
export type FolderKind = 'data_room' | 'materials';
// P103 Bloco 3 / P104 #3 — was 'private' | 'on_grant' | 'link_anyone';
// renamed (migration 0100) to match the new lock-icon scheme.
export type DocVisibility = 'due_diligence' | 'on_grant' | 'open';
export type AutomationMode = 'draft_review' | 'full_auto';
export type AutomationTrigger =
  | 'no_reply_14d' | 'followup_no_reply_14d' | 'inbound_meeting_request'
  | 'inbound_pass' | 'contact_lock_expired' | 'grant_activated'
  | 'document_viewed' | 'hook_missing'
  // Prompt 398 §3 — recurring reminder while an investor's L3 interest
  // request sits unanswered. No draft_review/full_auto split applies (see
  // AutomationsPanel.tsx) — this one only has enable + an interval
  // (config.intervalDays, default 2).
  | 'interest_request_unanswered';
export type AutomationAction =
  | 'draft_follow_up' | 'create_task' | 'propose_dormant'
  | 'notify_owner' | 'send_grant_email' | 'draft_reply';
export type RunStatus =
  | 'drafted' | 'pending_review' | 'approved' | 'executed'
  | 'rejected' | 'blocked_preflight' | 'failed';
// Plans & Account batch — three founder-named tiers. Legacy DB rows may still
// hold 'free'/'paid' (migration 0028 remaps them; normalizePlan in plans.ts
// maps in code meanwhile). Prices/entitlements live in plans.ts.
export type PlanTier = 'idea' | 'garage' | 'motherfunding';
export type AiReviewKind = 'deck_review' | 'one_pager_review' | 'message_review' | 'market_data';

export interface Org {
  id: string;
  name: string;
  // Prompt 361 — "when this founder started using the platform," for the
  // Dashboard's Before/With Sherlock era split. Real DB column since
  // migration 0001 (default now()); only just surfaced on the type — the
  // store's `select('*')` already passes it through untyped.
  created_at?: string;
  plan: PlanTier;
  daily_cap: number;
  weekly_cap: number;
  sender_email?: string;
  bcc_email?: string;
  // NEXT_STEPS Phase 2 onboarding
  website?: string;
  sector?: string;
  stage?: Stage;
  round_target_eur?: number;
  country?: string;
  one_liner?: string;
  // Prompt 325 — additional to one_liner, never a replacement. Short
  // (INTRO_PITCH_MAX, investor-interest-level.ts), optional, Discovery-
  // visible: the concrete "why click Interested" one_liner alone didn't give.
  intro_problem?: string;
  intro_solution?: string;
  // Packs credits (spec, not yet wired to a real crediting mechanic or
  // billing model — see DECISIONS.md "Packs — future pricing spec").
  // Type-only stub for now: no DB column, no migration, no logic reads or
  // writes this yet.
  credits?: number;
  // Plans & Account batch — a pending upgrade request the founder made from the
  // Plans page. A platform admin clears it when flipping the org's plan in the
  // back-office. Columns added in migration 0028; capability-gated (a probe on
  // orgs.plan_change_requested), so absent/undefined pre-migration.
  plan_change_requested?: string;
  plan_change_requested_at?: string;
  // Billing (Stripe subscriptions, env-gated). stripe_customer_id exists since
  // 0001; subscription_id + billing_period added in migration 0031. Written
  // ONLY by the Stripe webhook (the source of truth for billing-driven plan
  // changes); the manual back-office set-plan stays as an override.
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  stripe_billing_period?: string; // 'monthly' | 'annual'

  // Company tab redesign (migration 0037, capability-gated —
  // companyProfileAvailable). `name` above is the commercial name; `sector`
  // above is legacy (still read by composer.ts/readiness/ReviewPanel) and
  // stays in sync with `sectors` below on every save, so those callers never
  // need to change. `stage` above is reused as the Round card's Estádio,
  // extended with an 'other' enum value + stage_other here.
  legal_name?: string;
  // A Storage PATH in the `data-room` bucket (${org_id}/logo/...), NOT a
  // public URL — resolved to a signed URL client-side at render time.
  logo_url?: string;
  hq_city?: string;
  postal_code?: string;
  founded_year?: number;
  description?: string;
  // P104 #7 — sectors holds fixed-taxonomy picks only (sector-taxonomy.ts).
  // sectors_other is the free-text "Other" value, kept separate so
  // matching can treat it distinctly and never silently folds it into the
  // taxonomy list.
  sectors?: string[];
  sectors_other?: string;
  employee_count?: number;
  // Founder count is normally derived from company_people (is_founder=true);
  // this is the manual override for when that count is wrong/incomplete.
  founder_count_override?: number;
  stage_other?: string;
  round_raising?: boolean;
  round_secured_eur?: number;
  round_instruments?: string[];
  round_instrument_other?: string;
  round_valuation_eur?: number;
  // Prompt 115 Block E (migration 0111, propose-only) — which basis the
  // founder declared round_valuation_eur in. Absent/undefined for any org
  // predating the migration or before Nuno applies it; every reader falls
  // back to 'pre_money' (see round-valuation-basis-capability.ts).
  round_valuation_basis?: 'pre_money' | 'post_money';
  round_runway_months?: number;
  round_target_close_date?: string; // ISO date
  round_use_of_funds?: string;
  round_flexible?: boolean;
  round_flexible_note?: string;
  // Investor Workspace Fase 1 (prompt 54, migration 0054) — Zona 1 snapshot.
  round_min_ticket_eur?: number;
  round_runway_post_months?: number;
  // Prompt 85 Correction 1 (migration 0082) — deliberately separate from
  // `stage` (the round's stage) and from matchdeal_profiles.company_phase/
  // contact (a different system entirely, see the migration's own comment).
  current_phase?: CompanyPhase;
  revenue_eur?: number;
  primary_contact_person_id?: string;
  // Prompt 166 §D — per-org toggle for whether the SWOT snapshot (below) is
  // shown on the investor-facing startup dossier. Additive, propose-only
  // (migration 0159, not yet applied) — undefined pre-migration, in which
  // case every reader treats it as the DB default (true), never as false.
  swot_visible_to_investors?: boolean;
  // Prompt 212 §A — a barra de progresso da ronda no portal do investidor.
  // Ausente = true (o comportamento de sempre), igual ao swot.
  round_progress_visible_to_investors?: boolean;
  // Prompt 167 §C — same toggle shape, for the Roadmap (below). Additive,
  // propose-only (migration 0161).
  roadmap_visible_to_investors?: boolean;
  // Prompt 268 (251/253 Bloco D) — opt-in, NOT a visibility toggle like the
  // three above (those default true/opt-out; this defaults false/opt-in —
  // a genuinely new capability, not a retrofit). Undefined/false pre-
  // migration or pre-opt-in both mean the same thing: Bloco B/C's
  // deterministic path runs unfiltered, exactly as before this prompt.
  reawakening_ai_filter_enabled?: boolean;
  // Catalog-investor accumulated quota (pipeline "vidro fosco" blocking —
  // DECISIONS.md, migration 0042). Existed in the DB since 0042 but was
  // never declared here (Prompt 179 gap found while fixing
  // catalog_blocked_count) — every store already fetches it via `select('*')`,
  // this just lets the client actually read the field it's already getting.
  catalog_quota?: number;
  // Prompt 179 §B — the "1st of month" marker the monthly catalog delivery
  // job stamps once it's grown catalog_quota for this org this month.
  // Additive, propose-only (migration 0165) — undefined pre-migration.
  catalog_last_monthly_delivery?: string;
  // Prompt 278 §4 — the Vault kill switch. Additive, propose-only (migration
  // 0197, not yet applied) — undefined pre-migration, same as every other
  // capability-gated column here, in which case every gated route treats it
  // as never frozen. Set = every investor-facing document/folder path for
  // this org returns nothing; null/undefined = normal.
  vault_access_frozen_at?: string | null;
  // Prompt 316 §B — My Network opt-in. Off by default (unlike the
  // visibility toggles above, which default true/opt-out): "shares an
  // investor with another founder" is pipeline data about THIS org, and
  // the root privacy rule (CLAUDE.md) requires consent before it's
  // discoverable by anyone else — the suggestion engine only ever pairs
  // two orgs that BOTH have this on. Undefined/false pre-migration or
  // pre-opt-in both mean "never discoverable", the fail-closed default.
  network_discoverable?: boolean;
}

// Prompt 167 §A — one row per roadmap period (a quarter or a whole year).
// The founding node is NOT one of these — it's always derived from
// org.founded_year and drawn as a fixed, non-editable starting point.
export type RoadmapPeriodKind = 'quarter' | 'year';
export interface RoadmapMilestone {
  id: string;
  org_id: string;
  period_kind: RoadmapPeriodKind;
  period_year: number;
  // Null exactly when period_kind === 'year' — mirrors the DB check
  // constraint (migration 0161), not re-validated independently here.
  period_quarter?: number;
  items: string[];
  // Prompt 213 §D — itens estruturados (0177). Quando presente ganha a
  // `items`; a conversao e lazy ao guardar. Ver roadmap-categories.ts.
  items_v2?: RoadmapItemV2[] | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Prompt 359 — the roadmap CANVAS's own unit: a real event with a real date
// and a real row identity (unlike RoadmapMilestone's items_v2, a JSON blob
// with no per-item id — see migration 0237's own comment on why that made
// per-event drag/click/evidence-linking impossible). Evolves the existing
// model rather than replacing it: category_id is the SAME roadmap_categories
// FK RoadmapItemV2 already used, and migration 0237 converts every existing
// milestone item into one of these, losing nothing.
export type RoadmapDatePrecision = 'exact' | 'approx' | 'quarter';
export type RoadmapEventStatus = 'done' | 'planned';
export interface RoadmapEvent {
  id: string;
  org_id: string;
  title: string;
  description?: string | null;
  date: string; // ISO date (YYYY-MM-DD)
  date_precision: RoadmapDatePrecision;
  end_date?: string | null; // set only for a period event (drag-created)
  status: RoadmapEventStatus;
  category_id?: string | null;
  document_id?: string | null;
  badge_id?: string | null;
  media_id?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Prompt 166 — the four SWOT bullet-list categories, shared by:
// review_runs.report (strengths/weaknesses always existed; opportunities/
// threats added in Prompt 166 §A), the founder-facing SwotVisualCard, and
// the investor-facing dossier projection (investor-interest-level.ts),
// which is deliberately narrowed to ONLY these four arrays — never score,
// summary, risks, recommendations, or the confirmed facts that generated
// the analysis (see that file's own header comment).
export interface SwotData {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export type CompanyPhase = 'concept_idea' | 'prototype' | 'pilot' | 'launch_early_adopters' | 'growth';

// Investor Workspace Fase 1 — founder-chosen traction metrics (label+value
// pairs, e.g. "MRR" / "€12k"), shown on the portal snapshot card. Same
// shape/RLS pattern as CompanyPerson (0037): small ordered child table.
export interface TractionMetric {
  id: string;
  org_id: string;
  label: string;
  value: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  dealdigger_type: string | null;
  show_on_dealdigger: boolean;
}

// Investor Workspace Fase 1 — append-only history of an investor's stated
// ticket range (never updated in place; "current" = the latest row per
// investor_email). Written only by /api/portal/ticket-signal
// (service-role, session-scoped), never by a client-side store action —
// investors are never org_members, so there's nothing here for the
// founder-side store to insert.
export interface InvestorTicketSignal {
  id: string;
  org_id: string;
  person_id?: string;
  investor_email: string;
  range_min_eur?: number;
  range_max_eur?: number;
  range_label: string;
  created_at: string;
}

// Company tab redesign — the startup's own team (not the app-access roster
// in org_members/App access). One row per person; sort_order is set at
// creation time (append-only for now, no drag-reorder UI yet).
export interface CompanyPerson {
  id: string;
  org_id: string;
  full_name: string;
  title?: string;
  is_founder: boolean;
  linkedin_url?: string;
  email?: string;
  bio?: string;
  photo_url?: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Entity {
  id: string;
  name: string;
  // Prompt 361 — for the Impact tab's "only possible with Sherlock" block
  // (source === 'match_deal' | 'catalog' entities, first-added date). Real
  // DB column since migration 0001; only just surfaced on the type.
  created_at?: string;
  type: EntityType;
  hq_city?: string;
  hq_country?: string;
  invests_in_geographies: string[];
  website?: string;
  website_verified: boolean;
  email_domain?: string;
  email_domain_verified: boolean;
  // Prompt 407 §B.4 — set once, at monthly-delivery time, when the
  // fields above were sourced from the investor's own claimed & complete
  // profile rather than research (migration 0257). A point-in-time
  // snapshot, not a live claim-status check — see that migration's comment.
  claimed_profile_at_delivery?: boolean;
  // Direct, editable contact fields (batch 2 item 1) — distinct from
  // website/email_domain above, which are derived/verification-tracked.
  // Migration 0024, capability-gated: src/lib/entity-contact-capability.ts.
  email?: string;
  phone?: string;
  address?: string;
  postal_code?: string;
  // Confidence-routed external research import (migration 0032, see
  // DECISIONS.md) — these previously had no structured home and fell into
  // `notes` free text, which is why they never surfaced on the investor
  // profile. All plain text: aum/current_funds/latest_fund/last_investment_found
  // are narrative (mixed currencies, fund names, not clean numbers) by
  // design, never parsed/converted. key_people/general_partner_emails are
  // "Name — Role" / "name@firm.com" lists, pipe-separated, matching the
  // research prompt's own output shape.
  key_people?: string;
  general_partner_emails?: string;
  aum?: string;
  current_funds?: string;
  latest_fund?: string;
  last_investment_found?: string;
  stage_min?: Stage;
  stage_max?: Stage;
  check_min_eur?: number;
  check_max_eur?: number;
  sectors: string[];
  hardware_stance?: string;
  is_sector_agnostic?: boolean;
  thesis?: string;
  fit_score?: FitScore;
  wave?: number;
  our_angle?: string;
  the_ask?: string;
  submission_channel?: string;
  submission_channel_type: SubmissionChannelType;
  hard_filter?: string;
  hard_filter_status: HardFilterStatus;
  // Prompt 273 §3 — only ever set while hard_filter_status is
  // 'resolved_blocked'; cleared back to undefined the moment it isn't
  // (resolved_ok, or Unblock back to 'open'). hard_filter_resolved_by is
  // the literal 'demo' in demo mode (matches InteractionEdit.edited_by),
  // a real auth.users id when Supabase-backed. Migration 0194.
  hard_filter_resolved_at?: string;
  hard_filter_resolved_by?: string;
  // Prompt 285 §3 — migration 0200. Undefined on every row predating that
  // migration and on every self-report before this prompt; the app treats
  // missing the same as 'self_report' (the only thing that could have set
  // resolved_blocked before cross-org aggregation existed). Only
  // 'platform_action' changes HardFilterBanner's copy — this org's founder
  // never filed the report that landed on their own entities row.
  hard_filter_block_source?: 'self_report' | 'platform_action';
  network_cluster_notes?: string;
  // General freeform entity notes — distinct from network_cluster_notes
  // (which is specifically dedup/network-clustering commentary). Migration
  // 0021; used today by the needs-review metadata-card routine to file the
  // full original text of a detected contact card.
  notes?: string;
  interest_eur?: number;
  contact_lock_until?: string; // ISO
  status: EntityStatus;
  dormant_since?: string;
  dormant_reason?: string;
  last_verified?: string; // ISO
  source_url?: string;
  // Reopen doctrine (§9c): a `dormant` entity's earlier pass, and what would
  // have to change for a re-approach to be legitimate — cited verbatim in
  // any reopening draft. reopen_eligible_after is an optional earliest-retry
  // date for phase/traction-type passes; left unset for thesis/mandate-type
  // passes that reopen on a positioning change instead of a date.
  reopen_trigger?: string;
  reopen_eligible_after?: string; // ISO date
  // §11d misalignment alert — capability-gated, see src/lib/company-canon.ts
  alignment_status?: EntityAlignmentStatus;
  alignment_notes?: string;
  alignment_assessed_at?: string;
  // Plan-based catalog visibility (migration 0042, DECISIONS.md). 'catalog'
  // rows are subject to the org's accumulated plan quota (enforced by RLS —
  // a row the API ever returns to this client is, by construction, already
  // unlocked); 'manual' (submitInvestor / "+ Add investor" / history
  // imports) and 'match_deal' (not wired yet) are always unlocked and
  // additional to the quota. Every entity that existed before this
  // migration is 'manual'.
  source: 'catalog' | 'manual' | 'match_deal' | 'investor_invite';
  // §1c(ii) — set by human review only, never inferred (prompt 42): this
  // entity has no proof of its own independent existence (no website/
  // email_domain/phone/address, or a source_url that documents something
  // else, not this specific entity). See relationship.ts's
  // isUnverifiedStub — a thin accessor, not a derivation, because telling
  // "real evidence" apart from "evidence that doesn't actually prove this
  // entity" needs a human judgment call.
  unverified_stub_at?: string;
}

export interface Person {
  id: string;
  entity_id: string;
  full_name: string;
  role?: string;
  seniority_rank: number;
  based_in?: string;
  linkedin_url?: string;
  linkedin_verified: boolean;
  email_verified?: string;
  email_guess?: string;
  email_guess_confidence?: 'high' | 'medium' | 'low';
  email_source?: string;
  bounce_count: number;
  phone?: string;
  background?: string;
  personal_notes?: string;
  linked_companies: string[];
  linked_funds: string[];
  hook?: string;
  hook_status: HookStatus;
  kill_words: string[];
  watch_outs?: string;
  preferred_language: 'en' | 'pt';
  intro_path?: string;
  referred_by?: string;
  data_source?: string;
  privacy_notice_sent: boolean;
  do_not_contact: boolean;
  // Batch 2 item 3 — quick-create from /log. gender is free text (only
  // ever set by explicit founder input for a specific real person they
  // know, for Portuguese grammatical address — never inferred). Migration
  // 0024, capability-gated: src/lib/entity-contact-capability.ts.
  gender?: string;
  // Distinct from linkedin_verified (which is only about the LinkedIn URL)
  // — this is general identity confidence. Optional/absent reads as true
  // (matches the DB's "not null default true" — every existing/imported
  // person is verified without needing every seed/fixture touched); only a
  // newly quick-created row is ever explicitly inserted with false.
  identity_verified?: boolean;
}

// IRM_SPEC §1c — additive multi-affiliation layer. entity_id stays the
// person's primary/home entity above; this is everything else.
export type AffiliationKind =
  | 'partner' | 'principal' | 'associate' | 'operator'
  | 'angel' | 'advisor' | 'board_member' | 'other';

export interface PersonAffiliation {
  id: string;
  person_id: string;
  entity_id?: string; // undefined + kind 'angel' = independent angel activity
  title?: string;
  kind: AffiliationKind;
  current: boolean;
  started_at?: string;
  ended_at?: string;
  // IRM_SPEC §9b-4 — approach order lives per-affiliation now, not just on
  // the person's base entity_id: seniority_rank orders multiple people at
  // the same affiliation; is_primary flags which affiliation should
  // actually drive outreach when it differs from the base entity_id.
  seniority_rank?: number;
  is_primary?: boolean;
  notes?: string;
}

export interface Interaction {
  id: string;
  entity_id: string;
  person_id?: string;
  occurred_at: string;
  direction: Direction;
  channel: Channel;
  sent_from?: string;
  content: string;
  document_id?: string;
  classification?: Classification;
  pass_reason_category?: PassReasonCategory;
  pass_reason?: string;
  next_action?: string;
  next_action_due?: string;
  // Prompt 202 §D — quanto foi pedido NESTE contacto. Por interação e não
  // por entidade de propósito: o valor muda ao longo de uma ronda, e o que
  // interessa quando eles respondem meses depois é o que lhes foi pedido na
  // altura. Opcional — não se inventa um número que o founder não registou.
  ask_amount_eur?: number;
  automation_run_id?: string;
  ai_generated?: boolean;
  // Real DB column since migration 0018 (interactions_needs_review), only
  // just surfaced in the type — set true for imported history rows whose
  // original coloring (e.g. a positive/green marker) was lost in an export
  // and needs a human to confirm the true outcome.
  needs_review?: boolean;
  // Migration 0021 — set when a needs_review resolution was applied by the
  // pre-classification pass rather than a human: 'mechanical' for the
  // deterministic no-AI-call cases (obvious metadata cards, unanswered
  // outbound threads), 'ai' for a high-confidence model proposal. Always
  // cleared back to undefined the moment a human reclassifies (see
  // classifyInteraction) — it marks "who decided this currently stands",
  // not a permanent history of who first touched the row.
  classified_by?: 'ai' | 'mechanical';
  // Prompt 361 — the two fields the Dashboard's era classifier needs.
  // Real DB columns since migration 0011 (source, default 'manual') and
  // 0001 (created_at); only just surfaced on the type, same as Org.created_at
  // above — the store's `select('*')` already passes both through untyped.
  // `source === 'import'` marks a row that came in via the history import
  // (§9d/§9f), regardless of what occurred_at claims.
  source?: 'manual' | 'import';
  created_at?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  due_at?: string;
  entity_id?: string;
  person_id?: string;
  kind: TaskKind;
  action_type: ActionType;
  done: boolean;
  // Prompt 65 Bloco 4 — 'suggested' when accepted as-is (or edited before
  // accepting) from the relationship engine's next-action suggestion,
  // 'manual' when the founder typed it themselves from scratch. Undefined
  // for every task created before this shipped. Prompt 220 §B widens the
  // type to the two server-created values migration 0132 already allows
  // ('investor_interest', 'interest_level_request') — they always existed
  // in the rows the store loads (select '*'); the type just didn't admit
  // them, so TodayPanel couldn't branch on them.
  source?: 'suggested' | 'manual' | 'investor_interest' | 'interest_level_request' | 'document_request';
  // Prompt 126 D — free-text detail from the "create appointment" modal
  // (migration 0123, propose-only). `reminder_at` is when the in-workspace
  // popup should next fire for this task; cleared by Dismiss (explicit
  // `null`, not `undefined` — Supabase's client drops `undefined` keys
  // before the request even goes out, so a real clear needs `null`).
  // `snoozed_until` pushes that firing back without touching `reminder_at`
  // itself (Snooze 10min/1h/tomorrow). Both absent for every task before
  // this shipped, and for every task created while migration 0123 isn't
  // applied yet.
  notes?: string | null;
  reminder_at?: string | null;
  snoozed_until?: string | null;
  // Prompt 398 §3 — reminder_muted: "stop reminding for this investor"
  // (§3.2.2), distinct from Dismiss (which only clears reminder_at until
  // the next sweep resets it) — the sweep skips a muted task forever, the
  // request itself stays pending. last_reminded_at: when the sweep last
  // set reminder_at, independent of Dismiss/Snooze, so "have >=2 days
  // passed since the last reminder" doesn't conflate with "was it
  // dismissed".
  reminder_muted?: boolean;
  last_reminded_at?: string | null;
}

// Prompt 212 §B.1 — capital JÁ levantado, separado da ronda actual
// (orgs.round_secured_eur). Existe porque não existia: os €100k de uma ronda
// antiga da ablute_ estavam guardados como `interest_eur` de uma entrada do
// pipeline, por não haver outro sítio, e o review somava-os como
// soft-circled DESTA ronda.
// Prompt 219 — o vocabulário do motor de narrativa. Classe 1 é a MAIS forte
// (compromisso pago); a ordem numérica é a da hierarquia acordada, não uma
// escala "maior = melhor".
export type EvidenceClass = 1 | 2 | 3 | 4 | 5;
export type ClaimCategory =
  | 'problema' | 'solucao' | 'prova_tecnica' | 'validacao_externa'
  | 'tracao_gtm' | 'equipa' | 'mercado_timing' | 'funding' | 'ask';
export type ClaimSpecificity = 'high' | 'medium' | 'low';
// Prompt 360 Part A — 'web_research': a founder accepted a Sherlock research
// item (migration 0241). Deliberately distinct from 'vault_doc' (which
// specifically routes through Vault-visibility checks elsewhere, e.g.
// mini-pitch.ts's filterEligibleClaims — a web-sourced claim must never go
// through that) and from 'fact' (no documented meaning distinct from
// founder_answer).
export type ClaimSourceKind =
  | 'fact' | 'vault_doc' | 'roadmap' | 'profile' | 'funding_round' | 'founder_answer' | 'web_research';

// Prompt 219 bloco 2 — o claim PERSISTIDO (espelho client-side da linha de
// company_claims, migração 0176): o que as regras de deteção de lacunas
// recebem. Difere do NormalizedClaim do bloco 1 (o átomo acabado de
// classificar) por ter identidade, status e datas — o ciclo de vida.
export type ClaimStatus = 'proposed' | 'accepted' | 'rejected';

// Prompt 313 §B — a mechanical link from a claim to the Vault document (and
// page) that backs it, produced by document-extraction-linking.ts. A real DB
// column (company_claims.document_refs, migration 0208) — unlike
// possibleDuplicateOf below, this IS persisted: extraction is expensive and
// rare, claims are read on every page load, so the match is computed once
// and stored rather than recomputed per request.
export interface DocumentRef {
  documentId: string;
  documentName: string;
  page: number | null;
}

export interface CompanyClaim {
  id: string;
  category: ClaimCategory;
  statement: string;
  evidenceClass: EvidenceClass;
  specificity: ClaimSpecificity;
  sourceKind: ClaimSourceKind;
  sourceRef?: string | null;
  status: ClaimStatus;
  updatedAt?: string;
  // Prompt 311 §C — NEVER a DB column: recomputed on every GET
  // /api/blueprint (findDuplicateCandidate) so it always reflects the
  // current claims, not a value frozen at ingestion time. Only ever set on
  // a 'proposed' claim; absent everywhere else.
  possibleDuplicateOf?: { id: string; statement: string } | null;
  documentRefs?: DocumentRef[];
  // Prompt 358 Phase 1 — a founder decision about THIS claim's evidence
  // story that closes a gap without ever creating a second claim to hold
  // it (migration 0234). See gap-disposition-related comments in
  // company-gaps.ts for exactly which gaps read this and how.
  gapDisposition?: 'no_document' | 'document_pending' | 'confirmed' | null;
  // Prompt 374 §C — "Está bem assim": the founder dismissed this claim's
  // strengthen suggestion permanently, without touching its status or text
  // (migration 0245). Null/undefined means never dismissed.
  strengthenDismissedAt?: string | null;
}

// Prompt 213 §D — item estruturado do roadmap (items_v2 na 0177).
// category_id null = "General"; um id que nao resolve le-se como General
// (e o que torna apagar categorias seguro sem triggers).
export interface RoadmapItemV2 {
  text: string;
  category_id: string | null;
}

export interface RoadmapCategory {
  id: string;
  org_id?: string;
  label: string;
  color: string;
  shape: string;
  // Prompt 382 — founder-controlled, persistent. false hides this
  // category's lane and events from BOTH the founder canvas and the
  // investor dossier. Never present on the investor-facing projection
  // (RoadmapCategoryFull) — an investor never needs to know a category IS
  // toggleable, only receives what's already on.
  visible: boolean;
  created_at?: string;
}

export interface FundingRound {
  id: string;
  org_id?: string;
  label: string;
  amount_eur: number;
  closed_year?: number;
  // Prompt 327 Pedido B — WHO invested. Free text (no real catalog link
  // required), because most previous-round investors predate this app's
  // own catalog entirely — same "texto livre" reasoning as `label` itself.
  investor_name?: string;
  note?: string;
  created_at?: string;
}

export interface RelationshipState {
  entity_id: string;
  stage: RelationshipStage;
  next_step_task_id?: string;
  updated_at: string;
}

export interface RuleOverride {
  id: string;
  rule: OverrideRule;
  entity_id?: string;
  person_id?: string;
  interaction_id?: string;
  justification: string;
  created_at: string;
}

// P78 — real DB column (migration, portal section grouping) since before
// this session; only just surfaced in the type. CHECK-constrained in the
// DB to these 6 values; a folder predating that constraint (or never
// assigned one) reads as undefined here, grouped as "Uncategorized" by
// PeopleAccessPanel rather than dropped.
export type PortalSection = 'start_here' | 'product_market' | 'traction_commercial' | 'financial' | 'team_governance' | 'round_terms';

export interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  kind: FolderKind;
  position: number;
  portal_section?: PortalSection;
}

export interface DocumentItem {
  id: string;
  folder_id?: string;
  name: string;
  version?: string;
  storage_path?: string;
  external_url?: string;
  is_view_only: boolean;
  visibility: DocVisibility;
  watermark: boolean;
  downloadable: boolean;
  notes?: string;
  created_at?: string; // ISO — real DB column (migration 0001) since day one, only just surfaced in the type
  // Data Room V2 (F1) — what it contains, version, who it was prepared for.
  // Migration 0022, capability-gated: src/lib/data-room-capability.ts.
  details?: string;
  // Data Room v3 (E5) — persisted sort order within a folder. Migration 0027,
  // capability-gated: src/lib/document-ordering-capability.ts.
  position?: number;
  // Prompt 301 §3 — mirrors the CURRENT version's scan status (migration
  // 0205). 'not_scanned' is a real, honest value — never assume 'clean' for
  // a document created before this existed. Capability-gated:
  // src/lib/upload-security-capability.ts.
  // Prompt 375 — 'local_only' added: validated locally (magic bytes, type,
  // size) with no external verdict, because this app never submits a
  // private document's content to a third party. The normal outcome for a
  // founder-specific file, not a lesser one — see upload-security.ts's header.
  malware_scan_status?: 'not_scanned' | 'pending' | 'clean' | 'local_only' | 'flagged';
  malware_scan_provider?: string | null;
}

// E7 — Google-Drive-style version history for a document. The document row's
// storage_path always points at the CURRENT version (so portal/signed URLs
// serve current automatically); this table is the immutable history. "Restore"
// appends a NEW version pointing at an old object — never a deletion.
// Migration 0029, capability-gated: src/lib/document-versions-capability.ts.
export interface DocumentVersion {
  id: string;
  document_id: string;
  version: number;
  storage_path: string;
  size?: number;
  uploaded_at: string;
  uploaded_by?: string;
  // Prompt 301 §3 — migration 0205. See documents.malware_scan_status above.
  malware_scan_status?: 'not_scanned' | 'pending' | 'clean' | 'local_only' | 'flagged';
  content_sha256?: string;
}

// Data Room V2 (F5) — a real signed NDA file, attached to the investor's own
// record (entity/person) with an AI cross-check verdict. Capability-gated:
// src/lib/data-room-capability.ts, migration 0023.
export type NdaMatchStatus = 'pending' | 'match' | 'mismatch' | 'uncertain';

export interface Nda {
  id: string;
  person_id?: string;
  entity_id?: string;
  grantee_email?: string;
  storage_path: string;
  file_name?: string;
  uploaded_at: string;
  uploaded_by?: string;
  match_status: NdaMatchStatus;
  match_notes?: string;
}

export interface AccessGrant {
  id: string;
  person_id?: string;
  grantee_email?: string;
  folder_id?: string;
  document_id?: string;
  granted_at: string;
  expires_at?: string;
  revoked_at?: string;
  nda_required: boolean;
  nda_accepted_at?: string;
  note?: string;
  // Grant Access rebuild (prompt 33 part 2, migration 0045). Set only by
  // the founder "+ Invite someone new" flow — never for a grant to an
  // already-known person. Status is derived, not stored: see grantStatus()
  // in src/lib/access-grants.ts.
  invited_email?: string;
  invited_name?: string;
  confirmed_at?: string;
  self_verified?: boolean;
  // Item 1 (Lote E) — migration 0114's guest-access columns, filled at
  // invite time so an invitee can preview the data room before creating an
  // account. Cleared (not the row itself) once the account is created and
  // the grant confirmed — see /api/portal/confirm-identity.
  guest_token?: string | null;
  guest_token_expires_at?: string | null;
}

export interface DocumentView {
  id: string;
  document_id: string;
  grant_id?: string;
  viewer_email?: string;
  viewed_at: string;
  seconds?: number;
  pages?: number;
}

export interface MessageTemplate {
  id: string;
  name: string;
  channel: Channel;
  language: 'en' | 'pt';
  body: string;
}

export interface Automation {
  id: string;
  name: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  mode: AutomationMode;
  channel?: Channel;
  template_id?: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface AutomationRun {
  id: string;
  automation_id: string;
  entity_id?: string;
  person_id?: string;
  status: RunStatus;
  payload: { draft?: string; note?: string; channel?: Channel; subject?: string };
  blocked_reason?: string;
  error?: string;
  created_at: string;
  executed_at?: string;
}

export interface AiReview {
  id: string;
  document_id?: string;
  interaction_draft?: string;
  kind: AiReviewKind;
  status: 'pending' | 'done' | 'error';
  result?: unknown;
  model?: string;
  created_at: string;
}

// ===== IRM_SPEC §11 — COMPANY CANON =====
// Capability-gated: only meaningful once migration 0020 is applied (see
// src/lib/company-canon.ts). Fields mirror the company_facts table exactly.
export type CompanyFactCategory =
  | 'product' | 'traction' | 'team' | 'positioning' | 'financing' | 'regulatory' | 'market' | 'metrics' | 'other';
export type CompanyFactStatus = 'confirmed' | 'unconfirmed' | 'deprecated';
export type CompanyFactSource = 'user' | 'import' | 'ai_extracted';

// Prompt 251/253 Bloco A — the structured, comparable layer of the reopen
// doctrine (migration 0184). axis_code is free text on purpose: the
// taxonomy grows from real use, no fixed enum. Coexists with
// interactions.pass_reason_category, never replaces it.
export interface RejectionCode {
  id: string;
  entity_id: string;
  axis_code: string;
  required_level: number;
  level_label: string;
  source_interaction_id?: string;
  created_at: string;
}

// Prompt 251/253 Bloco B — the startup's own position on a rejection axis
// (migration 0184, schema landed in Bloco A). Read by
// rejection-code-match.ts for any axis_code that isn't one of the
// structured ones (stage/sector/geography, which read live org/entity
// fields instead). Still no writer as of Bloco B — a free-text axis
// simply never clears until a later block adds a way to confirm one; that
// gap is real and stated, not silently papered over.
export interface OrgAxisClassification {
  id: string;
  axis_code: string;
  level: number;
  level_label: string;
  source_fact_id?: string;
  confirmed_at: string;
}

// Prompt 252 — audit trail for manual interaction edits (occurred_at/
// channel/content), one row per field changed. edited_by is 'demo' in
// demo mode (no auth.users row exists there — never a fabricated
// identity), a real auth.users id otherwise.
export interface InteractionEdit {
  id: string;
  interaction_id: string;
  field: 'occurred_at' | 'channel' | 'content';
  old_value: string | null;
  new_value: string | null;
  edited_by: string | null;
  edited_at: string;
}

// Prompt 397 §C.3 — N attachments per logged interaction. Mirrors
// AccessGrant's own document_id/folder_id shape (exactly one set per row)
// rather than a single polymorphic column + a redundant `kind` flag that
// could drift out of sync with which FK is actually populated.
// interactions.document_id (singular) stays for back-compat, filled with
// the first document attachment when there is one.
export interface InteractionDocument {
  id: string;
  interaction_id: string;
  document_id?: string;
  folder_id?: string;
  created_at: string;
}

export interface CompanyFact {
  id: string;
  category: CompanyFactCategory;
  statement: string;
  status: CompanyFactStatus;
  source: CompanyFactSource;
  source_ref?: string;
  valid_from?: string; // ISO date
  superseded_by?: string;
  confirmed_at?: string;
  confirmed_by?: string;
  created_at: string;
  updated_at: string;
}

// §11d misalignment alert verdict, stored on the entity row.
export type EntityAlignmentStatus = 'aligned' | 'caution' | 'misaligned';

// ===== v3: platform catalog, packs, back-office =====
export type CatalogVerification = 'verified' | 'pending' | 'rejected';
export type SubmissionStatus = 'pending_review' | 'approved' | 'rejected' | 'merged';

export interface CatalogEntity {
  id: string;
  name: string;
  type: EntityType;
  hq_city?: string;
  hq_country?: string;
  sectors: string[];
  stage_min?: Stage;
  stage_max?: Stage;
  check_min_eur?: number;
  check_max_eur?: number;
  thesis?: string;
  website?: string;
  verification_status: CatalogVerification;
  verified_at?: string;
  source: 'team' | 'user_submission';
  notes?: string;
  // Prompt 123 Block C.2 (account_moderation) — 'active' | 'suspended' |
  // 'deleted'. Prompt 285 §3 is the first reader in either delivery path
  // (unlockPack here, deliverMonthlyForOrg server-side): a suspended/
  // deleted catalog entity must stop reaching NEW orgs, confirmed by grep
  // that neither path read this column before.
  moderation_status?: string;
}

export interface Pack {
  id: string;
  name: string;
  description: string;
  price_eur: number; // charged later; free during development
  catalog_ids: string[];
}

export interface PackUnlock {
  id: string;
  pack_id: string;
  unlocked_at: string;
  // deliveries: catalog ids actually copied into the org pipeline at unlock time
  delivered_catalog_ids: string[];
}

export interface InvestorSubmission {
  id: string;
  payload: {
    name: string;
    type: EntityType;
    hq_city?: string;
    hq_country?: string;
    sectors: string[];
    website?: string;
    notes?: string;
  };
  submitted_by: string; // org name (multi-tenant: org_id)
  status: SubmissionStatus;
  reviewer_notes?: string;
  created_at: string;
  reviewed_at?: string;
}

// F — fact-triggered reawakening. When a canon fact is confirmed (the ONLY
// trigger), dormant/passed entities with a reopen_trigger are mechanically
// shortlisted and evaluated by ONE batched AI call. Every evaluated
// (fact_id, entity_id) pair gets a row here (unique) — reopens:true → 'pending'
// (surfaced in the Pipeline queue), reopens:false → 'dismissed' (evaluated,
// never re-proposed). Approve → entity returns to active + agenda task; reject
// → 'rejected'. Migration 0030, capability-gated:
// src/lib/reawakening-capability.ts. NO cron/periodic scan ever.
export type ReawakeningStatus = 'pending' | 'approved' | 'rejected' | 'dismissed';
// Prompt 271 §3 — a third origin, 'neglect' (stand_by — no fact, no
// rejection code, just a thread that went quiet; Sherlock-evaluated
// on-demand). Migration 0192 replaces 0186's 2-way XOR with an explicit
// column + a 3-way consistency check; optional here (undefined pre-
// migration) same as every other propose-only field in this codebase.
export type ReawakeningTriggerKind = 'fact' | 'rejection_code' | 'neglect';
// Prompt 272 — the adviser-quality breakdown for a 'neglect' proposal
// (migration 0193). Never set for the other two origins. respondTo is a
// list because the prompt's own real case (ECS Capital) had multiple
// pending questions, each needing its own answer, not one merged
// paragraph. Exactly one of newHook/holdReason is ever set: a real new
// hook (grounded in company_facts, never invented) means ready to draft
// now; its absence means "not yet" with a concrete holdReason instead —
// "an adviser worth listening to also says 'not yet'" (the prompt's own
// framing). personId is resolved via nextContactPerson (relationship.ts,
// deterministic, seniority doctrine) — the AI never picks the person.
export interface NeglectAdvice {
  acknowledge: string;
  respondTo: { question: string; answer: string }[];
  newHook?: string;
  holdReason?: string;
  channel?: string;
  personId?: string;
  personName?: string;
  timing?: string;
}
export interface ReawakeningProposal {
  id: string;
  // Prompt 251/253 Bloco B — exactly one of fact_id/rejection_code_id is
  // ever set (DB-enforced XOR, migration 0186): the two triggers for this
  // same queue — a confirmed company fact (AI-judged), or a deterministic
  // rejection-code comparison (no AI at all). Prompt 271 §3 — a third
  // origin (trigger_kind='neglect') sets NEITHER: no fact, no rejection
  // code, just entity_id (already required below).
  fact_id?: string;
  rejection_code_id?: string;
  trigger_kind?: ReawakeningTriggerKind;
  entity_id: string;
  reopens: boolean;
  rationale?: string;
  suggested_wave?: number;
  suggested_fit?: FitScore;
  prior_pass_reason?: string;
  prior_pass_category?: PassReasonCategory;
  fact_statement?: string; // snapshot of the triggering fact, for the queue UI
  advice?: NeglectAdvice; // Prompt 272 — trigger_kind='neglect' only, migration 0193
  status: ReawakeningStatus;
  created_at: string;
  resolved_at?: string;
}

// Prompt 415 §1 — "Leave for later" on one Sherlock Next Clue candidate.
// Exactly one of task_id/entity_id/interaction_id/person_id is set,
// matching whichever natural key that step's kind already identifies its
// candidate by (migration 0261's own check constraint). `kind` stays a
// plain string here rather than SherlockNextKind (sherlock-next.ts) to
// avoid a circular import — this file is the domain-types source of
// truth sherlock-next.ts itself imports Db FROM.
export interface SherlockNextSnooze {
  id: string;
  kind: string;
  task_id?: string;
  entity_id?: string;
  interaction_id?: string;
  person_id?: string;
  snoozed_until: string;
}

export interface Db {
  catalog: CatalogEntity[];
  packs: Pack[];
  unlocks: PackUnlock[];
  submissions: InvestorSubmission[];
  org: Org;
  entities: Entity[];
  people: Person[];
  personAffiliations: PersonAffiliation[];
  interactions: Interaction[];
  tasks: TaskItem[];
  relationshipState: RelationshipState[];
  overrides: RuleOverride[];
  folders: Folder[];
  documents: DocumentItem[];
  grants: AccessGrant[];
  views: DocumentView[];
  templates: MessageTemplate[];
  automations: Automation[];
  runs: AutomationRun[];
  aiReviews: AiReview[];
  companyFacts: CompanyFact[];
  companyPeople: CompanyPerson[];
  tractionMetrics: TractionMetric[];
  ndas: Nda[];
  documentVersions: DocumentVersion[];
  reawakeningProposals: ReawakeningProposal[];
  roadmapMilestones: RoadmapMilestone[];
  fundingRounds: FundingRound[];
  roadmapCategories: RoadmapCategory[];
  roadmapEvents: RoadmapEvent[];
  rejectionCodes: RejectionCode[];
  interactionEdits: InteractionEdit[];
  orgAxisClassifications: OrgAxisClassification[];
  interactionDocuments: InteractionDocument[];
  sherlockNextSnoozes: SherlockNextSnooze[];
}

// ---------------------------------------------------------------------------
// Prompt 316 — My Network. Cross-org by nature (a connection spans two
// different orgs, or an org and an investor), so — unlike everything above —
// this is never part of the per-org `Db` shape: it's fetched via dedicated
// /api/network/* routes (service-role), never the browser client directly.
// See src/lib/network.ts (pure rules) and src/lib/network-db.ts (adapter).
export type NetworkActorKind = 'founder' | 'investor';

// A network_actors row. Exactly one of orgId/matchdealProfileId is set,
// mirroring usage_sessions' own dual-identity precedent (migration 0203) —
// see the migration's own header for why a third identity isn't introduced.
export interface NetworkActor {
  id: string;
  orgId?: string | null;
  matchdealProfileId?: string | null;
}

export type NetworkConnectionStatus = 'active' | 'removed' | 'blocked';

export interface NetworkConnection {
  id: string;
  actorLowId: string;
  actorHighId: string;
  status: NetworkConnectionStatus;
  blockedByActorId?: string | null;
  originContext?: string | null;
  createdAt: string;
}

export type NetworkInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';
// Prompt 316 only ever produces 'shared_investor'; later prompts in the
// series (317 groups, 318 referrals) add more without touching this type's
// existing members. Prompt 330 adds 'direct_known' — the one value with no
// automatically-verifiable signal behind it; the required `message` field
// below carries the founder's own human explanation instead, always shown
// to the recipient before they accept (see migration 0222's own comment).
// Prompt 335 adds 'directory' (found via the discoverable-founders search,
// §D2) and 'connect_link' (created by opening someone's personal connect
// link, §D3a) — see migration 0223.
export type NetworkInviteContextKind = 'shared_investor' | 'shared_group' | 'referral' | 'direct_known' | 'directory' | 'connect_link';

export interface NetworkInvite {
  id: string;
  fromActorId: string;
  toActorId: string;
  contextKind: NetworkInviteContextKind;
  contextRef?: string | null;
  message: string;
  status: NetworkInviteStatus;
  expiresAt: string;
  createdAt: string;
  respondedAt?: string | null;
  // Prompt 317 — set only for a group-join invite; accepting inserts into
  // network_group_members instead of network_connections. Absent/null for
  // every ordinary 1:1 connection invite (316).
  groupId?: string | null;
}

export type NetworkGroupKind = 'accelerator_batch' | 'investor_portfolio' | 'topic';
export type NetworkGroupMemberStatus = 'invited' | 'active' | 'left';

export interface NetworkGroup {
  id: string;
  name: string;
  description?: string | null;
  kind: NetworkGroupKind;
  ownerActorId: string;
  createdAt: string;
}

export interface NetworkGroupMember {
  id: string;
  groupId: string;
  actorId: string;
  addedByActorId: string;
  status: NetworkGroupMemberStatus;
  joinedAt?: string | null;
  createdAt: string;
}

// Prompt 318 — referrals. See network.ts's NetworkReferralState for the
// state machine and the central "never visible to target before referred
// consent" guarantee.
export type NetworkReferralState = 'pending_referred_consent' | 'pending_target_decision' | 'accepted' | 'declined_by_referred' | 'declined_by_target';

export interface NetworkReferral {
  id: string;
  referrerActorId: string;
  referredOrgId: string;
  targetActorId: string;
  message: string;
  state: NetworkReferralState;
  createdAt: string;
  referredDecidedAt?: string | null;
  targetDecidedAt?: string | null;
}
