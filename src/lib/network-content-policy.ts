// Prompt 321 — My Network 6/9: "isto tem que ser explícito" (Nuno's own
// words). My Network exists for ONE purpose — mutual help raising capital —
// and forbids sales, commercial relationships, and partnerships. That
// prohibition has to be enforced BY THE PRODUCT, not left to a terms page.
//
// This is deliberately NOT the same linter as outreach's own lintMessage
// (rules.ts): that one checks PERSONAL kill words, scoped per contact —
// this one checks a FIXED, general commercial vocabulary, the same list for
// every actor on the network, with no per-contact configuration at all.
//
// Known limitation, stated plainly (same honesty pattern as
// findDuplicateCandidate, Prompt 311): this is a heuristic keyword/phrase
// match, not language understanding. Creative paraphrase, indirection, or a
// pitch that never uses any of these exact phrases will pass uncaught. It
// catches the common, blunt cases; it is not, and cannot be, a complete
// filter.
export interface NetworkContentCheck { blocked: boolean; reason?: string }

const BLOCK_REASON = 'This looks like a sales pitch or business proposal — My Network is for capital-raising mutual help only.';

// English + Portuguese (the audience here is mostly PT, per the prompt).
// Grouped by category only for readability — checkNetworkContent treats
// every pattern identically, no category-specific messaging.
const SALES_PATTERNS: RegExp[] = [
  // Direct sales language
  /\bpricing\b/i, /\bour product\b/i, /\bbook a demo\b/i, /\bspecial offer\b/i, /\bdiscount\b/i,
  /\bpreç(o|os)\b/i, /\bo nosso produto\b/i, /\bagendar (uma )?demo\b/i, /\boferta especial\b/i, /\bdesconto\b/i,
  // Partnership / business-deal language
  /\bpartnership opportunity\b/i, /\blet'?s collaborate on\b/i, /\bbusiness proposal\b/i, /\breseller\b/i, /\bwhite[- ]?label\b/i,
  /\boportunidade de parceria\b/i, /\bvamos colabora[r]? em\b/i, /\bproposta comercial\b/i, /\brevendedor(a)?\b/i,
  // Generic cold-prospecting openers
  /\bare you the right person to talk to about\b/i, /\bquick question about your budget\b/i,
  // No leading \b before "és" — JS's \w doesn't include accented letters
  // without the /u + Unicode-property-escape form, so a plain \b right
  // before an accented character never matches (confirmed empirically:
  // the naive \bés… version silently failed this exact test case).
  /(^|\s)és a pessoa certa para falar (sobre|de)\b/i, /\bpergunta rápida sobre o (teu|vosso) orçamento\b/i,
];

export function checkNetworkContent(text: string): NetworkContentCheck {
  for (const pattern of SALES_PATTERNS) {
    if (pattern.test(text)) return { blocked: true, reason: BLOCK_REASON };
  }
  return { blocked: false };
}

// Pedido C — the machine-parseable tag /api/network/report writes into
// support_tickets.context, and the back-office strike action (Prompt 321's
// own addition to /api/backoffice/support/[id]/action) parses back out.
// Pure and tested so the two ends can never silently drift out of format.
export function formatNetworkReportContext(params: { postId?: string | null; reportedActorId?: string | null }): string {
  if (params.postId) return `network_post:${params.postId}`;
  return `network_actor:${params.reportedActorId ?? ''}`;
}
