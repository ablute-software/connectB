// Prompt 605 §B — who may send a suggestion. One file, deliberately: when
// the rule changes it changes here and nowhere else.
//
// 605 planned a temporary allow-list of org ids because Prompt 601 (badges)
// "ainda não foi construído", and 607 §C supplied two ids for it. That
// premise was already stale when 607 was written: migration 0337
// (platform_badges) was applied to production on 2026-09-07 at 11:57 UTC,
// and src/lib/platform-badges*.ts, the back-office grant controls and the
// tech-master lapse queue all exist on main. Checked before writing this
// rather than taken on trust — the list would have been a second, weaker
// definition of "which cohort", live alongside the real one from day one.
//
// So this IS 605's step 2 ("trocar a lista pela verificação do badge, no
// mesmo sítio. Uma linha."), reached directly. Consequence worth stating:
// no org holds an active tech master or pioneer badge today, so nobody sees
// the suggestion option until one is granted in Back-office → Startups →
// the badge controls. That is a one-click action, and it is the same click
// that will be needed for every real member of either cohort.
import type { PlatformBadgeKey } from './platform-badges';

/** §B — "tech master e pioneer", the two cohort badges of Prompt 601. */
export const SUGGESTION_BADGES: readonly PlatformBadgeKey[] = ['tech_master', 'pioneer'];

// §B — "É também um programa com fim à vista ('até lançamento beta
// inclusive'). Vale a pena o portão saber desligar-se."
//
// A FLAG rather than a date, and the distinction is not cosmetic: beta has
// no date yet, so a date here would be invented, and an invented date either
// fires early on a day nobody is looking or gets pushed back so often it
// stops meaning anything. Flip this to false the day beta ships — that is a
// decision someone makes, which is what "fim do programa" actually is.
export const SUGGESTIONS_PROGRAMME_OPEN = true;

export interface SuggestionGateInput {
  /** Badge keys the org holds ACTIVE (not revoked). Lapsed still counts —
   *  a lapse is a billing question (601 §F), never a reason to stop
   *  listening to someone who is still using the product. */
  activeBadges: readonly string[];
  /** Defaults to the constant above; a parameter so the test can exercise
   *  the closed programme without editing the constant. */
  programmeOpen?: boolean;
}

/** The whole rule, in one place. */
export function canSuggest({ activeBadges, programmeOpen = SUGGESTIONS_PROGRAMME_OPEN }: SuggestionGateInput): boolean {
  if (!programmeOpen) return false;
  return activeBadges.some((b) => (SUGGESTION_BADGES as readonly string[]).includes(b));
}

/** Which badge opened the door — the back-office queue shows it on the row,
 *  because §E: "a sugestão de um tech master é literalmente o que o programa
 *  foi comprar". Highest-ranking badge wins when an org holds both. */
export function qualifyingBadge(activeBadges: readonly string[]): PlatformBadgeKey | null {
  for (const b of SUGGESTION_BADGES) if (activeBadges.includes(b)) return b;
  return null;
}
