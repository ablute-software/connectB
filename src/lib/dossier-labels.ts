// Prompt "dossier de pessoa — passo 4 (UI)" — pure label/formatting helpers
// for the rich person dossier (`/catalog-people/[id]`). Kept separate from
// evidence-labels.ts (which only covers evidence_kind/evidence_status) so
// the new role_type/relation_kind/research_log vocabulary introduced by
// migrations 20260926172005/20260926172020 has one place to live, with its
// own tests, rather than being inlined into the page component.
//
// Absolute rule threaded through every function here (Nuno, this prompt):
// never invent precision the data doesn't have. A date with only
// year-level precision is never rendered as a full ISO date, an ambiguous
// role is never asserted as employment/board, and a research scope with no
// row in catalog_person_research_log is never rendered as "not found."

export const ROLE_TYPE_LABELS: Record<string, { en: string; pt: string }> = {
  employment: { en: 'Employment', pt: 'Cargo executivo' },
  board_advisory: { en: 'Board / advisory', pt: 'Conselho / consultivo' },
};

export function roleTypeLabel(roleType: string | null | undefined, lang: 'en' | 'pt' = 'en'): string | null {
  if (!roleType) return null;
  return ROLE_TYPE_LABELS[roleType]?.[lang] ?? roleType;
}

export const RELATION_KIND_LABELS: Record<string, { en: string; pt: string }> = {
  direct_statement: { en: 'their own statement', pt: 'declaração própria' },
  professional_experience: { en: 'professional experience', pt: 'experiência profissional' },
  indirect_responsibility: { en: 'indirect / portfolio', pt: 'indireta / portfolio' },
};

export function relationKindLabel(relationKind: string | null | undefined, lang: 'en' | 'pt' = 'en'): string | null {
  if (!relationKind) return null;
  return RELATION_KIND_LABELS[relationKind]?.[lang] ?? relationKind;
}

export const RESEARCH_SCOPE_LABELS: Record<string, { en: string; pt: string }> = {
  career: { en: 'Career', pt: 'Carreira' },
  education: { en: 'Education', pt: 'Educação' },
  board_seats: { en: 'Board seats', pt: 'Cargos em conselho' },
  statements: { en: 'Statements', pt: 'Declarações' },
  interviews: { en: 'Interviews', pt: 'Entrevistas' },
  articles: { en: 'Articles', pt: 'Artigos' },
  podcasts: { en: 'Podcasts', pt: 'Podcasts' },
  events: { en: 'Talks / events', pt: 'Palestras / eventos' },
  topics: { en: 'Topics', pt: 'Temas' },
  portfolio: { en: 'Portfolio relationships', pt: 'Relações de portfolio' },
  personal_signals: { en: 'Personal signals', pt: 'Sinais pessoais' },
};

// Fixed, deterministic display order for the research-coverage section —
// never the insertion order of whatever rows happen to come back from the
// query.
export const RESEARCH_SCOPE_ORDER = [
  'career', 'education', 'board_seats', 'statements', 'interviews',
  'articles', 'podcasts', 'events', 'topics', 'portfolio', 'personal_signals',
];

export function researchScopeLabel(scope: string, lang: 'en' | 'pt' = 'en'): string {
  return RESEARCH_SCOPE_LABELS[scope]?.[lang] ?? scope;
}

export function researchResultLabel(result: string, lang: 'en' | 'pt' = 'en'): string {
  if (result === 'found') return lang === 'pt' ? 'encontrada' : 'found';
  if (result === 'not_found') return lang === 'pt' ? 'nenhuma encontrada' : 'none found';
  if (result === 'not_public') return lang === 'pt' ? 'não é público' : 'not public';
  return result;
}

// ---------------------------------------------------------------------------
// Dates — period_from/period_to carry their own *_precision (exact_day,
// month, year, approximate). Never render more precision than the row
// actually has: a 'year' precision row must show "2022", never "2022-01-01".
// ---------------------------------------------------------------------------
export function formatPeriodDate(date: string | null | undefined, precision: string | null | undefined): string | null {
  if (!date) return null;
  if (precision === 'exact_day') {
    return date.slice(0, 10);
  }
  if (precision === 'month') {
    const [y, m] = date.split('-');
    return `${m}/${y}`;
  }
  if (precision === 'year') {
    return date.slice(0, 4);
  }
  // 'approximate' or an unrecognized precision value: never assert a
  // specific day/month we don't actually have.
  return `c. ${date.slice(0, 4)}`;
}

export function formatPeriodRange(
  fromDate: string | null | undefined,
  fromPrecision: string | null | undefined,
  toDate: string | null | undefined,
  toPrecision: string | null | undefined,
  isCurrent: boolean | null | undefined,
  lang: 'en' | 'pt' = 'en',
): string {
  const from = formatPeriodDate(fromDate, fromPrecision);
  const to = isCurrent ? (lang === 'pt' ? 'presente' : 'present') : formatPeriodDate(toDate, toPrecision);
  if (from && to) return `${from} – ${to}`;
  if (from && !to) return lang === 'pt' ? `desde ${from}` : `since ${from}`;
  if (!from && to) return lang === 'pt' ? `até ${to}` : `until ${to}`;
  return lang === 'pt' ? 'data não confirmada' : 'date not confirmed';
}

// ---------------------------------------------------------------------------
// Portfolio-relationship phrasing — must respect exactly the strength of
// what the source says. A curated/first-party statement ("Investment
// Manager de X") is stated as fact; anything weaker is hedged as
// association, never upgraded to an inferred claim ("investiu em X").
// ---------------------------------------------------------------------------
export function portfolioRelationshipPhrase(
  title: string,
  strength: number | null | undefined,
  lang: 'en' | 'pt' = 'en',
): string {
  const strong = (strength ?? 0) >= 3;
  if (strong) return title;
  return lang === 'pt' ? `associada publicamente a: ${title}` : `publicly associated with: ${title}`;
}

// ---------------------------------------------------------------------------
// Quick-view "last public evidence" — the most recent published_at across
// all evidence, formatted the same conservative way as periods so a
// year-only published_at is never shown as a full date.
// ---------------------------------------------------------------------------
export function formatEvidenceDate(date: string | null | undefined): string | null {
  if (!date) return null;
  // published_at is a plain `date` column (always exact_day precision at
  // the DB level) — no separate precision field exists for it, so this is
  // the one place a full date is legitimately shown.
  return date.slice(0, 10);
}
