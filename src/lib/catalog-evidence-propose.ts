// Prompt 585 §D.3 — the founder "propose evidence" flow's own pure
// validation, kept separate from the route so it's testable without a
// server. §A: "sem link não existe" — url is the one truly required
// field; everything else has a safe fallback or is optional.
//
// Photos are deliberately excluded from this list (decision 2: no photos
// in v1 — the schema allows kind='photo' but the founder-facing form
// never offers it).
export const FOUNDER_EVIDENCE_KINDS = [
  'interview', 'podcast', 'talk_event', 'article_authored', 'article_about',
  'statement', 'press_release', 'investment', 'fund_announcement', 'social_post', 'other',
] as const;
export type FounderEvidenceKind = (typeof FOUNDER_EVIDENCE_KINDS)[number];

export interface EvidenceProposalInput {
  url: string;
  kind: string;
  title: string;
  excerpt?: string | null;
  publishedAt?: string | null;
}

export interface EvidenceProposalValidation {
  ok: boolean;
  errors: string[];
  normalized?: { url: string; kind: FounderEvidenceKind; title: string; excerpt: string | null; publishedAt: string | null };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateEvidenceProposal(input: EvidenceProposalInput): EvidenceProposalValidation {
  const errors: string[] = [];

  const url = (input.url ?? '').trim();
  if (!url) errors.push('A link is required — evidence without a link is never accepted.');
  else if (!isAbsoluteHttpUrl(url)) errors.push('That doesn’t look like a full link (needs to start with http:// or https://).');

  const kind = (input.kind ?? '').trim();
  if (!(FOUNDER_EVIDENCE_KINDS as readonly string[]).includes(kind)) errors.push('Choose what kind of evidence this is.');

  const title = (input.title ?? '').trim();
  if (!title) errors.push('Give it a short title.');
  else if (title.length > 200) errors.push('Title is too long (200 characters max).');

  const excerpt = input.excerpt != null ? input.excerpt.trim() : '';
  if (excerpt.length > 600) errors.push('Excerpt is too long (600 characters max) — quote just the sentence that matters.');

  const publishedAt = input.publishedAt != null && input.publishedAt.trim() ? input.publishedAt.trim() : null;
  if (publishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)) errors.push('Date must be YYYY-MM-DD.');

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    normalized: { url, kind: kind as FounderEvidenceKind, title, excerpt: excerpt || null, publishedAt },
  };
}
