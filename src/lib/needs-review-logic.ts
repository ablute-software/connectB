// Needs-review dossier redesign — pure, DB-free logic for the AI
// pre-classification pass: detecting contact-metadata cards, resolving the
// one unambiguous "no real signal" shape deterministically (no AI call
// needed), and deciding what an AI proposal is confident enough to
// auto-apply without a human looking at it first. Deliberately no
// `server-only`, no Supabase client, no fetch — mirrors company-canon-logic.ts
// so this is importable by the client, the API route, and vitest fixtures
// alike, and so every finding here carries its own explicit reason/severity
// rather than a downstream re-parse of generated text.
import type { Channel, Classification, Direction, Entity, Interaction } from './types';
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

// ===== Triage toolkit (founder feedback: the Alantra dossier) =====

// The date the .md import stamps on rows whose source had "(sem data)" — see
// src/app/api/import/md/commit/route.ts's UNKNOWN_DATE_PLACEHOLDER. Because
// it pre-dates everything else, one such row silently distorts an entity's
// "last touch N days ago" (Alantra: stamped 2018-01-01, real date 2022).
export const PLACEHOLDER_DATE = '2018-01-01T00:00:00.000Z';

export function isPlaceholderDate(occurredAt: string | undefined): boolean {
  return !!occurredAt && occurredAt.slice(0, 10) === '2018-01-01';
}

const PT_MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, 'março': 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};
const PT_MONTH_ALT = Object.keys(PT_MONTHS).join('|');
// "25 de maio de 2022" (the Alantra case), also "25 maio 2022".
const PT_LONG_DATE_RE = new RegExp(`\\b(\\d{1,2})\\s+(?:de\\s+)?(${PT_MONTH_ALT})\\s+(?:de\\s+)?(\\d{4})\\b`, 'i');
// "maio de 2022" — month + year, no day (defaults to the 1st).
const PT_MONTH_YEAR_RE = new RegExp(`\\b(${PT_MONTH_ALT})\\s+de\\s+(\\d{4})\\b`, 'i');
const NUMERIC_DMY_RE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

function pad(n: number): string { return String(n).padStart(2, '0'); }

