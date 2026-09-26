// Prompt 737 §0B.1 — display labels for the 13 catalog_evidence.kind
// values (migration 0344's evidence_kind enum, verified against production
// 2026-09-25), EN/PT.
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
};

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
