// Prompt 556 §C — what an investor sees of a startup that no longer exists.
//
// The rule Nuno gave is exact: a card whose org is closed shows THAT it
// existed and nothing else. Not a greyed-out version of the old card, not
// the one-liner with the buttons disabled — the name, and one line.
//
// So this BUILDS a new object rather than deleting keys off the old one.
// Same discipline as the investor-facing SWOT projection (CLAUDE.md:
// "when the same generated artifact has two audiences, generate two
// artifacts, never one filtered at the edge"): a card assembled field by
// field cannot leak a field someone adds to the full card next month,
// whereas a blacklist silently would. UNAVAILABLE_CARD_KEYS is the whole
// contract, and pinned by its own test.
//
// The four kept fields are the minimum the Pipeline needs to render a row
// at all and to keep the investor's own history coherent: which org it was
// (orgId), what it was called (name), what they had decided (status), and
// when (decidedAt). Nothing about the startup itself survives — no
// one-liner, sectors, round, valuation, intro, tracking count, data-room
// flag, conversation flag, match score or match reasons.

export const UNAVAILABLE_CARD_KEYS = ['orgId', 'name', 'status', 'decidedAt', 'unavailable'] as const;

export type UnavailableCard = {
  orgId: string;
  name: string;
  status: string;
  decidedAt: string | null;
  unavailable: true;
};

export function projectUnavailableCard(card: {
  orgId: string; name: string; status: string; decidedAt?: string | null;
}): UnavailableCard {
  return {
    orgId: card.orgId,
    name: card.name,
    status: card.status,
    decidedAt: card.decidedAt ?? null,
    unavailable: true,
  };
}

// A real type predicate, not a boolean: narrowing is the point. Every
// server consumer of a wave item gets a `FullCard | UnavailableCard` union,
// and tsc refuses to read `.sectors` off it until this has been asked —
// which is what turned "remember to handle closed orgs" into a compile
// error at each of the call sites. Takes `unknown` so the client (which
// receives the card as parsed JSON, not as this type) can use it too.
export function isUnavailableCard(card: unknown): card is UnavailableCard {
  return !!card && typeof card === 'object' && (card as { unavailable?: unknown }).unavailable === true;
}
