// Prompt 462 §A — Fase 1a: a real, safe fetch of a document-link's own
// external_url, so document-link-snapshot.ts never has to (and never
// should) build its own copy of this. Deliberately NOT modeled on
// new-version-from-link/route.ts's own resolveDirectUrl/fetch pair — that
// route follows redirects unbounded (`redirect: 'follow'`), has no host
// allowlist, no private-address guard, and buffers the whole body before
// checking size. That is a real SSRF hole, left alone here on purpose
// (Fase 2 replaces it with this file — do not touch it in this slice).
// Modeled instead on the one thing this codebase already gets right:
// gap-assist-sources.ts's isAllowedLinkedInUrl — https-only, host checked
// by exact equality or explicit `.suffix`, never `includes`.
import 'server-only';
import dns from 'node:dns/promises';

export const LINK_FETCH_ALLOWED_HOSTS = [
  'drive.google.com',
  'drive.usercontent.google.com', // where Drive's own 303 redirects to
] as const;

export type LinkFetchFailure =
  | 'host_not_allowed' | 'not_https' | 'private_address' | 'too_many_redirects'
  | 'http_error' | 'too_large' | 'timeout' | 'network_error';

const MAX_REDIRECTS = 5;

export function isAllowedFetchUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return LINK_FETCH_ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

// Distinguishes WHY a URL was rejected (isAllowedFetchUrl only ever
// answers yes/no) — used once, right where fetchExternalBytes needs to
// pick a LinkFetchFailure reason for a URL that already failed the check
// above.
function classifyUrlRejection(raw: string): 'not_https' | 'host_not_allowed' {
  try {
    if (new URL(raw).protocol !== 'https:') return 'not_https';
  } catch {
    // Unparseable — same bucket as "not on the allowlist": there is no
    // host to have allowed in the first place.
  }
  return 'host_not_allowed';
}

// Google Drive's own share URL ("…/file/d/FILE_ID/view") serves an HTML
// viewer page, not the file — the same rewrite new-version-from-link's own
// resolveDirectUrl already does, confirmed working against a real deck.
// Any other URL passes through unchanged.
export function resolveDirectDownloadUrl(raw: string): string {
  const drive = /drive\.google\.com\/file\/d\/([^/]+)/.exec(raw);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  return raw;
}

// Prompt 462 §A.3 — defense in depth on top of the host allowlist: even a
// URL whose HOSTNAME is on the allowlist must not be allowed to resolve to
// a loopback/link-local/private/CGNAT address (DNS rebinding, a
// compromised/misconfigured resolver, or simply widening the allowlist
// later without re-deriving this check). Deliberately checked on every
// hop, not just the first — a redirect target re-enters the same gate.
function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // malformed -> never trust it
  const [a, b] = parts;
  if (a === 0) return true; // "this network" — unroutable, some stacks treat it as localhost
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === '::1' || a === '::') return true; // loopback / unspecified
  if (a.startsWith('fc') || a.startsWith('fd')) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(a)) return true; // fe80::/10 link-local (first hextet fe80-febf)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivateIPv4(mapped[1]); // IPv4-mapped — check the embedded address too
  return false;
}

async function hostResolvesToPrivateAddress(hostname: string): Promise<boolean> {
  let results: { address: string; family: number }[];
  try {
    results = await dns.lookup(hostname, { all: true });
  } catch {
    return true; // unresolvable — never treated as safe
  }
  if (results.length === 0) return true;
  return results.some((r) => (r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address)));
}

export async function fetchExternalBytes(
  url: string, opts: { maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; bytes: Buffer; finalUrl: string } | { ok: false; reason: LinkFetchFailure }> {
  // Prompt 462 §A.5 — one timeout for the whole operation (every hop plus
  // the streamed body read), not restarted per hop — a chain of redirects
  // each just under the limit could otherwise add up to an unbounded total.
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedFetchUrl(currentUrl)) return { ok: false, reason: classifyUrlRejection(currentUrl) };

    const hostname = new URL(currentUrl).hostname;
    if (await hostResolvesToPrivateAddress(hostname)) return { ok: false, reason: 'private_address' };

    let res: Response;
    try {
      // Prompt 462 §A.2 — manual, never 'follow': a redirect target must
      // pass through the SAME host-allowlist + private-address checks as
      // the original URL, which only this loop (not fetch()'s own redirect
      // handling) can enforce hop by hop.
      res = await fetch(currentUrl, { redirect: 'manual', signal });
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network_error' };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: 'http_error' };
      if (hop === MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return { ok: false, reason: 'http_error' };
      }
      continue;
    }

    if (!res.ok) return { ok: false, reason: 'http_error' };

    // Prompt 462 §A.4 — content-length is a fail-fast SHORTCUT only: it
    // can be absent, or simply wrong. The real cap is enforced below, on
    // the streamed body itself.
    const declaredLength = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > opts.maxBytes) return { ok: false, reason: 'too_large' };

    if (!res.body) return { ok: false, reason: 'network_error' };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > opts.maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, reason: 'too_large' };
        }
        chunks.push(value);
      }
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network_error' };
    }
    return { ok: true, bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))), finalUrl: currentUrl };
  }
  return { ok: false, reason: 'too_many_redirects' };
}
