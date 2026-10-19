// Prompt 919 A — the one call to Google, proved with an injected fetch (no network, no key): what is sent, what each answer becomes, and
// that the key can never come back out in a message.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPageSpeedRequestUrl, fetchPageSpeedAnalysis, PSI_ENDPOINT, PSI_TIMEOUT_MS } from './website-health-psi';

const fixture = (n: string) => JSON.parse(readFileSync(path.resolve(__dirname, `__fixtures__/${n}`), 'utf8')) as unknown;
const KEY = 'AIzaSyTESTONLYabcdefghijklmnopqrstuvwx';

// the real answer Google gave on 16/10/2026 to a request WITHOUT a key (same body the classifier test pins)
const KEYLESS_BODY = JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'Queries' and limit 'Queries per day' of service 'pagespeedonline.googleapis.com' for consumer 'project_number:583797351490'.", status: 'RESOURCE_EXHAUSTED', errors: [{ reason: 'rateLimitExceeded', domain: 'global' }], details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'RATE_LIMIT_EXCEEDED', metadata: { quota_limit_value: '0' } }] } });

const respond = (status: number, body: string) => (async () => new Response(body, { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('buildPageSpeedRequestUrl', () => {
  it('asks for the four categories and the strategy, for exactly the address given', () => {
    const u = new URL(buildPageSpeedRequestUrl('https://example.com', 'mobile', undefined));
    expect(`${u.origin}${u.pathname}`).toBe(PSI_ENDPOINT);
    expect(u.searchParams.get('url')).toBe('https://example.com');
    expect(u.searchParams.get('strategy')).toBe('mobile');
    expect(u.searchParams.getAll('category')).toEqual(['performance', 'seo', 'accessibility', 'best-practices']);
  });
  it('the key is a parameter only when there is one', () => {
    expect(new URL(buildPageSpeedRequestUrl('https://example.com', 'desktop', undefined)).searchParams.has('key')).toBe(false);
    expect(new URL(buildPageSpeedRequestUrl('https://example.com', 'desktop', '')).searchParams.has('key')).toBe(false);
    expect(new URL(buildPageSpeedRequestUrl('https://example.com', 'desktop', KEY)).searchParams.get('key')).toBe(KEY);
  });
  it('an address with its own query string travels intact (encoded, not merged into ours)', () => {
    const u = new URL(buildPageSpeedRequestUrl('https://example.com/a?x=1&strategy=desktop', 'mobile', undefined));
    expect(u.searchParams.get('url')).toBe('https://example.com/a?x=1&strategy=desktop');
    expect(u.searchParams.get('strategy')).toBe('mobile');
  });
  it('the per-call timeout leaves room inside a 60 s function', () => {
    expect(PSI_TIMEOUT_MS).toBeLessThan(60_000);
    expect(PSI_TIMEOUT_MS).toBeGreaterThanOrEqual(50_000);
  });
});

describe('fetchPageSpeedAnalysis', () => {
  it('a real Lighthouse answer becomes scores and findings', async () => {
    const body = JSON.stringify({ lighthouseResult: fixture('pagespeed-example-mobile.json') });
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(200, body) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.analysis.scores).toEqual({ performance: 100, seo: 80, accessibility: 96, bestPractices: 100 });
  });

  it('the request is a GET with no body, no cache, and a timeout signal', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const spy = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    await fetchPageSpeedAnalysis('https://example.com', 'desktop', { apiKey: KEY, fetchImpl: spy });
    expect(seen).not.toBeNull();
    const s = seen as unknown as { url: string; init: RequestInit };
    expect(s.init.method).toBe('GET');
    expect(s.init.body).toBeUndefined();
    expect(s.init.cache).toBe('no-store');
    expect(s.init.signal).toBeInstanceOf(AbortSignal);
    expect(new URL(s.url).searchParams.get('strategy')).toBe('desktop');
  });

  it('no key → Google\'s real 429 → "quota" with its status, so a missing key is visible instead of mistaken for a broken site', async () => {
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { fetchImpl: respond(429, KEYLESS_BODY) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'quota', httpStatus: 429 } });
  });

  it('a key Google refuses → "key"', async () => {
    const body = JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
    expect(await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(400, body) })).toMatchObject({ ok: false, error: { kind: 'key' } });
  });

  it('a page Google could not load → "unreachable" (the one case where "check it loads publicly" is the right advice)', async () => {
    const body = JSON.stringify({ error: { code: 500, message: 'Lighthouse returned error: FAILED_DOCUMENT_REQUEST. Lighthouse was unable to reliably load the page you requested.', status: 'INTERNAL' } });
    expect(await fetchPageSpeedAnalysis('https://nope.invalid', 'mobile', { apiKey: KEY, fetchImpl: respond(500, body) })).toMatchObject({ ok: false, error: { kind: 'unreachable' } });
  });

  it('Google answering 200 with a runtimeError is a failed analysis, not a row of zeros', async () => {
    const body = JSON.stringify({ lighthouseResult: { runtimeError: { code: 'FAILED_DOCUMENT_REQUEST', message: 'Lighthouse was unable to reliably load the page you requested.' }, categories: {}, audits: {} } });
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(200, body) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'unreachable' } });
  });

  it('a timeout is OURS to report: the abort becomes a "timeout" answer, never an exception', async () => {
    const aborts = (async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch;
    expect(await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: aborts })).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    const aborted = (async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch;
    expect(await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: aborted })).toMatchObject({ ok: false, error: { kind: 'timeout' } });
  });

  it('a real timeout signal fires: a server that never answers ends in "timeout" after timeoutMs', async () => {
    const hangs = ((_u: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, timeoutMs: 40, fetchImpl: hangs });
    expect(r).toMatchObject({ ok: false, error: { kind: 'timeout' } });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('a network failure is "network", with a message that cannot carry the request URL (and so cannot carry the key)', async () => {
    const down = (async () => { throw new TypeError(`fetch failed: ${PSI_ENDPOINT}?url=x&key=${KEY}`); }) as unknown as typeof fetch;
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: down });
    expect(r).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('a body that is not JSON is "unknown", not a crash', async () => {
    expect(await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(200, '<html>oops</html>') })).toMatchObject({ ok: false, error: { kind: 'unknown' } });
  });

  it('the key never comes back out: not in an error message even when Google echoes the request URL back in its own error text', async () => {
    const body = JSON.stringify({ error: { code: 403, message: `Requests from referer <empty> are blocked. Request: ${PSI_ENDPOINT}?url=https%3A%2F%2Fexample.com&key=${KEY}`, status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } });
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(403, body) });
    expect(r).toMatchObject({ ok: false, error: { kind: 'key', httpStatus: 403 } });
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it('only the first 20k of an error body is read (a hostile or runaway body cannot blow up memory/log lines)', async () => {
    const huge = JSON.stringify({ error: { code: 500, message: 'x'.repeat(500_000), status: 'INTERNAL' } });
    const r = await fetchPageSpeedAnalysis('https://example.com', 'mobile', { apiKey: KEY, fetchImpl: respond(500, huge) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.length).toBeLessThanOrEqual(300);
  });
});
