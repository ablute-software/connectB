// Prompt 528 §2 — Watson suggests which of the Structured update's four
// sections is actually worth writing, and drafts it, from what the app
// already knows about this company.
//
// The pure half lives here so the two properties that matter are testable
// without a model call: the suggestion always lands in one of the four real
// sections, and it never carries round/funding content.
//
// ROUND/FUNDING IS EXCLUDED AT THE SOURCE, not by instruction. The composer
// already states its own rule in the UI — "No round/funding field, on
// purpose" (NetworkPageContent.tsx) — and an AI button that can reintroduce
// what the form deliberately leaves out would quietly overrule that. So the
// route never puts round_target_eur or round_target_close_date into the
// knowledge base, even though the roadmap's equivalent builder does. A model
// cannot leak a number it was never given; an instruction not to mention it
// is only as good as the model's compliance. The check below is the second
// net, not the first.

export const UPDATE_SECTIONS = ['productProgress', 'customers', 'team', 'learnings'] as const;
export type UpdateSection = typeof UPDATE_SECTIONS[number];

export const UPDATE_SECTION_LABEL: Record<UpdateSection, string> = {
  productProgress: 'Product', customers: 'Customers', team: 'Team', learnings: 'Learnings',
};

export const UPDATE_SUGGEST_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    section: {
      type: 'string',
      enum: [...UPDATE_SECTIONS],
      description: 'Which of the four sections the evidence best supports. Pick exactly one — the most interesting and best-grounded.',
    },
    text: {
      type: 'string',
      description: 'One or two sentences for that section, in the founder\'s voice, stating only facts present in the knowledge given.',
    },
    reasoning: {
      type: 'string',
      description: 'One short sentence naming which piece of the given knowledge this came from, so the founder can check it.',
    },
  },
  required: ['section', 'text', 'reasoning'],
} as const;

export const UPDATE_SUGGEST_SYSTEM = [
  'You help a startup founder write a short progress update for a private founders-and-investors feed.',
  '',
  'You are given a closed list of facts this company has already told the platform. That list is all you know.',
  '',
  'Rules:',
  '- Choose the ONE section (Product, Customers, Team, Learnings) best supported by the facts given.',
  '- Write one or two sentences for it. State nothing that is not in the facts given. Do not embellish numbers or add adjectives the facts do not support.',
  '- Never mention fundraising, the round, a target amount, a valuation, or investors being approached. That is out of scope for this feed by design.',
  '- Never mention outreach, pipeline, replies, passes, or how the company is performing on the platform.',
  '- If the facts do not support any section, say so through the reasoning field and pick the closest section with the most cautious sentence you can honestly write.',
  '- Write in English, in the founder\'s own plain voice. No sales language, no hype, no calls to action.',
].join('\n');

export interface UpdateSuggestion {
  section: UpdateSection;
  text: string;
  reasoning: string;
}

// Words that mean this drifted into round/funding territory despite the
// knowledge base never containing it. Deliberately blunt: a false positive
// costs the founder one suggestion, a false negative puts fundraising
// content into a feed that is designed to exclude it.
// Plural-tolerant on purpose: an earlier version ended each alternative
// with , so "investors" slipped through while "investor" was caught —
// found by the test below, not by reading.
const FUNDING_TERMS = /\b(rounds?|raise[sd]?|raising|fundrais\w*|valuations?|term sheets?|pre-seed|seed round|series [a-d]|investors?|vcs?|cap table|runway|€\s?\d|\$\s?\d)\b/i;

export function mentionsFunding(text: string): boolean {
  return FUNDING_TERMS.test(text);
}

/**
 * Validate the model's tool payload. Returns null when there is nothing
 * usable — the caller reports "no suggestion" rather than filling a field
 * with something invented or off-limits.
 */
export function toUpdateSuggestion(raw: unknown): UpdateSuggestion | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const section = typeof r.section === 'string' ? r.section : '';
  if (!(UPDATE_SECTIONS as readonly string[]).includes(section)) return null;

  const text = typeof r.text === 'string' ? r.text.trim() : '';
  if (!text) return null;
  if (mentionsFunding(text)) return null;

  const reasoning = typeof r.reasoning === 'string' ? r.reasoning.trim() : '';
  return { section: section as UpdateSection, text, reasoning };
}
