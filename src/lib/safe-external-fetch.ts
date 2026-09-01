// Prompt 512 — fetching a URL the FOUNDER chose, not one from a fixed
// allowlist.
//
// The existing precedent (isAllowedLinkedInUrl in gap-assist-sources.ts) is
// safe for a reason that does not generalise: its allowlist is a single
// hard-coded domain, so no attacker-chosen host ever reaches fetch(). This
// prompt's whole point is that "the link on the VC's own site that shows
// this person's role" is an arbitrary domain — https://clave.capital/equipo/
// is the founder's own example. That makes it a server-side request forgery
// surface, and copying isAllowedLinkedInUrl verbatim would be exactly wrong.
//
// The non-negotiable part is that the hostname is NOT the thing to trust.
// `internal.example.com` can resolve to 127.0.0.1, 169.254.169.254 (the
// cloud metadata endpoint) or an RFC1918 address, and it can resolve
// differently on the second lookup than the first. So:
//   1. syntax gate    — https only, no credentials, no explicit odd port
//   2. DNS gate       — resolve, and reject if ANY answer is a blocked IP
//   3. connect gate   — every redirect hop repeats 1 and 2, never blindly
//                       followed by fetch() itself (redirect: 'manual')
//   4. blast radius   — short timeout, hard byte cap, HTML/text only
//
// Residual gap, stated rather than papered over: between the DNS check and
// the socket connect there is a TOCTOU window (classic DNS rebinding) that
// only a custom agent pinning the connection to the checked IP would close.
// Node's fetch does not expose that hook without an undici Agent, and the
// blast radius here is a GET whose body is only ever passed to the model —
// no credentials are attached and no response is echoed verbatim to the
// founder. Worth closing if this ever fetches with authentication.
import { lookup } from 'node:dns/promises';

export const FETCH_TIMEOUT_MS = 5000;
export const MAX_RESPONSE_BYTES = 512 * 1024;
export const MAX_REDIRECTS = 3;

export interface UrlRejection { ok: false; reason: string }
export interface UrlAccepted { ok: true; url: URL }
export type UrlCheck = UrlAccepted | UrlRejection;

// A DNS resolver shaped like node:dns/promises' lookup, injectable so the
// tests can exercise "this public-looking hostname resolves to 127.0.0.1"
// deterministically, without depending on a real DNS answer.
export type DnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

const defaultLookup: DnsLookup = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((a) => ({ address: a.address, family: a.family }));
};

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) + n;
  }
  return out >>> 0;
}

// Every IPv4 range that must never be reachable from a founder-supplied URL.
// 169.254.0.0/16 is called out separately in the prompt for good reason: it
// carries 169.254.169.254, the cloud instance-metadata endpoint, which is
// the single highest-value SSRF target on any hosted platform.
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // RFC1918 private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, incl. cloud metadata
  ['172.16.0.0', 12],    // RFC1918 private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],   // RFC1918 private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, incl. 255.255.255.255 broadcast
];

export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable is not provably public
  return BLOCKED_V4.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseInt & mask);
  });
}

export function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().split('%')[0]; // strip zone id
  if (addr === '::' || addr === '::1') return true;
  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms smuggle a v4
  // address through a v6 literal — judge them by the embedded v4 address.
  const embedded = addr.match(/^(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (embedded) return isBlockedIpv4(embedded[1]);
  if (/^f[cd][0-9a-f]{2}:/.test(addr)) return true;                 // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(addr)) return true;                 // fe80::/10 link-local
  if (addr.startsWith('2002:')) return true;                        // 6to4, wraps a v4 address
  if (addr.startsWith('64:ff9b:')) return true;                     // NAT64, wraps a v4 address
  return false;
}

export function isBlockedIp(ip: string, family?: number): boolean {
  if (family === 4 || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return isBlockedIpv4(ip);
  return isBlockedIpv6(ip);
}

/**
 * Syntax gate. Cheap, runs before any network activity, and rejects the
 * shapes that make later checks meaningless.
 */
export function checkExternalUrlSyntax(raw: string | null | undefined): UrlCheck {
  if (!raw || !raw.trim()) return { ok: false, reason: 'A link is required.' };

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }

  // http:// is refused rather than upgraded: silently rewriting a founder's
  // link would make the thing we fetched differ from the thing they vouched
  // for, which is the one property this evidence rests on.
  if (url.protocol !== 'https:') return { ok: false, reason: 'The link must start with https://' };
  if (url.username || url.password) return { ok: false, reason: 'The link must not contain credentials.' };

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, reason: 'The link has no host.' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, reason: 'That link points to a local address.' };
  }
  // A bare IP literal can never be "the VC's own site" and skips DNS
  // entirely, so it is judged here directly.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && isBlockedIpv4(host)) {
    return { ok: false, reason: 'That link points to a private address.' };
  }
  if (host.startsWith('[') && isBlockedIpv6(host.slice(1, -1))) {
    return { ok: false, reason: 'That link points to a private address.' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'The link must use the standard https port.' };
  }
  return { ok: true, url };
}

