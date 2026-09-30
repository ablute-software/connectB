// Prompt I-01 — Incubators, Phase 1: the pure half (no I/O, safe on the
// client). The enforcement lives in SQL (migration
// 20260930144202_incubators_foundation.sql); everything here either mirrors
// a SQL rule for the UI and the tests, or holds the literal copy the prompts
// fix. Concept: docs/incubadoras/v4-conceito-decisoes-20260930.md.
//
// Prompt I-01b §C — English, like the rest of the app (founder app, investor
// portal, back-office): there is no i18n layer, and incubators will not only
// be Portuguese. Funder reports (I-05) are documents and get PT/EN templates;
// the interface is English.

export type IncubatorKind = 'municipal' | 'university' | 'private_accelerator' | 'corporate' | 'pre_incubation' | 'other';
export type RelationshipStatus = 'active' | 'paused' | 'graduated' | 'ended';
export type InviteStatus = 'invited' | 'accepted' | 'declined' | 'expired' | 'revoked';
export type MemberRole = 'owner' | 'manager';
export type MemberStatus = 'invited' | 'active' | 'removed';
export type SharingLevel = 0 | 1 | 2 | 3 | 4;
export type EndedBy = 'founder' | 'incubator' | 'platform';

export const INCUBATOR_KINDS: { key: IncubatorKind; label: string }[] = [
  { key: 'municipal', label: 'Municipal / regional' },
  { key: 'university', label: 'University / R&D' },
  { key: 'private_accelerator', label: 'Private accelerator' },
  { key: 'corporate', label: 'Corporate programme' },
  { key: 'pre_incubation', label: 'Pre-incubation / ideation' },
  { key: 'other', label: 'Other' },
];

export function incubatorKindLabel(kind: string | null | undefined): string {
  return INCUBATOR_KINDS.find((k) => k.key === kind)?.label ?? 'Other';
}

export const RELATIONSHIP_STATUS_LABEL: Record<RelationshipStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  graduated: 'Graduated',
  ended: 'Ended',
};

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  invited: 'Pending',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  revoked: 'Revoked',
};

// v4 §5.1. Levels 3 and 4 exist in the model and are shown, but are not
// selectable in Phase 1 (refinement of D19): level 3 cannot go through
// access_grants (I-00 C.6) and level 4 needs the deal_terms fail-closed with
// its own tests.
export interface SharingLevelInfo {
  level: SharingLevel;
  name: string;
  label: string;
  includes: string;
  enabled: boolean;
}

export const SHARING_LEVELS: SharingLevelInfo[] = [
  { level: 0, name: 'Linked', label: '0 · Linked', enabled: true,
    includes: 'name, sector, stage, programme/cohort, manager' },
  { level: 1, name: 'Profile', label: '1 · Profile', enabled: true,
    includes: '+ public profile, sourced company facts, roadmap' },
  { level: 2, name: 'Analysis', label: '2 · Analysis', enabled: true,
    includes: '+ Readiness review (SWOT, investability, action plan), readiness history, IRL/TRL ladder, the shared part of the risk register' },
  { level: 3, name: 'Documents', label: '3 · Documents', enabled: false,
    includes: '+ documents, one by one' },
  { level: 4, name: 'Fundraising', label: '4 · Fundraising', enabled: false,
    includes: '+ declared round progress, pipeline (investors, stage, pass reasons as the founder logged them)' },
];

export const DEFAULT_SHARING_LEVEL: SharingLevel = 1;
export const MAX_SELECTABLE_LEVEL = 2;

export const LEVEL_COMING_SOON_TEXT =
  'Coming soon — sharing documents and fundraising arrives with its own controls';

export function sharingLevelName(level: number): string {
  return SHARING_LEVELS.find((l) => l.level === level)?.name ?? `Level ${level}`;
}

export function founderCanChooseLevel(level: number): boolean {
  return Number.isInteger(level) && level >= 0 && level <= MAX_SELECTABLE_LEVEL;
}

// Mirrors incubator_can_view(): active and graduated give live access at the
// shared level; paused and ended give none — no grace period (D6).
export function relationshipGivesAccess(status: RelationshipStatus, sharingLevel: number, requiredLevel: number): boolean {
  return (status === 'active' || status === 'graduated') && sharingLevel >= requiredLevel;
}

export function hasLiveAccess(status: RelationshipStatus): boolean {
  return status === 'active' || status === 'graduated';
}

// Mirrors the graduation trigger (D6b): on the transition to 'graduated' the
// level drops to 1 if it was above; it never rises.
export function levelAfterGraduation(level: number): number {
  return Math.min(level, 1);
}

// Mirrors incubator_set_status(): active ⇄ paused, active → graduated. Never
// to or from 'ended' — ending is its own function, and ended is final.
export function incubatorCanSetStatus(from: RelationshipStatus, to: RelationshipStatus): boolean {
  return (from === 'active' && (to === 'paused' || to === 'graduated')) || (from === 'paused' && to === 'active');
}

// Mirrors incubator_end_relationship(): the founder may end without a
// reason; the incubator must give one (the founder sees it).
export function endReasonRequired(side: 'founder' | 'incubator'): boolean {
  return side === 'incubator';
}

