// Prompt 576 Fase 3 — what Suspend/Delete actually does, per target type.
// Stated from the real effects (migration 0315's own header, read before
// writing this), not invented: applyModerationAction only ever writes
// moderation_status/moderation_quarantine_until/moderation_suspended_until
// (moderation-actions.ts) — every visibility consequence below is a
// downstream READ of that status by another function, listed here so the
// side panel never promises an effect the code doesn't have.
//
// Prompt 900 — the sign-in line is no longer the same for the two actions. The door (account_access_state → is_account_suspended,
// SQL) treats a SUSPENSION as a sanction on the person — it blocks them whatever else they hold — and a DELETED account as a sanction
// on the project: it blocks only a person with nothing else live to sign in to (an active ecosystem-organisation membership, or an
// active seat in an investor firm). Saying "blocks sign-in for every member" under Delete would now promise an effect the code does
// not have, so the two are worded apart, and the delete wording says how to lock a person out whatever else they hold.
import type { ModerationTargetType } from './account-moderation';

export type CascadeAction = 'suspend' | 'delete';

const CASCADE_COPY: Record<ModerationTargetType, Record<CascadeAction, string[]>> = {
  org: {
    suspend: [
      'Blocks sign-in for every member of this startup, whatever else they hold.',
      "Removes this startup from every investor's MatchDeal deck and discovery (matchdeal_profile_discovery_excluded) for as long as it stays suspended or deleted.",
    ],
    delete: [
      'Blocks sign-in for every member of this startup who has nothing else live to sign in to. A member who also belongs to an ecosystem organisation, or holds an investor seat, still gets in through that — a deleted startup is a sanction on the project, not on the person. To lock a person out whatever else they hold: suspend instead, or block their e-mail.',
      "Removes this startup from every investor's MatchDeal deck and discovery (matchdeal_profile_discovery_excluded) for as long as it stays suspended or deleted.",
    ],
  },
  investor: {
    suspend: [
      'Blocks sign-in for every seat on this account, whatever else they hold.',
      'Removes this firm from catalog_top_matches — founders stop being offered it in their pipeline.',
      "Removes this firm from founders' MatchDeal discovery.",
    ],
    delete: [
      'Blocks sign-in for every seat on this account who has nothing else live to sign in to. A seat holder who also belongs to an ecosystem organisation, or holds a seat in another firm, still gets in through that. To lock a person out whatever else they hold: suspend instead, or block their e-mail.',
      'Removes this firm from catalog_top_matches — founders stop being offered it in their pipeline.',
      "Removes this firm from founders' MatchDeal discovery.",
    ],
  },
};

export function moderationCascadeLines(targetType: ModerationTargetType, action: CascadeAction): string[] {
  return CASCADE_COPY[targetType][action];
}