// Parses the first plausible date out of an interaction's own text and
// returns it as YYYY-MM-DD (or undefined). Used to pre-suggest a correction
// for the import's placeholder date with one click. Portuguese month names
// (the source's language) come first; numeric and ISO forms as fallbacks.
export function suggestDateFromContent(content: string): string | undefined {
  const long = content.match(PT_LONG_DATE_RE);
  if (long) {
    const day = Number(long[1]); const month = PT_MONTHS[long[2].toLowerCase()]; const year = Number(long[3]);
    if (month && day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`;
  }
  const my = content.match(PT_MONTH_YEAR_RE);
  if (my) {
    const month = PT_MONTHS[my[1].toLowerCase()]; const year = Number(my[2]);
    if (month) return `${year}-${pad(month)}-01`;
  }
  const num = content.match(NUMERIC_DMY_RE);
  if (num) {
    const day = Number(num[1]); const month = Number(num[2]); const year = Number(num[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad(month)}-${pad(day)}`;
  }
  const iso = content.match(ISO_DATE_RE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

// Light hint for the "Criar pessoa daqui" route action — the founder edits
// the pre-filled mini-form anyway, so this only has to get close. Email is
// the first address in the text; the name is derived from its local part
// ("merce.tell@…" -> "Merce Tell") when that part has a separator, which is
// reliable enough to pre-fill without guessing at capitalized prose.
export function parsePersonHint(content: string): { name?: string; email?: string } {
  const email = content.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0];
  let name: string | undefined;
  if (email) {
    const local = email.split('@')[0];
    if (/[._-]/.test(local)) {
      name = local.split(/[._-]+/).filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
  }
  return { name, email };
}

// ---- Fragment merge ("Belongs to…", Prompt 371 §3b) ----
// Import formats are infinite (OneNote, Notes, whatever editor a founder
// happened to use) — this deliberately never tries to parse by SOURCE
// FORMAT. The durable approach is a parser of CONTENT (what does this short
// fragment actually look like — a bare time, a bare date, or just text?)
// producing a confirmable proposal, the same "app assembles, founder
// confirms" shape as every other CERNE-aligned feature in this codebase.
export type FragmentKind = 'time' | 'date' | 'text';

// "13:18" or "13h18" and nothing else — a lone clock reading, the exact
// OneNote artifact the founder reported (the call's time, orphaned from
// the note describing the call itself).
const BARE_TIME_RE = /^(\d{1,2})[:h](\d{2})$/i;
// A fragment short enough that a parsed date plausibly IS the whole
// fragment, not prose that happens to mention one in passing.
const MAX_BARE_DATE_LENGTH = 40;

export function classifyFragment(content: string): FragmentKind {
  const trimmed = content.trim();
  if (BARE_TIME_RE.test(trimmed)) return 'time';
  if (trimmed.length <= MAX_BARE_DATE_LENGTH && suggestDateFromContent(trimmed)) return 'date';
  return 'text';
}

export interface FragmentMergeResult {
  targetPatch: Partial<Interaction>;
}

// Pure: given a fragment interaction and the target it belongs to, compute
// the patch the target needs. Never mutates, never decides removal — the
// caller (NeedsReviewPanel) owns pushUndo/removeInteraction so the whole
// operation stays one undoable unit.
export function mergeFragmentIntoTarget(fragment: Interaction, target: Interaction): FragmentMergeResult {
  const kind = classifyFragment(fragment.content);
  if (kind === 'time') {
    const m = fragment.content.trim().match(BARE_TIME_RE);
    if (m) {
      const hh = m[1].padStart(2, '0');
      const mm = m[2];
      const day = target.occurred_at.slice(0, 10);
      return { targetPatch: { occurred_at: `${day}T${hh}:${mm}:00.000Z` } };
    }
  }
  if (kind === 'date') {
    const iso = suggestDateFromContent(fragment.content.trim());
    if (iso) return { targetPatch: { occurred_at: `${iso}T12:00:00.000Z` } };
  }
  // Prompt 371 §3b — same " / " separator the source import format already
  // uses for concatenated fields (looksLikeMetadataCard's own convention),
  // so a merged fragment reads consistently with everything else on screen.
  const existing = target.content?.trim() ?? '';
  const merged = existing ? `${existing} / ${fragment.content.trim()}` : fragment.content.trim();
  return { targetPatch: { content: merged } };
}

// A short list of merge candidates for the "Juntar a outra interação"
// picker: same entity, never the fragment itself, never a stage_change
// (that's a system-recorded transition, not a note a fragment could
// plausibly belong to), most recent first.
export function mergeCandidates(fragment: Interaction, threadForEntity: Interaction[]): Interaction[] {
  return threadForEntity
    .filter((i) => i.id !== fragment.id && i.channel !== 'stage_change')
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

// ---- Undo (single-step, session-scoped) ----
// Every triage action captures the prior state it needs to reverse, and
// invertTriageAction turns that into a list of primitive store operations.
// Kept pure so the inverse logic is unit-tested without a store.
export type UndoOp =
  | { kind: 'updateInteraction'; id: string; patch: Partial<Interaction> }
  | { kind: 'removeInteraction'; id: string }
  | { kind: 'removePerson'; id: string }
  | { kind: 'updateEntity'; id: string; patch: Partial<Entity> }
  // Prompt 371 §3b — the inverse of a merge's removeInteraction: re-adds the
  // absorbed fragment. A NEW id is generated (addInteraction's contract
  // everywhere else in this file already works this way — there is no
  // "recreate with the same id" primitive in the store) — functionally
  // identical to the founder, who never sees raw ids.
  | { kind: 'restoreInteraction'; interaction: Interaction };

export type TriageAction =
  // Covers classify, clear-flag, and every inline field edit — they are all
  // just interaction-field patches, reversed by re-applying the prior values.
  | { type: 'editInteraction'; interactionId: string; prev: Partial<Interaction> }
  // A person was created from an item and one or more interactions linked to
  // them: unlink each (restoring its prior person_id), then remove the person.
  | { type: 'routePerson'; personId: string; links: { interactionId: string; prevPersonId?: string }[] }
  // Entity contact fields were filled + a note appended + the item cleared:
  // restore the entity fields and re-flag the item.
  | { type: 'routeEntityData'; entityId: string; interactionId: string; prevEntity: Partial<Entity>; prevNeedsReview: boolean }
  // A brand-new interaction was added to the thread: remove it.
  | { type: 'addInteraction'; interactionId: string }
  // Prompt 371 §3b — a fragment was absorbed into a target interaction:
  // restore the target's prior fields and bring the fragment itself back.
  | { type: 'mergeFragment'; fragment: Interaction; targetId: string; prevTargetPatch: Partial<Interaction> };

export function invertTriageAction(action: TriageAction): UndoOp[] {
  switch (action.type) {
    case 'editInteraction':
      return [{ kind: 'updateInteraction', id: action.interactionId, patch: action.prev }];
    case 'routePerson':
      return [
        ...action.links.map((l): UndoOp => ({ kind: 'updateInteraction', id: l.interactionId, patch: { person_id: l.prevPersonId } })),
        { kind: 'removePerson', id: action.personId },
      ];
    case 'routeEntityData':
      return [
        { kind: 'updateEntity', id: action.entityId, patch: action.prevEntity },
        { kind: 'updateInteraction', id: action.interactionId, patch: { needs_review: action.prevNeedsReview } },
      ];
    case 'addInteraction':
      return [{ kind: 'removeInteraction', id: action.interactionId }];
    case 'mergeFragment':
      return [
        { kind: 'updateInteraction', id: action.targetId, patch: action.prevTargetPatch },
        { kind: 'restoreInteraction', interaction: action.fragment },
      ];
  }
}
