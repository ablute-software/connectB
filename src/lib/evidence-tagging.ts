// Prompt 585 §B.4 — the AI-fallback tagging pass, used ONLY when the
// deterministic dictionary matcher (topic-matcher.ts) found zero tags on
// an evidence row with enough text to plausibly contain one (≥300 chars,
// enqueued in evidence_tagging_queue by the migration's own backfill and,
// going forward, by the insert-time dictionary pass). Output is restricted
// to slugs that already exist in topic_taxonomy — an unknown slug is
// rejected, never used to invent a new topic (§ "não criar temas fora do
// seed").
export interface EvidenceTaggingInput {
  title: string;
  excerpt: string | null;
}

export interface TaggingTopicOption {
  slug: string;
  labelEn: string;
}

const MAX_TAGS = 5;

export function buildEvidenceTaggingPrompt(evidence: EvidenceTaggingInput, topics: TaggingTopicOption[]): string {
  const topicList = topics.map((t) => `${t.slug} — ${t.labelEn}`).join('\n');
  return (
    'You tag a piece of evidence (a public statement, article, or interview excerpt about an investor or their fund) '
    + 'with topics from a FIXED list — never invent a topic not on this list.\n\n'
    + `AVAILABLE TOPICS (slug — label):\n${topicList}\n\n`
    + `EVIDENCE TITLE: ${evidence.title}\n`
    + `EVIDENCE TEXT: ${evidence.excerpt ?? '(no excerpt — title only)'}\n\n`
    + `Return up to ${MAX_TAGS} topic slugs that this evidence is genuinely about (not just adjacent), each with a `
    + 'confidence 0-1. Also return polarity (positive/negative/neutral — negative means the evidence states avoiding or '
    + 'not investing in something) and is_personal (true only if the evidence is about the person\'s private life, '
    + 'family, or personal health — never their professional investment activity).'
  );
}

export const EVIDENCE_TAGGING_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    tags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Must be exactly one of the provided topic slugs.' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['slug', 'confidence'],
      },
      maxItems: MAX_TAGS,
    },
    polarity: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
    is_personal: { type: 'boolean' },
  },
  required: ['tags', 'polarity', 'is_personal'],
};

export interface ParsedTaggingResult {
  tags: { slug: string; confidence: number }[];
  polarity: 'positive' | 'negative' | 'neutral' | null;
  isPersonal: boolean | null;
  rejectedSlugs: string[];
}

// Validates the model's raw tool-call input against the REAL set of active
// taxonomy slugs — an unknown slug is dropped and reported, never trusted.
// This is the same "the model doesn't get to invent the ground truth"
// discipline as every other forced-tool-call route in this codebase.
export function parseEvidenceTaggingOutput(raw: unknown, validSlugs: ReadonlySet<string>): ParsedTaggingResult {
  const input = raw as {
    tags?: { slug?: unknown; confidence?: unknown }[];
    polarity?: unknown;
    is_personal?: unknown;
  } | undefined;

  const rejectedSlugs: string[] = [];
  const tags: { slug: string; confidence: number }[] = [];
  for (const t of input?.tags ?? []) {
    const slug = typeof t?.slug === 'string' ? t.slug : null;
    const confidence = typeof t?.confidence === 'number' ? Math.max(0, Math.min(1, t.confidence)) : 0;
    if (!slug) continue;
    if (!validSlugs.has(slug)) { rejectedSlugs.push(slug); continue; }
    tags.push({ slug, confidence });
  }

  const polarity = input?.polarity === 'positive' || input?.polarity === 'negative' || input?.polarity === 'neutral'
    ? input.polarity : null;
  const isPersonal = typeof input?.is_personal === 'boolean' ? input.is_personal : null;

  return { tags: tags.slice(0, MAX_TAGS), polarity, isPersonal, rejectedSlugs };
}
