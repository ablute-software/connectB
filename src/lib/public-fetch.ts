// Prompt 918 B — reading a PUBLIC web page on the server: the page a founder gives as the source of a badge, and the logo a verification
// found. link-fetch.ts (Prompt 462) fetches only an allowlist of hosts; this one fetches any public https page, so what it must never
// do is reach anything that is not public. Same guards, hop by hop: https only and the default port, a real host name (no IP
// literals), every resolved address checked against loopback / link-local / private / CGNAT ranges (link-fetch's own functions,
// not a second copy), redirects followed by hand through the same gate, one timeout for the whole operation, the body streamed with a
// hard byte cap.
//
// Known, accepted gap, the same one link-fetch has: the address is resolved to be checked and fetch() resolves it again, so a DNS
// answer that changes between the two lookups (rebinding) is not caught here. What bounds the damage: a page becomes text for the
// model and is never shown to anyone as fetched; the only thing relayed to a person is a logo image (badge-logo-proxy.ts), and only
// after it passes an image-type allowlist, a 2 MB cap and a sandbox CSP — never the response of an arbitrary internal service.
import 'server-only';
import { hostResolvesToPrivateAddress } from './link-fetch';
import { normalizeSourceUrl } from './company-badges';
import { MAX_LOGO_BYTES, MAX_PAGE_BYTES } from './company-badge-verification';
import type { PageFetchResult } from './company-badge-verify-core';

export type PublicFetchFailure = 'bad_url' | 'not_https' | 'private_address' | 'too_many_redirects' | 'http_error' | 'timeout' | 'network_error';
export interface PublicFetchOk {
  ok: true; finalUrl: string; status: number; contentType: string; contentLength: number | null; bytes: Buffer; truncated: boolean;
}

const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SherlockDealBot/1.0; +https://www.sherlockdeal.com)';

export async function fetchPublicDocument(
  url: string, opts: { method: 'GET' | 'HEAD'; maxBytes: number; timeoutMs: number; accept: string },
): Promise<PublicFetchOk | { ok: false; reason: PublicFetchFailure }> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let current = url.replace(/^http:\/\//i, 'https://');

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return { ok: false, reason: 'bad_url' }; }
    if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
    if (parsed.port && parsed.port !== '443') return { ok: false, reason: 'bad_url' };
    if (!normalizeSourceUrl(current)) return { ok: false, reason: 'bad_url' }; // credentials, IP literals, localhost, one-label hosts
    if (await hostResolvesToPrivateAddress(parsed.hostname)) return { ok: false, reason: 'private_address' };

    let res: Response;
    try {
      res = await fetch(current, { method: opts.method, redirect: 'manual', signal, headers: { 'user-agent': USER_AGENT, accept: opts.accept } });
    } catch (e) {
      const name = (e as Error).name;
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === MAX_REDIRECTS) return { ok: false, reason: location ? 'too_many_redirects' : 'http_error' };
      try { current = new URL(location, current).toString().replace(/^http:\/\//i, 'https://'); } catch { return { ok: false, reason: 'http_error' }; }
      continue;
    }
    if (!res.ok) return { ok: false, reason: 'http_error' };

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const declared = Number(res.headers.get('content-length') ?? '');
    const contentLength = Number.isFinite(declared) && res.headers.has('content-length') ? declared : null;
    if (opts.method === 'HEAD' || !res.body) {
      return { ok: true, finalUrl: current, status: res.status, contentType, contentLength, bytes: Buffer.alloc(0), truncated: false };
    }

    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks.push(Buffer.from(value));
        if (total > opts.maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
      }
    } catch (e) {
      const name = (e as Error).name;
      return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
    }
    const all = Buffer.concat(chunks);
    return { ok: true, finalUrl: current, status: res.status, contentType, contentLength, bytes: truncated ? all.subarray(0, opts.maxBytes) : all, truncated };
  }
  return { ok: false, reason: 'too_many_redirects' };
}

/** The page behind a source link, as HTML. A page larger than the cap is read up to the cap (the head of the document is where its title and images are). */
export async function fetchSourcePage(url: string): Promise<PageFetchResult> {
  const r = await fetchPublicDocument(url, {
    method: 'GET', maxBytes: MAX_PAGE_BYTES, timeoutMs: 8_000, accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5',
  });
  if (!r.ok) return { ok: false, reason: r.reason };
  if (!/^(text\/html|application\/xhtml\+xml|text\/plain)/.test(r.contentType)) return { ok: false, reason: 'not_html' };
  return { ok: true, finalUrl: r.finalUrl, html: r.bytes.toString('utf8') };
}

/** Is this URL an image under 2 MB? HEAD first (cheap); a server that refuses HEAD or sends no length is asked once with a capped GET. */
export async function publicImageOk(url: string): Promise<boolean> {
  const head = await fetchPublicDocument(url, { method: 'HEAD', maxBytes: 1, timeoutMs: 5_000, accept: 'image/*' });
  if (head.ok && /^image\//.test(head.contentType) && head.contentLength !== null) {
    return head.contentLength > 0 && head.contentLength <= MAX_LOGO_BYTES;
  }
  if (head.ok && !/^image\//.test(head.contentType)) return false;
  if (!head.ok && head.reason !== 'http_error') return false; // unreachable or refused by us: no second try
  const get = await fetchPublicDocument(url, { method: 'GET', maxBytes: MAX_LOGO_BYTES, timeoutMs: 8_000, accept: 'image/*' });
  return get.ok && /^image\//.test(get.contentType) && !get.truncated && get.bytes.length > 0;
}
