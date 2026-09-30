// Prompt I-01 — Incubadoras, Fase 1: the pure half (no I/O, safe on the
// client). The enforcement lives in SQL (migration
// 20260930150000_incubators_foundation.sql); everything here either mirrors
// a SQL rule for the UI and the tests, or holds the literal copy the prompt
// fixes. Concept: docs/incubadoras/v4-conceito-decisoes-20260930.md.

export type IncubatorKind = 'municipal' | 'university' | 'private_accelerator' | 'corporate' | 'pre_incubation' | 'other';
export type RelationshipStatus = 'active' | 'paused' | 'graduated' | 'ended';
export type InviteStatus = 'invited' | 'accepted' | 'declined' | 'expired' | 'revoked';
export type MemberRole = 'owner' | 'manager';
export type MemberStatus = 'invited' | 'active' | 'removed';
export type SharingLevel = 0 | 1 | 2 | 3 | 4;
export type EndedBy = 'founder' | 'incubator' | 'platform';

export const INCUBATOR_KINDS: { key: IncubatorKind; label: string }[] = [
  { key: 'municipal', label: 'Municipal / regional' },
  { key: 'university', label: 'Universitária / I&D' },
  { key: 'private_accelerator', label: 'Aceleradora privada' },
  { key: 'corporate', label: 'Programa corporate' },
  { key: 'pre_incubation', label: 'Pré-incubação / ideação' },
  { key: 'other', label: 'Outra' },
];

export function incubatorKindLabel(kind: string | null | undefined): string {
  return INCUBATOR_KINDS.find((k) => k.key === kind)?.label ?? 'Outra';
}

export const RELATIONSHIP_STATUS_LABEL: Record<RelationshipStatus, string> = {
  active: 'Activa',
  paused: 'Pausada',
  graduated: 'Graduada',
  ended: 'Terminada',
};

export const INVITE_STATUS_LABEL: Record<InviteStatus, string> = {
  invited: 'Pendente',
  accepted: 'Aceite',
  declined: 'Recusado',
  expired: 'Expirado',
  revoked: 'Revogado',
};

// v4 §5.1, literal. Levels 3 and 4 exist in the model and are shown, but are
// not selectable in Phase 1 (refinement of D19): level 3 cannot go through
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
  { level: 0, name: 'Ligada', label: '0 · Ligada', enabled: true,
    includes: 'nome, sector, fase, programa/turma, gestor' },
  { level: 1, name: 'Perfil', label: '1 · Perfil', enabled: true,
    includes: '+ perfil público, factos da empresa com fonte, roadmap' },
  { level: 2, name: 'Análise', label: '2 · Análise', enabled: true,
    includes: '+ Readiness review (SWOT, investability, plano de acção), histórico de readiness, escada IRL/TRL, a parte partilhada do registo de riscos' },
  { level: 3, name: 'Documentos', label: '3 · Documentos', enabled: false,
    includes: '+ documentos, um a um (grants do data room com um sujeito "incubadora")' },
  { level: 4, name: 'Angariação', label: '4 · Angariação', enabled: false,
    includes: '+ progresso da ronda declarado, pipeline (investidores, fase, razões de pass como o founder as registou)' },
];

export const DEFAULT_SHARING_LEVEL: SharingLevel = 1;
export const MAX_SELECTABLE_LEVEL = 2;

export const LEVEL_COMING_SOON_TEXT =
  'Disponível em breve — a partilha de documentos e da angariação chega com controlos próprios';

export function sharingLevelName(level: number): string {
  return SHARING_LEVELS.find((l) => l.level === level)?.name ?? `Nível ${level}`;
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

// ---------------------------------------------------------------------------
// Literal copy (I-01 §C.2/§C.4).

export function defaultLevelNotice(incubatorName: string): string {
  return `Ao aceitar, a ${incubatorName} passa a ver o teu perfil público, os factos da empresa com fonte e o roadmap (nível 1 · Perfil). Podes mudar isto a qualquer momento em Definições › Programas, e terminar a relação quando quiseres.`;
}

// D3 — shown before the accept button, and in Definições › Programas.
export const ALSO_INVESTS_NOTICE =
  'Esta organização também é investidora na Sherlock. O que partilhas aqui é para o programa, não para o comité de investimento; a plataforma não cruza os dois lados.';

export function endRelationshipConfirmText(incubatorName: string): string {
  return `A ${incubatorName} perde o acesso de imediato. Mantém os relatórios e notas que já produziu.`;
}

export const ACCESS_LOG_SURFACE_LABEL: Record<string, string> = {
  dossier_profile: 'Dossier · perfil',
  dossier_facts: 'Dossier · factos',
  dossier_roadmap: 'Dossier · roadmap',
  dossier_readiness: 'Dossier · readiness',
  dossier_documents: 'Dossier · documentos',
  dossier_round: 'Dossier · ronda',
  declaration: 'Declaração mensal',
  report: 'Relatório',
};

// ---------------------------------------------------------------------------
// Error codes returned by the SQL functions ({ok:false, error:<code>}).

const ERROR_TEXT: Record<string, string> = {
  not_signed_in: 'Entra na tua conta para continuar.',
  invite_not_found: 'Este convite não existe ou o link já foi substituído por um mais recente.',
  invite_expired: 'Este convite expirou. Pede à incubadora que o reenvie.',
  invite_revoked: 'Este convite foi revogado pela incubadora.',
  invite_declined: 'Este convite foi recusado.',
  invite_already_accepted: 'Este convite já foi aceite por outra conta.',
  incubator_closed: 'Esta incubadora já não está activa na plataforma.',
  no_open_org: 'Para aceitar precisas de uma conta de startup activa. Cria a conta da tua startup e volta a este link.',
  not_allowed: 'Não tens permissão para esta acção.',
  relationship_ended: 'Esta relação já terminou.',
  invalid_level: 'Nível inválido.',
  level_coming_soon: LEVEL_COMING_SOON_TEXT,
  reason_required: 'Indica a razão — o founder vai vê-la.',
  invalid_transition: 'Esta mudança de estado não é possível.',
  invalid_token: 'Não foi possível gerar um link novo.',
  invalid_email: 'E-mail inválido.',
  invalid_role: 'Papel inválido.',
  already_member: 'Esta pessoa já é membro da incubadora.',
  email_mismatch: 'Este convite foi enviado para outro e-mail. Entra com a conta desse e-mail.',
  last_owner: 'A incubadora precisa de pelo menos um owner.',
  name_required: 'O nome é obrigatório.',
  invalid_kind: 'Tipo de incubadora inválido.',
};

export function incubatorErrorText(code: string | null | undefined): string {
  if (!code) return 'Algo correu mal. Tenta de novo.';
  return ERROR_TEXT[code] ?? 'Algo correu mal. Tenta de novo.';
}

// ---------------------------------------------------------------------------
// Small helpers shared by routes and screens.

export function slugifyIncubatorName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'incubadora';
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
