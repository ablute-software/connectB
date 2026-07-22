// ablute_ Investor CRM — domain types (mirror of supabase/migrations/0001_init.sql)

export type EntityType =
  | 'vc' | 'corporate_vc' | 'family_office' | 'angel_fund'
  | 'angel_network' | 'public_body' | 'accelerator';
export type Stage = 'pre_seed' | 'seed' | 'series_a' | 'later';
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
export type DocVisibility = 'private' | 'on_grant' | 'link_anyone';
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
export type PlanTier = 'free' | 'paid';
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

export interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  kind: FolderKind;
  position: number;
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
}
