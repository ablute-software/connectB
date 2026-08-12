import 'server-only';
import { makeCapabilityProbe } from './capability-probe';

// Prompt 161 — gates every Pioneer-badge read/write (promo_codes.is_pioneer,
// promo_codes.referral_of_org_id, orgs.pioneer_badge — all three land in the
// same migration, 0167) so every caller degrades gracefully on an
// environment that hasn't applied it yet, instead of erroring.
export const pioneerBadgeAvailable = makeCapabilityProbe(async (admin) => {
  const [orgsProbe, promoProbe] = await Promise.all([
    admin.from('orgs').select('pioneer_badge').limit(1),
    admin.from('promo_codes').select('is_pioneer, referral_of_org_id').limit(1),
  ]);
  return !orgsProbe.error && !promoProbe.error;
});
