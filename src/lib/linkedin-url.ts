// Prompt 613 §C.2 — a LinkedIn address is either normalised or refused at the
// door. It is never stored as typed.
//
// What was in production on 2026-09-08, on a real founder's row:
//
//     linkedin.com\nunomarujo
//
// A backslash where `/in/` should be. `new URL()` throws on it, so every
// reader in the app treated it as absent — silently, because the LinkedIn
// fetch path swallows failures. The founder saw a field they had filled in
// and a product that behaved as if they had not.
//
// Normalising is the cheap half. The important half is that the failures are
// LOUD: a value this module cannot make sense of comes back as a refusal
// with a reason, and the caller shows it, instead of writing something no
// reader will ever be able to use.

export type LinkedInResult =
  | { ok: true; url: string; handle: string }
  | { ok: false; reason: string };

// Accepts what people actually paste: with or without scheme, with or
// without www/country subdomain, with tracking query, with a trailing slash,
// and the bare handle on its own.
const HOST = /^(?:[a-z]{2,3}\.)?linkedin\.com$/i;

export function normalizeLinkedInUrl(raw: string | null | undefined): LinkedInResult {
  const input = (raw ?? '').trim();
  if (!input) return { ok: false, reason: 'Empty.' };

  // Backslashes are the observed failure. Converting them is safe — no valid
  // LinkedIn URL contains one — and turns the production value above into
  // "linkedin.com/nunomarujo", which the path rules below then repair.
  const cleaned = input.replace(/\\/g, '/').replace(/\s+/g, '');

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return { ok: false, reason: 'That does not look like a web address.' };
  }

  if (!HOST.test(parsed.hostname)) {
    return { ok: false, reason: 'That is not a linkedin.com address.' };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  // The handle is the segment after /in/ when it is there, and the only
  // segment when the founder pasted "linkedin.com/nunomarujo" — or the
  // backslash form, which collapses to exactly that.
  const inIndex = segments.findIndex((s) => s.toLowerCase() === 'in');
  const handle = inIndex >= 0 ? segments[inIndex + 1] : segments.length === 1 ? segments[0] : undefined;

  // A company page is a real LinkedIn URL and a real mistake in a field about
  // a person; saying which is more use than "invalid". Checked BEFORE the
  // missing-handle branch: /company/ablute has no /in/ segment either, so
  // testing in the other order answers the less useful of the two questions.
  if (segments[0]?.toLowerCase() === 'company') {
    return { ok: false, reason: 'That is a company page, not a person’s profile.' };
  }
  if (!handle) {
    return { ok: false, reason: 'That LinkedIn address has no profile name in it.' };
  }
  if (!/^[A-Za-z0-9\-_%]{2,100}$/.test(handle)) {
    return { ok: false, reason: 'That profile name has characters LinkedIn does not use.' };
  }

  // One canonical form, so two rows for the same person compare equal and the
  // stored value is the one LinkedIn itself redirects to.
  return { ok: true, url: `https://www.linkedin.com/in/${handle.toLowerCase()}`, handle: handle.toLowerCase() };
}

/** Convenience for write paths: normalised value, or null if unusable. */
export function toStorableLinkedInUrl(raw: string | null | undefined): string | null {
  const r = normalizeLinkedInUrl(raw);
  return r.ok ? r.url : null;
}
