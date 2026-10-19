// A new version of the app is available (Nuno, 16/10/2026): people with the app open for hours keep running the old code after a deploy. The app asks the server,
// now and then and when the tab comes back, which build it is serving; when that is not the build this page was loaded from, it OFFERS a reload — it never reloads
// by itself, so nothing being typed is lost. Pure rules here; the banner is src/components/NewVersionBanner.tsx; the server's answer is /api/version.

/** How often an open, visible tab asks. Coming back to the tab asks too, but never more than once a minute. */
export const VERSION_CHECK_EVERY_MS = 10 * 60 * 1000;
export const VERSION_CHECK_MIN_GAP_MS = 60 * 1000;

/** The build this code was made in: inlined at build time by next.config.mjs (empty when it was not set). */
export const CURRENT_BUILD_ID: string = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

/** A usable build id is a non-empty string. An empty or missing answer is NEVER a change: a failed fetch must not look like a new version (it did once, in the deploy check). */
export const isBuildId = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The server's id out of its answer, or null when the answer is not usable. */
export function buildIdFromResponse(body: unknown): string | null {
  const id = body && typeof body === 'object' ? (body as { buildId?: unknown }).buildId : null;
  return isBuildId(id) ? id.trim() : null;
}

/** True only when BOTH ids are real and differ. */
export const isNewVersion = (current: unknown, server: unknown): boolean => isBuildId(current) && isBuildId(server) && current.trim() !== server.trim();

/** Coming back to the tab (or a timer) asks, unless it asked less than a minute ago. */
export const shouldCheckNow = (lastCheckAt: number | null, now: number): boolean => lastCheckAt === null || now - lastCheckAt >= VERSION_CHECK_MIN_GAP_MS;
