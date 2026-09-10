// Prompt 585 §F.4 — server-side validation of the model's output, with
// zero model calls of its own. Every rule here is checkable code, not
// judgment: a claim without a real evidence id, a sentence the claims
// don't support, a kill word, an entity-target hook citing personal
// evidence. Fail once → the route retries with the error in the prompt;
// fail twice → verdict='none', reason_if_none='validation', no text
// shown — "nunca mostrar texto não validado" (§F.4's own last line).
import type { HookPackEvidence } from './hook-pack';

export interface RawHookOutput {
  verdict?: string;
  hook_text?: string | null;
  claims?: { text?: string; evidence_ids?: string[] }[];
  suggested_channel?: string;
  avoid?: string[];
  reason_if_none?: string | null;
}

export interface HookClaim { text: string; evidenceIds: string[] }
export interface ParsedHookOutput {
  verdict: 'strong' | 'weak' | 'none';
  hookText: string | null;
  claims: HookClaim[];
  reasonIfNone: string | null;
}

export const HOOK_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdict: { type: 'string', enum: ['strong', 'weak', 'none'], description: '"none" when there is nothing genuinely specific to say.' },
    hook_text: { type: 'string', description: 'The hook itself. Empty or omitted when verdict is "none".' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          evidence_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'evidence_ids'],
      },
    },
    suggested_channel: { type: 'string', enum: ['platform_message', 'linkedin', 'email', 'form'] },
    avoid: { type: 'array', items: { type: 'string' } },
    reason_if_none: { type: 'string' },
  },
  required: ['verdict', 'claims'],
};

const VALID_VERDICTS = new Set(['strong', 'weak', 'none']);

export function parseHookOutput(raw: unknown): ParsedHookOutput {
  const r = (raw ?? {}) as RawHookOutput;
  const verdict = VALID_VERDICTS.has(r.verdict ?? '') ? (r.verdict as 'strong' | 'weak' | 'none') : 'none';
  const claims: HookClaim[] = Array.isArray(r.claims)
    ? r.claims.filter((c) => c && typeof c.text === 'string').map((c) => ({
        text: c.text as string, evidenceIds: Array.isArray(c.evidence_ids) ? c.evidence_ids.filter((id) => typeof id === 'string') : [],
      }))
    : [];
  return {
    verdict, hookText: typeof r.hook_text === 'string' ? r.hook_text : null,
    claims, reasonIfNone: typeof r.reason_if_none === 'string' ? r.reason_if_none : null,
  };
}

// Splits into rough sentences — good enough for "does every sentence
// trace back to a claim", not a linguistic parser.
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function normalizeWords(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9À-ÿ\s]/gi, ' ').split(/\s+/).filter((w) => w.length > 3));
}

// A sentence is "supported" when it shares enough real words with at
// least one claim's own text — a pragmatic approximation of "this
// sentence traces to a claim", not strict entailment (no model call
// happens in validation, so this is the ceiling of what's checkable).
function sentenceIsSupported(sentence: string, claims: HookClaim[]): boolean {
  const sentenceWords = normalizeWords(sentence);
  if (sentenceWords.size === 0) return true; // nothing substantive to check
  for (const claim of claims) {
    const claimWords = normalizeWords(claim.text);
    let overlap = 0;
    for (const w of sentenceWords) if (claimWords.has(w)) overlap += 1;
    if (overlap >= Math.min(2, sentenceWords.size)) return true;
  }
  return false;
}

export interface ValidateHookParams {
  parsed: ParsedHookOutput;
  evidencePool: HookPackEvidence[];
  charLimit: number;
  killWords: string[];
  targetKind: 'person' | 'entity';
}

export function validateHookOutput({ parsed, evidencePool, charLimit, killWords, targetKind }: ValidateHookParams): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (parsed.verdict === 'none') return { ok: true, errors: [] }; // nothing to validate — no text was produced

  const evidenceById = new Map(evidencePool.map((e) => [e.id, e]));

  if (!parsed.hookText || parsed.hookText.trim().length === 0) {
    errors.push('verdict was not "none" but hook_text is empty.');
  } else {
    if (parsed.hookText.length > charLimit) errors.push(`hook_text exceeds the ${charLimit}-character limit for this channel.`);

    const lowerText = parsed.hookText.toLowerCase();
    for (const kw of killWords) {
      if (kw && lowerText.includes(kw.toLowerCase())) errors.push(`hook_text contains a kill word ("${kw}").`);
    }

    if (parsed.claims.length === 0) {
      errors.push('No claims were given to support the hook text.');
    } else {
      for (const claim of parsed.claims) {
        if (claim.evidenceIds.length === 0) { errors.push(`Claim "${claim.text}" cites no evidence id.`); continue; }
        for (const id of claim.evidenceIds) {
          if (!evidenceById.has(id)) { errors.push(`Claim cites evidence id "${id}" that isn't in the pack.`); continue; }
          if (targetKind === 'entity' && evidenceById.get(id)!.isPersonal) {
            errors.push(`Entity-target hook cites personal evidence ("${id}") — not allowed.`);
          }
        }
      }

      for (const sentence of splitSentences(parsed.hookText)) {
        if (!sentenceIsSupported(sentence, parsed.claims)) {
          errors.push(`Sentence not traceable to any claim: "${sentence}"`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
