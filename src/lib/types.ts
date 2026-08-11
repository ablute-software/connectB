// ablute_ Investor CRM — domain types (mirror of supabase/migrations/0001_init.sql)

export type EntityType =
  | 'vc' | 'corporate_vc' | 'family_office' | 'angel_fund'
  | 'angel_network' | 'public_body' | 'accelerator';
// 'other' added for migration 0037 (Company tab redesign, Round card) — the
// enum only needed an escape hatch there; entities.stage_min/max never use
// it (investor stage ranges are always one of the original four).
export type Stage = 'pre_seed' | 'seed' | 'series_a' | 'later' | 'other';
export type FitScore = 'high' | 'medium_high' | 'medium' | 'low';
export type HardFilterStatus = 'open' | 'resolved_ok' | 'resolved_blocked' | 'not_applicable';
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
  | 'document_viewed' | 'hook_missing';
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
  type: EntityType;
  hq_city?: string;
  hq_country?: string;
  invests_in_geographies: string[];
  website?: string;
  website_verified: boolean;
  email_domain?: string;
  email_domain_verified: boolean;
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
  source: 'catalog' | 'manual' | 'match_deal';
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
  // for every task created before this shipped.
  source?: 'suggested' | 'manual';
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
export interface ReawakeningProposal {
  id: string;
  fact_id: string;
  entity_id: string;
  reopens: boolean;
  rationale?: string;
  suggested_wave?: number;
  suggested_fit?: FitScore;
  prior_pass_reason?: string;
  prior_pass_category?: PassReasonCategory;
  fact_statement?: string; // snapshot of the triggering fact, for the queue UI
  status: ReawakeningStatus;
  created_at: string;
  resolved_at?: string;
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
}
