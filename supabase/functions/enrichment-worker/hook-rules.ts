// Prompt 638 §3.2 — rule (a) of the hook bar, checked by code.
// Prompt 641 §2 — position, not only presence.
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
// Then the first 9 of 638's 20 showed the shape the presence check misses:
// the fund is the SUBJECT and the person sits in a subordinate clause or a
// complement at the end — "Indico Capital Partners launched a €50M fund …
// with Rui Rodrigues as a Partner involved", "Co-president of Investors
// Portugal, which manages approximately €500 million…". The surname is
// there, so presence passes; it is there as an object, not a subject. So
// three positional rules reject, and one inverse rule protects the hooks
// whose implied subject is the person ("Launched €125 million new fund at
// Indico…", "Built and sold U.hub…").
//
// Person markers, per 638 §3.2: a token of the person's own name, a
// pronoun, or one of the verbs a sentence about a person tends to carry.
// The verb list is the weak side and is meant to be. The net catches the
// fund-thesis shape, not every fund-only sentence. Pure functions, no Deno
// APIs, so src/lib/hook-rules.test.ts tests this file, the one deployed.

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

// Prompt 641 §2, the inverse rule: a hook that OPENS with a past-tense verb
// or a pronoun has the person as its implied subject, whatever fund is named
// after it. Regular past tense is "-ed"; these are the irregular ones that
// open a profile sentence.
const IRREGULAR_PAST = new Set([
  'led', 'built', 'sold', 'ran', 'wrote', 'spent', 'began', 'took', 'made', 'grew', 'held', 'left', 'won',
  'brought', 'set', 'put', 'drove', 'became', 'went', 'came', 'kept', 'met', 'found', 'gave', 'got', 'taught',
  'thought', 'told', 'said', 'spoke', 'chose', 'drew', 'rose', 'paid', 'sent', 'cut', 'oversaw', 'saw',
]);

// Name particles and titles that are not a marker of the person on their own.
const NAME_NOISE = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'jr', 'sr', 'phd', 'mba', 'cfa', 'von', 'van', 'der', 'den', 'de', 'da', 'di', 'du', 'la', 'le', 'del', 'and']);

/** Beyond this many characters between the entity mention and the first person marker, the fact belongs to the entity (641 §2 rule 2). */
export const PERSON_AFTER_ENTITY_WINDOW = 60;

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

export type FundOnlyRule = 'no_person_marker' | 'starts_with_entity' | 'relative_clause' | 'person_after_entity';

export interface FundOnlyHit {
  /** What matched the entity — the full name or its distinctive token — for the audit row. */
  entityMention: string;
  /** Which of the rules rejected it. */
  rule: FundOnlyRule;
}

function opensWithPersonSubject(tokens: string[]): boolean {
  const first = tokens[0];
  if (!first) return false;
  if (PRONOUNS.has(first) || IRREGULAR_PAST.has(first) || /^[a-z]{3,}ed$/.test(first)) return true;
  // "Co-founded X" folds to "co founded x": the verb is the second token.
  if (first === 'co' && tokens[1] && (IRREGULAR_PAST.has(tokens[1]) || /^[a-z]{3,}ed$/.test(tokens[1]))) return true;
  return false;
}

/**
 * Returns a hit when the hook is about the fund rather than the person, null
 * when the hook is about the person (or does not name the entity at all —
 * that case is not code-verifiable and is left to the model's own rule).
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

  // Inverse rule first: the person is the subject, the fund is scenery.
  if (opensWithPersonSubject(hookTokens)) return null;

  // Rule 1 — the hook opens with the entity (its full mention, or its first two words).
  if (hookText.startsWith(` ${mention} `)) return { entityMention: mention, rule: 'starts_with_entity' };
  if (entityTokens.length >= 2 && hookTokens[0] === entityTokens[0] && hookTokens[1] === entityTokens[1]) {
    return { entityMention: mention, rule: 'starts_with_entity' };
  }

  // Rule 3 — a relative clause hangs off the entity: what follows is about it by grammar.
  if (/ (which|that|whose) /.test(hookText.slice(hookText.indexOf(` ${mention} `) + mention.length + 1, hookText.indexOf(` ${mention} `) + mention.length + 9))) {
    return { entityMention: mention, rule: 'relative_clause' };
  }

  // Presence — any marker of the person at all?
  const nameTokens = foldTokens(personFullName).filter((t) => t.length >= 3 && !NAME_NOISE.has(t));
  const markerPositions: number[] = [];
  for (const t of nameTokens) { const i = hookText.indexOf(` ${t} `); if (i >= 0) markerPositions.push(i); }
  for (const t of PRONOUNS) { const i = hookText.indexOf(` ${t} `); if (i >= 0) markerPositions.push(i); }
  for (const v of PERSON_VERBS) { const i = hookText.indexOf(` ${v} `); if (i >= 0) markerPositions.push(i); }
  if (markerPositions.length === 0) return { entityMention: mention, rule: 'no_person_marker' };

  // Rule 2 — the first person marker comes after the entity, and far after it.
  const mentionPos = hookText.indexOf(` ${mention} `);
  const firstMarker = Math.min(...markerPositions);
  if (firstMarker > mentionPos && firstMarker - (mentionPos + mention.length + 1) > PERSON_AFTER_ENTITY_WINDOW) {
    return { entityMention: mention, rule: 'person_after_entity' };
  }
  return null;
}