/**
 * DNS gate. Rejects if the hostname resolves to ANY blocked address — not
 * just the first one. A host with one public and one loopback answer is
 * rejected: the connect could pick either.
 */
export async function checkResolvesToPublicIp(
  hostname: string, dnsLookup: DnsLookup = defaultLookup,
): Promise<UrlRejection | { ok: true; addresses: string[] }> {
  let answers: { address: string; family: number }[];
  try {
    answers = await dnsLookup(hostname);
  } catch {
    return { ok: false, reason: 'That domain could not be resolved.' };
  }
  if (!answers.length) return { ok: false, reason: 'That domain could not be resolved.' };
  for (const a of answers) {
    if (isBlockedIp(a.address, a.family)) {
      return { ok: false, reason: 'That link points to a private address.' };
    }
  }
  return { ok: true, addresses: answers.map((a) => a.address) };
}

export interface FetchedPage { ok: true; finalUrl: string; text: string; truncated: boolean }
export type FetchResult = FetchedPage | UrlRejection;

const ALLOWED_CONTENT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)/i;

/**
 * Fetch a founder-supplied page with every gate applied, re-checking each
 * redirect hop rather than delegating redirects to fetch().
 */
export async function fetchExternalPage(
  raw: string,
  opts: { dnsLookup?: DnsLookup; fetchImpl?: typeof fetch } = {},
): Promise<FetchResult> {
  const dnsLookup = opts.dnsLookup ?? defaultLookup;
  const doFetch = opts.fetchImpl ?? fetch;

  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const syntax = checkExternalUrlSyntax(current);
    if (!syntax.ok) return syntax;

    const dns = await checkResolvesToPublicIp(syntax.url.hostname, dnsLookup);
    if (!dns.ok) return dns;

    let res: Response;
    try {
      res = await doFetch(syntax.url.toString(), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'text/html,application/xhtml+xml,text/plain' },
        // Never let fetch follow a redirect for us: a 302 to
        // http://169.254.169.254 would otherwise bypass every gate above.
        redirect: 'manual',
      });
    } catch {
      return { ok: false, reason: 'That page could not be reached.' };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: false, reason: 'That page redirected nowhere.' };
      // Resolved against the current URL so a relative Location works, then
      // sent back through the full gate set on the next iteration.
      current = new URL(location, syntax.url).toString();
      continue;
    }

    if (!res.ok) return { ok: false, reason: `That page returned ${res.status}.` };

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !ALLOWED_CONTENT_TYPES.test(contentType)) {
      return { ok: false, reason: 'That link is not a web page.' };
    }

    const read = await readCapped(res);
    if (!read.text.trim()) return { ok: false, reason: 'That page had no readable content.' };
    return { ok: true, finalUrl: syntax.url.toString(), text: read.text, truncated: read.truncated };
  }

  return { ok: false, reason: 'That link redirected too many times.' };
}

// Read at most MAX_RESPONSE_BYTES, streaming. Content-Length is not trusted
// as the cap because a hostile or misconfigured server can understate it.
async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: await res.text(), truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_RESPONSE_BYTES - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated };
}
