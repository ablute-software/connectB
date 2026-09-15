// Prompt 703 §4 — investor-firm equivalent of platform-badges-server.ts,
// scoped to exactly what was asked: grant/revoke with a required
// justification, into investor_platform_badges (migration 20260915220000).
// Deliberately NOT a Stripe-coupon-applying, tech-master-lapse-tracking
// mirror of the founder file — none of that was requested for investors,
// and investor billing already has its own separate mechanism
// (investor-billing-access.ts / Stripe investor checkout) unrelated to
// this badge system.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlatformBadgeKey } from './platform-badges';

export interface InvestorPlatformBadgeRow {
  id: string;
  catalogEntityId: string;
  badge: PlatformBadgeKey;
  grantedAt: string;
  grantedBy: string | null;
  justification: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export const INVESTOR_PLATFORM_BADGE_COLUMNS =
  'id, catalog_entity_id, badge, granted_at, granted_by, justification, revoked_at, revoked_by, revoke_reason';

type DbRow = {
  id: string; catalog_entity_id: string; badge: PlatformBadgeKey; granted_at: string; granted_by: string | null;
  justification: string; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null;
};

export function toInvestorBadgeRow(r: DbRow): InvestorPlatformBadgeRow {
  return {
    id: r.id, catalogEntityId: r.catalog_entity_id, badge: r.badge, grantedAt: r.granted_at, grantedBy: r.granted_by,
    justification: r.justification, revokedAt: r.revoked_at, revokedBy: r.revoked_by, revokeReason: r.revoke_reason,
  };
}

/** An investor firm's ACTIVE badges only — the same "revoked rows stay as
 *  history, active is what counts" convention loadOrgPlatformBadges uses. */
export async function loadInvestorPlatformBadges(admin: SupabaseClient, catalogEntityId: string): Promise<InvestorPlatformBadgeRow[]> {
  const { data, error } = await admin.from('investor_platform_badges')
    .select(INVESTOR_PLATFORM_BADGE_COLUMNS).eq('catalog_entity_id', catalogEntityId).is('revoked_at', null);
  if (error) return [];
  return ((data ?? []) as unknown as DbRow[]).map(toInvestorBadgeRow);
}
