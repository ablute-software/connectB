// Prompt 893 §A — the Conversation tab's own deep-link contract:
// ?tab=conversation&mode=history|log|messages (plus whatever sub-params a
// caller already passes through unchanged — person=, classify=, direction=,
// date=, content=, channel=, taskId=, focus=). Replaces the old bare
// ?rail=history|log deep link used by sherlock-next.ts, SherlockInsightBanner
// callers, Today's cards, ThreadDrawer, ReawakeningQueue, the document-request
// review page, and /people/[id].
//
// `?rail=` keeps working via alias for at least 30 days (spec's own
// instruction) — resolveConversationParams below is the ONE place that
// decides which form a URL is in; entities/[id]/page.tsx calls it instead
// of reading `rail`/`tab`/`mode` ad hoc.
import type { Channel } from './types';

export type ConversationMode = 'history' | 'log' | 'messages';

function isConversationMode(v: string | null): v is ConversationMode {
  return v === 'history' || v === 'log' || v === 'messages';
}

// Builds the new-form query string for a Conversation deep link into
// /entities/<id>. `extra` carries through whatever sub-params the specific
// caller already needed (person, classify, direction, date, content,
// channel, taskId, focus) — same optional-and-omit-when-falsy shape every
// existing call site already used for `rail=`.
export function conversationDeepLink(entityId: string, mode: ConversationMode, extra?: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  params.set('tab', 'conversation');
  params.set('mode', mode);
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined || v === '') continue;
    params.set(k, String(v));
  }
  return `/entities/${entityId}?${params.toString()}`;
}

export interface ResolvedConversationParams {
  // 'conversation' when either the new ?tab=conversation form or a legacy
  // ?rail= alias resolved to it; null when neither param is present at all
  // (a plain /entities/<id> visit, or a deep link into one of the OTHER
  // Zone-B tabs, which don't carry a `mode`).
  tab: string | null;
  mode: ConversationMode | null;
  // True only for the legacy `?rail=` alias — lets the caller optionally
  // canonicalize the URL (router.replace) without a second parse.
  isLegacyRailAlias: boolean;
}

export function resolveConversationParams(searchParams: { get(name: string): string | null }): ResolvedConversationParams {
  const tab = searchParams.get('tab');
  if (tab) {
    const mode = searchParams.get('mode');
    return { tab, mode: isConversationMode(mode) ? mode : null, isLegacyRailAlias: false };
  }
  const rail = searchParams.get('rail');
  if (isConversationMode(rail)) {
    return { tab: 'conversation', mode: rail, isLegacyRailAlias: true };
  }
  return { tab: null, mode: null, isLegacyRailAlias: false };
}

// Re-exported so callers building a first-contact log link (the most
// common case, e.g. `?person=` + `?channel=`) don't need to import Channel
// from '@/lib/types' separately just for this.
export type { Channel };
