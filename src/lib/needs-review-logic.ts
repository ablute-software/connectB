// Needs-review dossier redesign — pure, DB-free logic for the AI
// pre-classification pass: detecting contact-metadata cards, resolving the
// one unambiguous "no real signal" shape deterministically (no AI call
// needed), and deciding what an AI proposal is confident enough to
// auto-apply without a human looking at it first. Deliberately no
// `server-only`, no Supabase client, no fetch — mirrors company-canon-logic.ts
// so this is importable by the client, the API route, and vitest fixtures
// alike, and so every finding here carries its own explicit reason/severity
// rather than a downstream re-parse of generated text.
import type { Channel, Classification, Direction, Interaction } from './types';
import { BOGUS_SITE_PATTERNS, emailDomain } from './md-history-import';

export interface ParsedContactCard {
  email?: string;
  emailDomain?: string;
  telefone?: string;
  endereco?: string;
  website?: string;
}

const EMAIL_LINE_RE = /Email:\s*([^\s/]+@[^\s/]+)/i;
const PHONE_LINE_RE = /Telefone:\s*([^/]+?)(?=\s*\/|\s*De\s+https?:|$)/i;
const ADDRESS_LINE_RE = /Endere[cç]o:\s*([^/]+?)(?=\s*\/|\s*De\s+https?:|$)/i;
const SOURCE_URL_RE = /De\s+(https?:\/\/\S+)/i;

// A "metadata card" is contact-details prose (an auto-reply, a signature
// dump, a contact-form confirmation) rather than a real outreach signal —
// an email plus at least one of phone/address/source-url is the tell. Email
// alone isn't enough (ordinary outreach prose often mentions an email too).
export function looksLikeMetadataCard(text: string): boolean {
  return EMAIL_LINE_RE.test(text) && (PHONE_LINE_RE.test(text) || ADDRESS_LINE_RE.test(text) || SOURCE_URL_RE.test(text));
}

export function parseMetadataCard(text: string): ParsedContactCard {
  const email = text.match(EMAIL_LINE_RE)?.[1]?.trim();
  const telefone = text.match(PHONE_LINE_RE)?.[1]?.trim();
  const endereco = text.match(ADDRESS_LINE_RE)?.[1]?.trim();
  const site = text.match(SOURCE_URL_RE)?.[1]?.trim();
  const website = site && !BOGUS_SITE_PATTERNS.test(site) ? site : undefined;
  return { email, emailDomain: emailDomain(email), telefone, endereco, website };
}

export interface MechanicalResult { classification: Classification; confidence: 'high'; reason: string }

// Deterministic, no-AI-needed resolution for the one shape in this data
// that's genuinely unambiguous: an outbound message with no inbound reply
// anywhere after it in the same entity's thread. There is no real signal to
// classify there, so "awaiting" is a safe, defensible default. Anything
// else — an inbound message, or an outbound that was eventually answered —
// genuinely needs a real read (AI or human), not a guess from direction alone.
export function classifyMechanically(target: Interaction, threadForEntity: Interaction[]): MechanicalResult | null {
  if (target.direction !== 'out') return null;
  const sorted = [...threadForEntity].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const idx = sorted.findIndex((i) => i.id === target.id);
  if (idx === -1) return null;
  const hasReplyAfter = sorted.slice(idx + 1).some((i) => i.direction === 'in');
  if (hasReplyAfter) return null;
  return {
    classification: 'awaiting',
    confidence: 'high',
    reason: 'Outbound message with no inbound reply anywhere afterward in this thread — no real signal to classify.',
  };
}

export interface AiClassificationProposal {
  interactionId: string;
  kind: 'metadata_card' | 'interaction';
  proposedClassification?: Classification;
  directionCorrection?: Direction;
  channelCorrection?: Channel;
  confidence: 'high' | 'low';
  reason: string;
}

export type AutoApplyDecision = 'metadata' | 'classify' | 'queue';

// The one rule for what a proposal (AI or mechanical) is trusted enough to
// apply without a human looking at it first: high confidence, and — for a
// metadata_card claim — an actual parsed field the regex can back up (never
// trust the model's say-so alone for something that fills real entity
// fields). Everything else stays in the human queue, with the proposal and
// its reason shown alongside so review is a one-click accept, not a re-read.
export function decideAutoApply(p: AiClassificationProposal, parsedCard?: ParsedContactCard): AutoApplyDecision {
  if (p.kind === 'metadata_card') {
    return p.confidence === 'high' && !!(parsedCard?.emailDomain || parsedCard?.website) ? 'metadata' : 'queue';
  }
  return p.confidence === 'high' && !!p.proposedClassification ? 'classify' : 'queue';
}
