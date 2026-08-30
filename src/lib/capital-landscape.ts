// Prompt 481 — Capital Landscape: where a round in the founder's view came
// from, and the warning that must travel with it.
//
// What this prompt asked to check first, and what the check actually found
// (it contradicts the prompt's own premise, so it is written down here
// rather than quietly worked around):
//
//   - Prompt 460 did NOT remove players/rounds because the data was
//     unreliable. Its own commit message says those menu entries pointed at
//     a static placeholder panel, and that "those real cards live in the
//     separate Market analysis tab". ComparableRoundsCard is live and
//     rendered to this day (MarketDataPanel).
//   - So Bloco 4 is not a green field. Rounds already merge two sources
//     server-side (market-rounds-merge.ts): a tracked competitor's funding
//     history (investor_investments) and accepted `rounds` web-research
//     items (445's RoundStructured). Per-item provenance already existed;
//     what was missing was manual entry, and the honesty warnings.
//
// So this file adds the third source and the notices, and reuses the merge
// that already worked instead of rebuilding it.
export type CapitalRoundSource = 'competitor_tracked' | 'research' | 'manual';

// §3 — attached to anything the platform found rather than the founder
// typed. Honest about the limit AND about the intent, because a warning
// with no horizon reads as "this will never get better", which is not what
// is true here.
export const PUBLIC_SOURCE_NOTICE = 'Sourced from limited public/web search — verification may not be 100% reliable. '
  + 'We\'re working toward fully automated, reliable sources here.';

// §4 — deliberately a different sentence carrying a different meaning: not
// "we might be wrong" but "this one is yours to stand behind". The
// responsibility genuinely moved, and the copy has to say so rather than
// implying the platform checked it.
export const MANUAL_ENTRY_NOTICE = 'Manually entered — you\'re responsible for verifying this information before it\'s '
  + 'shared with investors.';

// §5 — "os dois avisos nunca se misturam numa frase só". Enforced by
// construction: this returns exactly ONE notice for a given item, and there
// is no code path that returns both or concatenates them. An item has one
// provenance, so it gets one warning — never a generic banner at the top of
// the section covering both cases at once, which is what §5 rules out.
export function noticeForSource(source: CapitalRoundSource): string {
  return source === 'manual' ? MANUAL_ENTRY_NOTICE : PUBLIC_SOURCE_NOTICE;
}

// competitor_tracked and research both come from platform-side data the
// founder did not type, so both carry the public-source notice. Kept as an
// explicit predicate rather than an inline `!== 'manual'` so the intent
// survives a future fourth source being added: whoever adds it has to
// decide which side it falls on.
export function isFounderEntered(source: CapitalRoundSource): boolean {
  return source === 'manual';
}

export interface ManualRoundInput {
  companyName?: unknown; investorName?: unknown; amountEur?: unknown;
  roundType?: unknown; investedAt?: unknown; sourceUrl?: unknown;
}

export interface ManualRound {
  companyName: string; investorName: string | null; amountEur: number | null;
  roundType: string | null; investedAt: string | null; sourceUrl: string | null;
}

const MAX_TEXT = 200;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : null;
}

// §2 — the founder registers a round they know about. Only the company name
// is required: a founder who remembers "Acme raised something last year"
// should be able to record that much rather than being blocked into
// inventing an amount to satisfy a form. Everything else is optional and
// stays null, which the card renders as blank rather than as zero.
export function sanitizeManualRound(input: ManualRoundInput): ManualRound | null {
  const companyName = text(input.companyName);
  if (!companyName) return null;
  const amountEur = typeof input.amountEur === 'number' && Number.isFinite(input.amountEur) && input.amountEur >= 0
    ? Math.round(input.amountEur) : null;
  // Dates are stored as given only when they parse — a date the founder
  // half-typed is dropped rather than persisted as something that will
  // sort wrongly forever.
  const investedAtRaw = text(input.investedAt);
  const investedAt = investedAtRaw && !Number.isNaN(Date.parse(investedAtRaw)) ? investedAtRaw : null;
  return {
    companyName,
    investorName: text(input.investorName),
    amountEur,
    roundType: text(input.roundType),
    investedAt,
    sourceUrl: text(input.sourceUrl),
  };
}
