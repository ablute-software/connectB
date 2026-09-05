// Prompt 576 Fase 3 — what Suspend/Delete actually does, per target type.
// Stated from the real effects (migration 0315's own header, read before
// writing this), not invented: applyModerationAction only ever writes
// moderation_status/moderation_quarantine_until/moderation_suspended_until
// (moderation-actions.ts) — every visibility consequence below is a
// downstream READ of that status by another function, listed here so the
// side panel never promises an effect the code doesn't have.
import type { ModerationTargetType } from './account-moderation';

const CASCADE_COPY: Record<ModerationTargetType, string[]> = {
  org: [
    'Blocks sign-in for every member of this startup.',
    "Removes this startup from every investor's MatchDeal deck and discovery (matchdeal_profile_discovery_excluded) for as long as it stays suspended or deleted.",
  ],
  investor: [
    'Blocks sign-in for every seat on this account.',
    'Removes this firm from catalog_top_matches — founders stop being offered it in their pipeline.',
    "Removes this firm from founders' MatchDeal discovery.",
  ],
};

export function moderationCascadeLines(targetType: ModerationTargetType): string[] {
  return CASCADE_COPY[targetType];
}
