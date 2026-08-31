// Prompt 487 — Block 2 of the North Star, read out of the facts that already
// exist instead of a table nobody scrolls to.
//
// WHAT THE DATA ACTUALLY SAYS, measured 31/08 before any of this was
// designed, because it decides the whole shape of the answer:
//
//   market_size  valid       12   bottom_up 0   external_estimate 10   (none) 2
//   market_size  incomplete  51   bottom_up 0   external_estimate 42   other 2  (none) 7
//   growth       incomplete   4   bottom_up 0                          (none) 4
//
// ZERO bottom-up facts, in all 67 rows. Every one is founder_reported; not
// one is corroborated or externally sourced. Prompt 487 §2 is explicit that
// the headline number may only come from a bottom-up fact, and equally
// explicit that "there is not enough bottom-up for a number yet" is a
// legitimate answer rather than a failure. So for ablute_ today this
// synthesis returns no headline — and says exactly what is missing, with the
// external estimates kept visible beside it, labelled, never promoted.
//
// The four questions Block 2 has to answer in one read: what do we know /
// how do we know it / how confident / why does it matter. A list of 51
// "incomplete" rows answers none of them; it is the raw material the answer
// would come from.
import { factSummaryLine, type FactView } from './market-facts-view';

export type HeadlineGapReason = 'no_facts' | 'no_valid' | 'no_bottom_up';

export interface MarketSizeHeadline {
  // One line per bottom-up fact. Several are NOT merged into a single
  // invented range: invariable 14 (no merge without positive proof) is the
  // same rule computeFactFingerprint follows in market-facts-db.ts, and two
  // bottom-up estimates of different markets are not one estimate.
  lines: string[];
  factIds: string[];
  // The WEAKEST verification status among the facts behind the headline —
  // never the strongest. A reading is only as corroborated as its least
  // corroborated input.
  confidence: FactView['verificationStatus'];
  confidenceLabel: string;
}

export interface MarketSizeGap {
  reason: HeadlineGapReason;
  sentence: string;
  // What exists instead, so the founder can see the material is not lost —
  // this is the whole point of not just rendering an empty card.
  validNonBottomUp: number;
  incomplete: number;
}

export interface MarketSizeSideEvidence { factId: string; line: string; methodLabel: string }

export interface MarketSizeSynthesis {
  headline: MarketSizeHeadline | null;
  gap: MarketSizeGap | null;
  sideEvidence: MarketSizeSideEvidence[];
  whyItMatters: string;
}

// Deliberately the same framing ComparableRoundsCard already uses, so the
// two cards say the same thing about the same investor question rather than
// inventing a second vocabulary for it.
export const MARKET_SIZE_WHY_IT_MATTERS =
  'This is the number an investor will ask you to justify your ask against.';

const CONFIDENCE_LABEL: Record<FactView['verificationStatus'], string> = {
  // Never the word "confident" on founder-reported evidence alone: the whole
  // point of the verification_status split (467 §D) is that a number you
  // gave us is not a number anyone checked.
  founder_reported: 'Reported by you — not yet corroborated by an outside source',
  externally_sourced: 'From an outside source — not yet cross-checked against a second one',
  corroborated: 'Corroborated by more than one source',
};

const METHOD_LABEL: Record<string, string> = {
  bottom_up: 'bottom-up',
  external_estimate: 'external estimate',
  other: 'method not stated',
};

export function methodLabel(methodology: string | null | undefined): string {
  return methodology ? METHOD_LABEL[methodology] ?? methodology : 'method not stated';
}

// Weakest wins. Ordered from least to most evidence.
const CONFIDENCE_ORDER: FactView['verificationStatus'][] = ['founder_reported', 'externally_sourced', 'corroborated'];

function weakestConfidence(facts: readonly FactView[]): FactView['verificationStatus'] {
  let weakest: FactView['verificationStatus'] = 'corroborated';
  for (const f of facts) {
    if (CONFIDENCE_ORDER.indexOf(f.verificationStatus) < CONFIDENCE_ORDER.indexOf(weakest)) weakest = f.verificationStatus;
  }
  return weakest;
}

const GAP_SENTENCE: Record<HeadlineGapReason, string> = {
  no_facts: 'No market size has been read out of your documents yet.',
  no_valid: 'Sherlock has market size figures from your documents, but none of them is complete enough to stand as a number yet.',
  no_bottom_up:
    'No bottom-up market size yet. Everything Sherlock has read so far is someone else’s estimate of the whole market, '
    + 'which is not the same as a number built from your own buyers, price and reach — and it is the built one an investor asks about.',
};

export function synthesiseMarketSize(allFacts: readonly FactView[]): MarketSizeSynthesis {
  const sizeFacts = allFacts.filter((f) => f.factType === 'market_size');
  const valid = sizeFacts.filter((f) => f.validationStatus === 'valid');
  const bottomUp = valid.filter((f) => f.payload.methodology === 'bottom_up');
  const validNonBottomUp = valid.filter((f) => f.payload.methodology !== 'bottom_up');
  const incomplete = sizeFacts.filter((f) => f.validationStatus === 'incomplete');

  // §2 — non-bottom-up material stays visible and labelled, and never gets to
  // pull the headline, whether or not a headline exists.
  const sideEvidence: MarketSizeSideEvidence[] = validNonBottomUp.map((f) => ({
    factId: f.id,
    line: factSummaryLine(f),
    methodLabel: methodLabel(f.payload.methodology),
  }));

  if (bottomUp.length > 0) {
    const confidence = weakestConfidence(bottomUp);
    return {
      headline: {
        lines: bottomUp.map((f) => factSummaryLine(f)),
        factIds: bottomUp.map((f) => f.id),
        confidence,
        confidenceLabel: CONFIDENCE_LABEL[confidence],
      },
      gap: null,
      sideEvidence,
      whyItMatters: MARKET_SIZE_WHY_IT_MATTERS,
    };
  }

  const reason: HeadlineGapReason = sizeFacts.length === 0 ? 'no_facts' : valid.length === 0 ? 'no_valid' : 'no_bottom_up';
  return {
    headline: null,
    gap: {
      reason,
      sentence: GAP_SENTENCE[reason],
      validNonBottomUp: validNonBottomUp.length,
      incomplete: incomplete.length,
    },
    sideEvidence,
    whyItMatters: MARKET_SIZE_WHY_IT_MATTERS,
  };
}

// "10 external estimates and 51 more figures that are still incomplete" —
// what the founder has, said in one line, so a card with no headline still
// shows the work is not lost. Returns '' when there is genuinely nothing.
export function describeAvailableMaterial(gap: MarketSizeGap): string {
  const parts: string[] = [];
  if (gap.validNonBottomUp > 0) {
    parts.push(`${gap.validNonBottomUp} complete ${gap.validNonBottomUp === 1 ? 'figure' : 'figures'} from other methods`);
  }
  if (gap.incomplete > 0) {
    parts.push(`${gap.incomplete} more still missing a detail`);
  }
  if (parts.length === 0) return '';
  return `Sherlock does have ${parts.join(' and ')}.`;
}
