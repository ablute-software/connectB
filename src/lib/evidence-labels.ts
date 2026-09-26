// Prompt 737 §0B.1 — display labels for catalog_evidence.kind values
// (migration 0344's evidence_kind enum, verified against production
// 2026-09-25), EN/PT. Extended §9.A (25/09/2026, Passo 3 schema) with the
// 3 values that migration 20260926172005 added: role_history, education,
// portfolio_relationship.
export const EVIDENCE_KIND_LABELS: Record<string, { en: string; pt: string }> = {
  bio: { en: 'Biography', pt: 'Biografia' },
  interview: { en: 'Interview', pt: 'Entrevista' },
  podcast: { en: 'Podcast', pt: 'Podcast' },
  talk_event: { en: 'Talk / event', pt: 'Palestra / evento' },
  article_authored: { en: 'Article authored', pt: 'Artigo da autoria' },
  article_about: { en: 'Article about them', pt: 'Artigo sobre' },
  statement: { en: 'Public statement', pt: 'Declaração pública' },
  press_release: { en: 'Press release', pt: 'Comunicado de imprensa' },
  investment: { en: 'Investment', pt: 'Investimento' },
  fund_announcement: { en: 'Fund announcement', pt: 'Anúncio de fundo' },
  social_post: { en: 'Social post', pt: 'Publicação em rede social' },
  photo: { en: 'Photo', pt: 'Fotografia' },
  other: { en: 'Other', pt: 'Outro' },
  role_history: { en: 'Career / board role', pt: 'Percurso / cargo' },
  education: { en: 'Education', pt: 'Formação' },
  portfolio_relationship: { en: 'Portfolio relationship', pt: 'Relação de portfolio' },
};

// role_type_kind enum (migration 20260926172020) — required exactly when
// kind='role_history', never set otherwise.
export const ROLE_TYPE_LABELS: Record<string, { en: string; pt: string }> = {
  employment: { en: 'Executive / employment', pt: 'Executivo / emprego' },
  board_advisory: { en: 'Board / advisory', pt: 'Conselho / consultivo' },
};

export function roleTypeLabel(roleType: string | null | undefined, lang: 'en' | 'pt' = 'en'): string | null {
  if (!roleType) return null;
  return ROLE_TYPE_LABELS[roleType]?.[lang] ?? roleType;
}

// catalog_person_research_log.scope (migration 20260926172020).
export const RESEARCH_SCOPE_LABELS: Record<string, { en: string; pt: string }> = {
  career: { en: 'Career', pt: 'Carreira' },
  education: { en: 'Education', pt: 'Formação' },
  board_seats: { en: 'Board seats', pt: 'Lugares em conselhos' },
  statements: { en: 'Public statements', pt: 'Declarações públicas' },
  interviews: { en: 'Interviews', pt: 'Entrevistas' },
  articles: { en: 'Articles', pt: 'Artigos' },
  podcasts: { en: 'Podcasts', pt: 'Podcasts' },
  events: { en: 'Talks / events', pt: 'Palestras / eventos' },
  topics: { en: 'Topics', pt: 'Temas' },
  portfolio: { en: 'Portfolio', pt: 'Portfolio' },
  personal_signals: { en: 'Personal signals', pt: 'Sinais pessoais' },
};

export function researchScopeLabel(scope: string, lang: 'en' | 'pt' = 'en'): string {
  return RESEARCH_SCOPE_LABELS[scope]?.[lang] ?? scope;
}

export function evidenceKindLabel(kind: string, lang: 'en' | 'pt' = 'en'): string {
  return EVIDENCE_KIND_LABELS[kind]?.[lang] ?? kind;
}

// §0B.1's own status mapping: `found` (the engine's own match, unreviewed)
// reads as "to confirm"; `verified` as "verified". `quarantined` (a
// founder's own proposal, still under review) is Fase 1 scope — not
// reachable from 0B's read-only dossier, since propose-evidence isn't
// wired here yet — but mapped anyway so this stays a total function should
// a caller ever see it.
const STATUS_LABEL: Record<string, string> = {
  found: 'To confirm',
  verified: 'Verified',
  quarantined: 'Proposed — under review',
  rejected: 'Rejected',
  erased: 'Erased',
};

export function evidenceStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}
