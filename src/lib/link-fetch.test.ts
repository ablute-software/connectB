import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedFetchUrl, resolveDirectDownloadUrl, fetchExternalBytes } from './link-fetch';
import { detectAllowedKind } from './upload-security';

// Every fetchExternalBytes test below runs with a mocked global fetch and a
// mocked DNS lookup — no real network, per Prompt 462 §E's own requirement.
// dns.lookup is stubbed to a public address for every hostname so the
// private-address guard (§A.3) never blocks a test that isn't specifically
// about it; that guard's own logic is exercised directly via the module
// under test in production, not re-derived here.
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn().mockResolvedValue([{ address: '142.250.1.1', family: 4 }]);
  return { default: { lookup }, lookup };
});

function streamResponse(status: number, bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return new Response(stream, { status, headers });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isAllowedFetchUrl', () => {
  it('accepts both Drive hosts', () => {
    expect(isAllowedFetchUrl('https://drive.google.com/uc?export=download&id=abc')).toBe(true);
    expect(isAllowedFetchUrl('https://drive.usercontent.google.com/download?id=abc')).toBe(true);
  });

  it('rejects http (https required)', () => {
    expect(isAllowedFetchUrl('http://drive.google.com/uc?export=download&id=abc')).toBe(false);
  });

  it('rejects a host that only CONTAINS drive.google.com, never a suffix match by substring', () => {
    expect(isAllowedFetchUrl('https://drive.google.com.evil.tld/file')).toBe(false);
  });

  it('rejects an arbitrary host', () => {
    expect(isAllowedFetchUrl('https://attacker.example.com/payload.pdf')).toBe(false);
  });

  it('rejects null/undefined/malformed input', () => {
    expect(isAllowedFetchUrl(null)).toBe(false);
    expect(isAllowedFetchUrl(undefined)).toBe(false);
    expect(isAllowedFetchUrl('not a url')).toBe(false);
  });
});

describe('resolveDirectDownloadUrl', () => {
  it('rewrites the /file/d/<id>/view share format to a direct-download URL', () => {
    expect(resolveDirectDownloadUrl('https://drive.google.com/file/d/1AbC-XyZ/view?usp=sharing'))
      .toBe('https://drive.google.com/uc?export=download&id=1AbC-XyZ');
  });

  it('leaves any other URL unchanged', () => {
    expect(resolveDirectDownloadUrl('https://drive.usercontent.google.com/download?id=abc')).toBe('https://drive.usercontent.google.com/download?id=abc');
    expect(resolveDirectDownloadUrl('https://example.com/report.pdf')).toBe('https://example.com/report.pdf');
  });
});

describe('fetchExternalBytes', () => {
  it('a redirect to a host outside the allowlist returns host_not_allowed, and is never followed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(redirectResponse('https://attacker.example.com/payload.pdf'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 10_000, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, reason: 'host_not_allowed' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // never fetched the disallowed target
  });

  it('more than 5 redirect hops returns too_many_redirects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(redirectResponse('https://drive.usercontent.google.com/download?id=abc'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 10_000, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, reason: 'too_many_redirects' });
    expect(fetchMock).toHaveBeenCalledTimes(6); // the initial request + 5 followed hops + the 6th (still a redirect) that tips it over
  });

  it('a body above the cap returns too_large, enforced on the streamed body — never trusting content-length alone', async () => {
    // Deliberately no content-length header: this proves the cap is
    // enforced while reading the stream, not just as a header shortcut.
    const oversized = new Uint8Array(2000).fill(65);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamResponse(200, oversized)));
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 1000, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('a lying content-length (understated) still gets caught by the streamed cap', async () => {
    const oversized = new Uint8Array(2000).fill(65);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(streamResponse(200, oversized, { 'content-length': '10' })));
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 1000, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, reason: 'too_large' });
  });

  it('succeeds for an allowed host with a body within the cap, following an allowed-host redirect first', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(redirectResponse('https://drive.usercontent.google.com/download?id=abc'))
      .mockResolvedValueOnce(streamResponse(200, pdfBytes));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 10_000, timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.finalUrl).toBe('https://drive.usercontent.google.com/download?id=abc');
      expect(Buffer.from(result.bytes)).toEqual(Buffer.from(pdfBytes));
    }
  });

  it('a non-2xx, non-redirect response returns http_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })));
    const result = await fetchExternalBytes('https://drive.google.com/uc?export=download&id=abc', { maxBytes: 10_000, timeoutMs: 5000 });
    expect(result).toEqual({ ok: false, reason: 'http_error' });
  });
});

// Prompt 462 §E — the one check that actually separates the ablute_
// investor deck (a real PDF) from "Demonstrator" (a 200 response whose
// body is Google Drive's own virus-scan interstitial page): HTTP status
// and Content-Type are identical in both cases, confirmed live. Only the
// real magic bytes tell them apart.
describe('detectAllowedKind — the interstitial-HTML defense this feature depends on', () => {
  it('an HTML interstitial body never passes as a PDF, even with a .pdf name hint', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Google Drive - Virus scan warning</title></head>'
      + '<body>Google Drive can\'t scan this file for viruses.<a href="#">Download anyway</a></body></html>',
    );
    expect(detectAllowedKind(html, 'x.pdf')).toBeNull();
  });

  it('a real PDF, by contrast, is correctly recognized', () => {
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    expect(detectAllowedKind(pdfBytes, 'x.pdf')).toBe('pdf');
  });
});