// Mirrors incubator_mask_email() (I-01b §A): "n…@startup.pt".
export function maskInviteEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = [email.slice(0, email.indexOf('@')), email.slice(email.indexOf('@') + 1)];
  return `${local.slice(0, 2)}…@${domain}`;
}

// Same comparison the SQL functions make (lower/trim on both sides).
export function inviteEmailMatches(invited: string | null | undefined, typed: string | null | undefined): boolean {
  if (!invited || !typed) return false;
  return invited.trim().toLowerCase() === typed.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Literal copy (I-01 §C.2/§C.4, as translated by I-01b §C).

export function defaultLevelNotice(incubatorName: string): string {
  return `By accepting, ${incubatorName} will see your public profile, your sourced company facts and your roadmap (level 1 · Profile). You can change this at any time in Settings › Programmes, and end the relationship whenever you want.`;
}

// D3 — shown before the accept button, and in Settings › Programmes.
export const ALSO_INVESTS_NOTICE =
  'This organisation is also an investor on Sherlock. What you share here is for the programme, not for the investment committee; the platform never joins the two sides.';

export function endRelationshipConfirmText(incubatorName: string): string {
  return `${incubatorName} loses access immediately. It keeps the reports and notes it has already produced.`;
}

// I-01b §B — shown to managers/members in Settings › Programmes.
export const PROGRAMS_READ_ONLY_NOTE = 'Only owners and admins can accept invites, change sharing or end a programme.';

// I-01b §A — the invite page when the signed-in address is not the invited one.
export function inviteEmailMismatchText(maskedEmail: string | null, incubatorName: string): string {
  return `This invite was sent to ${maskedEmail ?? 'another address'}. Sign in with that email, or ask ${incubatorName} to send the invite to the address you use.`;
}

export const ACCESS_LOG_SURFACE_LABEL: Record<string, string> = {
  dossier_profile: 'Dossier · profile',
  dossier_facts: 'Dossier · facts',
  dossier_roadmap: 'Dossier · roadmap',
  dossier_readiness: 'Dossier · readiness',
  dossier_documents: 'Dossier · documents',
  dossier_round: 'Dossier · round',
  declaration: 'Monthly update',
  report: 'Report',
};

// ---------------------------------------------------------------------------
// Error codes returned by the SQL functions ({ok:false, error:<code>}).

const ERROR_TEXT: Record<string, string> = {
  not_signed_in: 'Sign in to continue.',
  invite_not_found: 'This invite does not exist, or the link has been replaced by a newer one.',
  invite_expired: 'This invite has expired. Ask the incubator to resend it.',
  invite_revoked: 'This invite was revoked by the incubator.',
  invite_declined: 'This invite was declined.',
  invite_already_accepted: 'This invite has already been accepted by another account.',
  invite_email_mismatch: 'This invite was sent to a different email address.',
  incubator_closed: 'This incubator is no longer active on the platform.',
  no_open_org: 'To accept you need an active startup account. Create your startup account and come back to this link.',
  not_allowed: 'You do not have permission for this action.',
  not_org_admin: PROGRAMS_READ_ONLY_NOTE,
  relationship_ended: 'This relationship has already ended.',
  invalid_level: 'Invalid level.',
  level_coming_soon: LEVEL_COMING_SOON_TEXT,
  reason_required: 'Give a reason — the founder will see it.',
  invalid_transition: 'This status change is not possible.',
  invalid_token: 'Could not generate a new link.',
  invalid_email: 'Invalid email.',
  invalid_role: 'Invalid role.',
  already_member: 'This person is already a member of the incubator.',
  email_mismatch: 'This invite was sent to another email. Sign in with that email’s account.',
  last_owner: 'The incubator needs at least one owner.',
  name_required: 'The name is required.',
  invalid_kind: 'Invalid incubator type.',
};

export function incubatorErrorText(code: string | null | undefined): string {
  if (!code) return 'Something went wrong. Please try again.';
  return ERROR_TEXT[code] ?? 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Small helpers shared by routes and screens.

export function slugifyIncubatorName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'incubator';
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}

// The raw invite token travels in the URL path only — never in a query
// string (I-01 §C.2), so it never lands in the `next=` of a login redirect
// or a confirmation e-mail. The signup/login detour carries this fixed path
// instead; the token waits in the invitee's own browser storage.
export const INCUBATOR_INVITE_CONTINUE_PATH = '/invite/incubator/continue';
export const INCUBATOR_INVITE_STORAGE_KEY = 'sd_incubator_invite';
// Same idea for a TEAM invite: /incubator sends a signed-in non-member back
// to the pending member invite kept here.
export const INCUBATOR_MEMBER_INVITE_STORAGE_KEY = 'sd_incubator_member_invite';

export interface StoredIncubatorInvite {
  token: string;
  // I-01b (Nuno, 30/09) — the invite's address never reaches the browser in
  // full: only the masked form, for the hint and the mismatch message. The
  // signup asks the server (check-email) whether the typed address is the
  // invited one before creating the account.
  invitedEmailMasked?: string | null;
  incubatorName?: string | null;
  startupName?: string | null;
  sector?: string | null;
  website?: string | null;
  savedAt: number;
}

export function incubatorInvitePath(token: string): string {
  return `/invite/incubator/${encodeURIComponent(token)}`;
}

export function incubatorMemberInvitePath(token: string): string {
  return `/invite/incubator/member/${encodeURIComponent(token)}`;
}
