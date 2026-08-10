'use client';
// Prompt 97 — owns which of the 5 tabs is showing, sits below the existing
// /pair header (Wordmark + Paired pill, unchanged) and above the new tab
// bar. DealDigger (the swipe deck) is the default landing tab — /pair has
// always opened straight onto the deck, and nothing about that changes.
import { useState } from 'react';
import { MatchDealDeck } from './MatchDealDeck';
import { MatchesPanel } from './MatchesPanel';
import { InstantMessagePanel } from './InstantMessagePanel';
import { BoostExtraPanel } from './BoostExtraPanel';
import { ProfilePanel } from './ProfilePanel';
import { MatchDealTabBar, type MatchDealTab } from './MatchDealTabBar';

export function MatchDealShell({ viewerProfileId, viewerKind, deckLimit }: { viewerProfileId: string; viewerKind: 'startup' | 'investor'; deckLimit?: number }) {
  const [tab, setTab] = useState<MatchDealTab>('deck');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {tab === 'deck' && <MatchDealDeck viewerProfileId={viewerProfileId} viewerKind={viewerKind} deckLimit={deckLimit} />}
      {tab === 'matches' && <MatchesPanel viewerProfileId={viewerProfileId} viewerKind={viewerKind} />}
      {tab === 'messages' && <InstantMessagePanel viewerProfileId={viewerProfileId} viewerKind={viewerKind} />}
      {tab === 'boost' && <BoostExtraPanel viewerProfileId={viewerProfileId} viewerKind={viewerKind} />}
      {tab === 'profile' && <ProfilePanel viewerProfileId={viewerProfileId} viewerKind={viewerKind} />}
      <MatchDealTabBar active={tab} onChange={setTab} />
    </div>
  );
}
