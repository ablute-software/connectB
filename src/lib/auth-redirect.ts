// Prompt 911 (addendum, 13/10/2026) — where the link in a sign-up email brings the person back to.
//
// The final "Confirm signup" template links to /auth/confirm with  next={{ .RedirectTo }}  — the emailRedirectTo each sign-up path
// gave Supabase — instead of a fixed destination, so a normal sign-up returns to the platform, a team invite to its invite, and a
// registration made from a call (Prompt 907) to that call and the page the applicant was on.
//
// Two pure functions, one for each side of that:
//  - safeRedirectPath: what a page may ASK for (validated again by the server, which builds the full URL from it);
//  - confirmDestination: what /auth/confirm will actually DO with the `next` it receives — {{ .RedirectTo }} is a full URL, and it
//    arrives in a query string, so it is never followed as given: it is reduced to a path on THIS site, and anything that is not
//    one of ours becomes the fallback. (Supabase only substitutes a redirect that is in its own allow-list, so this is the second lock.)

/** Hosts a sign-up email may bring the person back to. The link itself always goes to the Site URL, so the path is applied THERE. */
export const OWN_HOSTS: readonly string[] = ['www.sherlockdeal.com', 'sherlockdeal.com', 'connect-b-delta.vercel.app'];

/**
 * A path a sign-up page may ask the email link to return to. Relative to this site, no query-breaking or ambiguous characters:
 * the template puts it unencoded in `next={{ .RedirectTo }}`, so `&` and `#` would cut it short. A call's page is a path
 * (/call/<token>/…), which is all this needs to carry. Anything else is null, and the caller uses the platform (/).
 */
export function safeRedirectPath(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (v.length === 0 || v.length > 300) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\\&#\s\u0000-\u001f\u007f]/.test(v)) return null;
  if (v === '/api' || v.startsWith('/api/')) return null;
  return v;
}

/** The full URL handed to Supabase as emailRedirectTo: this site's origin + the validated path (the platform, "/", by default). */
export function redirectUrl(origin: string, path: unknown): string {
  return `${origin.replace(/\/+$/, '')}${safeRedirectPath(path) ?? '/'}`;
}

/**
 * What /auth/confirm does with `next`. Relative paths of this site are kept; an absolute URL of one of our own hosts (or the host the
 * page is on, for local work) is reduced to its path + query; everything else — another site, a `javascript:` URL, a protocol-relative
 * `//evil.example` — is the fallback.
 */
export function confirmDestination(next: string | null | undefined, currentOrigin: string, fallback = '/pipeline'): string {
  if (!next) return fallback;
  const v = next.trim();
  if (v.startsWith('/')) return v.startsWith('//') || v.startsWith('/\\') ? fallback : v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fallback;
    const current = new URL(currentOrigin).host;
    if (!OWN_HOSTS.includes(u.host) && u.host !== current) return fallback;
    const path = `${u.pathname}${u.search}`;
    return path === '' ? '/' : path;
  } catch {
    return fallback;
  }
}
