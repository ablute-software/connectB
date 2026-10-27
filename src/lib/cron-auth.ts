// Who may call the daily tick without a session: the platform's own cron, and only it.
//
// vercel.json schedules GET /api/automations once a day. A cron call has NO session, and the auth middleware (src/middleware.ts) sends every request without one that is not on
// its PUBLIC list to /login — so for as long as the route was not on that list, the cron's call was answered 307 → /login and the daily job never ran on its own (found on
// 22/10/2026: no `daily_cron` snapshot on 11 of 63 days, none on whole weekends, and the monthly deliveries of 1 September and 1 October left at 00:02 and 13:31 UTC — hours
// outside the 09:00–09:59 window of a «0 9 * * *» Hobby cron — i.e. somebody opened the route by hand). Making the path simply public would let anyone on the internet run the
// tick (AI reconciliation, emails, deliveries), so the way in is the one Vercel itself provides: when the project has a CRON_SECRET environment variable, every cron call carries
// `Authorization: Bearer <CRON_SECRET>`. The middleware lets exactly that one path through, and only with exactly that header.
//
// Pure and dependency-free on purpose: it runs in the middleware (Edge runtime — no Node `crypto.timingSafeEqual`) and in tests.

/** A secret shorter than this never opens the door: an unset variable, an empty one, or «x» must not become a password. */
export const CRON_SECRET_MIN_LENGTH = 16;

/** The one path the cron may reach without a session. */
export const CRON_PATH = '/api/automations';

/**
 * Is this `Authorization` header the cron's? Fails CLOSED: no secret configured (or a short one) → false for every header, including the empty one. The comparison always walks the
 * whole of the longer string, so how long it takes does not say how many leading characters were right.
 */
export function cronSecretMatches(authorization: string | null | undefined, secret: string | undefined | null): boolean {
  if (!secret || secret.length < CRON_SECRET_MIN_LENGTH) return false;
  const expected = `Bearer ${secret}`;
  const given = authorization ?? '';
  let diff = given.length === expected.length ? 0 : 1;
  const n = Math.max(given.length, expected.length);
  for (let i = 0; i < n; i++) diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when this request is the platform's cron calling the tick: the exact path, the exact secret. */
export function isCronTickRequest(pathname: string, authorization: string | null | undefined, secret: string | undefined | null): boolean {
  return pathname === CRON_PATH && cronSecretMatches(authorization, secret);
}
