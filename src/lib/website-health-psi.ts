// Prompt 919 A — the one call to Google's PageSpeed Insights API (v5): public, free, and the only external service this feature talks to.
// No Ahrefs / Semrush / Moz, nothing paid. The address is passed to GOOGLE, which loads the page from its own network: this server never
// fetches a founder's website itself (so there is no SSRF to guard here — the address is only validated for sanity, see
// normalizeWebsiteUrl).
//
// The key (PAGESPEED_API_KEY, in the Vercel project; Nuno creates it in the Google Cloud Console) is read by pageSpeedApiKey() below — the only
// place that reads it — and passed in by the caller. It is never logged, never stored, never put in an error message: an error that could echo
// the request URL is scrubbed below.
//
// What was seen on 16/10/2026 with NO key: HTTP 429 RESOURCE_EXHAUSTED with `quota_limit_value: "0"` for Google's shared project — the
// anonymous route is closed, so the key is required. The routes therefore treat a missing key as the feature being OFF (Prompt 919 addendum,
// 19/10/2026) and never send a keyless request; this module still builds one without a key when called without it (a pure function of its inputs)
// and classifies Google's answer as "quota", which is what it would be.
import 'server-only';
import {
  classifyPageSpeedHttpError, reducePageSpeedResponse, type ReduceResult, type WebsiteCheckError, type WebsiteStrategy,
} from './website-health';

export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
/**
 * The prompt asks for 60 s per call; a Vercel Hobby function lives 60 s in total and the two strategies run in PARALLEL inside it, so each
 * call gets 55 s: a timeout is then ours to report (a row with the reason), not the platform killing the function with nothing stored.
 */
export const PSI_TIMEOUT_MS = 55_000;
const CATEGORIES = ['performance', 'seo', 'accessibility', 'best-practices'] as const;

/**
 * The Google key, read in ONE place (Prompt 919 addendum, 19/10/2026). Whitespace-only counts as unset.
 *
 * Without it nothing can work: Google answers a keyless request with 429 RESOURCE_EXHAUSTED and `quota_limit_value: "0"` (seen on 16/10 and
 * again on 19/10/2026) — not "the free quota is used up for now, try later" but "this will never succeed until a key is set". So a missing key
 * means the founder-facing feature is OFF (no card, no request to Google, no row stored, nothing a founder is told to wait for), and the back
 * office says so in words and refuses to run a forced check (docs/ops/CONFIG_REGISTRY.md §1.4b has the instruction to set it).
 */
export function pageSpeedApiKey(): string | undefined {
  const key = process.env.PAGESPEED_API_KEY?.trim();
  return key ? key : undefined;
}

export function buildPageSpeedRequestUrl(url: string, strategy: WebsiteStrategy, apiKey: string | undefined): string {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  for (const c of CATEGORIES) params.append('category', c);
  if (apiKey) params.set('key', apiKey);
  return `${PSI_ENDPOINT}?${params.toString()}`;
}

const scrub = (e: WebsiteCheckError): WebsiteCheckError => ({ ...e, message: e.message.replace(/([?&]?key=)[A-Za-z0-9_-]{8,}/gi, '$1…').slice(0, 300) });

export async function fetchPageSpeedAnalysis(
  url: string, strategy: WebsiteStrategy,
  opts: { apiKey?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ReduceResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(buildPageSpeedRequestUrl(url, strategy, opts.apiKey), {
      method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(opts.timeoutMs ?? PSI_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error).name;
    return { ok: false, error: name === 'TimeoutError' || name === 'AbortError'
      ? { kind: 'timeout', message: 'Google did not answer in time.' }
      : { kind: 'network', message: 'Could not reach Google.' } };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: scrub(classifyPageSpeedHttpError(res.status, body.slice(0, 20_000))) };
  }
  let json: unknown;
  try { json = await res.json(); } catch { return { ok: false, error: { kind: 'unknown', message: 'Google returned an answer we could not read.' } }; }
  const reduced = reducePageSpeedResponse(json);
  return reduced.ok ? reduced : { ok: false, error: scrub(reduced.error) };
}
