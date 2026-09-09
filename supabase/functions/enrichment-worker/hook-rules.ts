// Prompt 638 §3.2 — rule (a) of the hook bar, checked by code.
//
// Two of the four web-path hooks written on 2026-09-09 began with the fund's
// name and never mentioned the person: "Alpana Ventures focuses on bridging
// Swiss and European startups…" and "Alpana Ventures employs a unique
// early-stage investment model…" — two people, one firm, variations of one
// sentence. The rule was in the schema and in the system prompt and the
// model broke it in the first word, which is the GapMinder lesson a third
// time. Like the kill-word check, this is a NET before the write, not a
// judge: a hook that names the entity and carries no marker of the person
// is the fund's thesis, which already lives in catalog_entities.thesis.
//
// Person markers, per 638 §3.2: a token of the person's own name, a
// pronoun, or one of the verbs a sentence about a person tends to carry.
// The verb list is the weak side and is meant to be — "Alpana Ventures
// invested in X" passes on "invested". The net catches the fund-thesis
// shape, not every fund-only sentence. Pure functions, no Deno APIs, so
// src/lib/hook-rules.test.ts tests this file, the one that is deployed.

// Words that name a kind of firm rather than a firm: alone they never count
// as a mention of the entity ("Capital" appears in half the hooks written).
const GENERIC_NAME_TOKENS = new Set([
  'ventures', 'venture', 'capital', 'partners', 'partner', 'fund', 'funds', 'group', 'invest', 'investors',
  'investments', 'investment', 'management', 'holdings', 'holding', 'equity', 'the', 'and', 'of', 'de', 'da',
  'do', 'gmbh', 'ag', 'sa', 'ltd', 'llc', 'lp', 'llp', 'bv', 'nv', 'inc', 'co', 'company', 'angels', 'angel',
  'network', 'advisors', 'advisory', 'family', 'office', 'seed', 'growth', 'tech', 'technology', 'digital',
]);

const PRONOUNS = new Set(['he', 'she', 'his', 'her', 'hers', 'him', 'they', 'their', 'them', 'himself', 'herself']);

// Verbs and phrases whose subject is, in profile prose, a person. Multi-word
// entries are matched as phrases over the folded token stream.
// Deliberately NOT here: invests, backs, manages, runs, holds, launched,
// built — a fund is the subject of those as often as a person is ("Alpana
// Ventures invests in early-stage…" is the thesis shape this net exists for).
const PERSON_VERBS = [
  'said', 'says', 'saying', 'led', 'leads', 'leading', 'joined', 'joins', 'founded', 'co founded', 'cofounded',
  'wrote', 'writes', 'argues', 'argued', 'invested', 'believes', 'believed', 'told', 'explained', 'explains',
  'serves', 'served', 'chairs', 'chaired', 'worked', 'works', 'studied', 'graduated', 'spent', 'started',
  'previously', 'formerly', 'before joining', 'prior to', 'sits on', 'sat on', 'oversees', 'supervises',
  'advises', 'mentors', 'teaches', 'describes', 'described', 'sold', 'exited',
];

// Name particles and titles that are not a marker of the person on their own.
const NAME_NOISE = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'jr', 'sr', 'phd', 'mba', 'cfa', 'von', 'van', 'der', 'den', 'de', 'da', 'di', 'du', 'la', 'le', 'del', 'and']);

/** Lower-case, diacritics folded, punctuation dropped: "Entrée Capital's" → ["entree", "capital", "s"]. */
export function foldTokens(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export interface FundOnlyHit {
  /** What matched the entity — the full name or its distinctive token — for the audit row. */
  entityMention: string;
}

/**
 * Returns a hit when the hook names the entity and carries no marker of the
 * person, null when the hook is about the person (or does not name the
 * entity at all — that case is not code-verifiable and is left to the
 * model's own rule).
 */
export function hookIsAboutTheFund(hook: string | null | undefined, entityName: string | null | undefined, personFullName: string | null | undefined): FundOnlyHit | null {
  if (!hook || !entityName) return null;
  const hookTokens = foldTokens(hook);
  if (hookTokens.length === 0) return null;
  const hookText = ` ${hookTokens.join(' ')} `;

  const entityTokens = foldTokens(entityName);
  if (entityTokens.length === 0) return null;
  let mention: string | null = null;
  if (hookText.includes(` ${entityTokens.join(' ')} `)) {
    mention = entityTokens.join(' ');
  } else {
    const distinctive = entityTokens.filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
    mention = distinctive.find((t) => hookTokens.includes(t)) ?? null;
  }
  if (!mention) return null;

  const nameTokens = foldTokens(personFullName).filter((t) => t.length >= 3 && !NAME_NOISE.has(t));
  if (nameTokens.some((t) => hookTokens.includes(t))) return null;
  if (hookTokens.some((t) => PRONOUNS.has(t))) return null;
  if (PERSON_VERBS.some((v) => hookText.includes(` ${v} `))) return null;
  return { entityMention: mention };
}
