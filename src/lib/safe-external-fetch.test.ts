import { describe, expect, it, vi } from 'vitest';
import {
  checkExternalUrlSyntax, checkResolvesToPublicIp, fetchExternalPage,
  isBlockedIp, isBlockedIpv4, isBlockedIpv6, MAX_RESPONSE_BYTES,
  type DnsLookup,
} from './safe-external-fetch';

// Prompt 512 — the founder chooses this URL, so every test here is really
// one question: can a chosen hostname reach something inside the network?
// The hostname is never the thing to trust, so most of these use a
// perfectly ordinary-looking domain and vary only what DNS answers.

const resolvesTo = (...addresses: string[]): DnsLookup =>
  async () => addresses.map((address) => ({
    address, family: address.includes(':') ? 6 : 4,
  }));

describe('isBlockedIpv4', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.1.2.3', 'loopback, whole /8'],
    ['10.0.0.1', 'RFC1918'],
    ['10.255.255.254', 'RFC1918 upper'],
    ['172.16.0.1', 'RFC1918'],
    ['172.31.255.254', 'RFC1918 upper edge of /12'],
    ['192.168.1.1', 'RFC1918'],
    ['169.254.169.254', 'cloud instance metadata'],
    ['169.254.0.1', 'link-local'],
    ['0.0.0.0', 'this network'],
    ['100.64.0.1', 'CGNAT'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIpv4(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.32.0.1'],   // just outside 172.16.0.0/12
    ['172.15.255.1'], // just below 172.16.0.0/12
    ['192.167.1.1'],  // just below 192.168.0.0/16
    ['93.184.216.34'],
  ])('allows public %s', (ip) => {
    expect(isBlockedIpv4(ip)).toBe(false);
  });

  it('treats an unparseable address as blocked rather than public', () => {
    expect(isBlockedIpv4('not-an-ip')).toBe(true);
    expect(isBlockedIpv4('999.1.1.1')).toBe(true);
  });
});

describe('isBlockedIpv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fc00::1', 'unique-local'],
    ['fd12:3456::1', 'unique-local'],
    ['fe80::1', 'link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata endpoint'],
    ['2002::1', '6to4 wrapper'],
    ['64:ff9b::1', 'NAT64 wrapper'],
    ['fe80::1%eth0', 'link-local with zone id'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIpv6(ip)).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
  });

  it('routes a v4 address to the v4 rules through isBlockedIp', () => {
    expect(isBlockedIp('10.0.0.1')).toBe(true);
    expect(isBlockedIp('8.8.8.8')).toBe(false);
  });
});

describe('checkExternalUrlSyntax', () => {
  it('accepts an ordinary https URL on a real VC site', () => {
    const result = checkExternalUrlSyntax('https://clave.capital/equipo/');
    expect(result.ok).toBe(true);
  });

  it('refuses http:// rather than silently upgrading it', () => {
    // Rewriting the founder's link would make the page we checked differ
    // from the page they vouched for.
    const result = checkExternalUrlSyntax('http://clave.capital/equipo/');
    expect(result.ok).toBe(false);
  });

  it.each([
    ['https://user:pass@clave.capital/', 'embedded credentials'],
    ['https://localhost/team', 'localhost'],
    ['https://api.local/team', '.local'],
    ['https://127.0.0.1/team', 'loopback literal'],
    ['https://169.254.169.254/latest/meta-data/', 'metadata endpoint literal'],
    ['https://192.168.0.1/admin', 'RFC1918 literal'],
    ['https://clave.capital:8080/team', 'non-standard port'],
    ['file:///etc/passwd', 'file scheme'],
    ['not a url', 'unparseable'],
    ['', 'empty'],
  ])('rejects %s (%s)', (raw) => {
    expect(checkExternalUrlSyntax(raw).ok).toBe(false);
  });
});

describe('checkResolvesToPublicIp', () => {
  it('accepts a hostname resolving only to public addresses', async () => {
    const result = await checkResolvesToPublicIp('clave.capital', resolvesTo('93.184.216.34'));
    expect(result.ok).toBe(true);
  });

  it('rejects a public-LOOKING hostname that resolves to loopback', async () => {
    // The core SSRF case: nothing about the hostname is suspicious.
    const result = await checkResolvesToPublicIp('totally-normal.com', resolvesTo('127.0.0.1'));
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/private address/i);
  });

  it('rejects a hostname resolving to the cloud metadata endpoint', async () => {
    const result = await checkResolvesToPublicIp('vc-site.com', resolvesTo('169.254.169.254'));
    expect(result.ok).toBe(false);
  });

  it('rejects when ANY answer is private, even if another is public', async () => {
    // The connect could pick either answer, so one bad address poisons all.
    const result = await checkResolvesToPublicIp('mixed.com', resolvesTo('93.184.216.34', '10.0.0.5'));
    expect(result.ok).toBe(false);
  });

  it('rejects a hostname that does not resolve at all', async () => {
    const result = await checkResolvesToPublicIp('nope.invalid', async () => { throw new Error('ENOTFOUND'); });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty DNS answer instead of treating it as public', async () => {
    const result = await checkResolvesToPublicIp('empty.com', async () => []);
    expect(result.ok).toBe(false);
  });
});

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200, headers: { 'content-type': 'text/html' }, ...init,
  });
}

describe('fetchExternalPage', () => {
  const publicDns = resolvesTo('93.184.216.34');

  it('returns the page text for a well-formed public URL', async () => {
    const fetchImpl = vi.fn(async () => htmlResponse('<html>Ana Silva — Partner</html>'));
    const result = await fetchExternalPage('https://clave.capital/equipo/', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    expect((result as { text: string }).text).toContain('Ana Silva');
  });

  it('never calls fetch when the URL fails the syntax gate', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchExternalPage('http://clave.capital/equipo/', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never calls fetch when DNS resolves to a private address', async () => {
    const fetchImpl = vi.fn();
    const result = await fetchExternalPage('https://looks-fine.com/team', {
      dnsLookup: resolvesTo('192.168.1.10'), fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-checks a redirect instead of following it into the metadata endpoint', async () => {
    // The attack this exists for: a public page 302s to the link-local
    // metadata service. fetch(redirect: 'manual') hands the hop back to us,
    // and the second hop fails the same gates as the first.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.startsWith('https://evil.example')) {
        return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } });
      }
      return htmlResponse('should never be reached');
    });
    const result = await fetchExternalPage('https://evil.example/start', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/private address/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-resolves DNS on a redirect to a different host', async () => {
    const dnsLookup = vi.fn(async (hostname: string) => (
      hostname === 'internal.example'
        ? [{ address: '10.1.2.3', family: 4 }]
        : [{ address: '93.184.216.34', family: 4 }]
    ));
    const fetchImpl = vi.fn(async (url: string) => (
      url.startsWith('https://public.example')
        ? new Response(null, { status: 301, headers: { location: 'https://internal.example/secrets' } })
        : htmlResponse('leaked')
    ));

    const result = await fetchExternalPage('https://public.example/x', {
      dnsLookup, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than following a redirect loop forever', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302, headers: { location: 'https://loop.example/again' },
    }));
    const result = await fetchExternalPage('https://loop.example/start', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/too many times/i);
  });

  it('rejects a non-HTML content type', async () => {
    const fetchImpl = vi.fn(async () => new Response('%PDF-1.4', {
      status: 200, headers: { 'content-type': 'application/pdf' },
    }));
    const result = await fetchExternalPage('https://clave.capital/deck.pdf', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toMatch(/not a web page/i);
  });

  it('caps an oversized body instead of buffering it whole', async () => {
    const huge = 'a'.repeat(MAX_RESPONSE_BYTES * 2);
    const fetchImpl = vi.fn(async () => htmlResponse(huge));
    const result = await fetchExternalPage('https://clave.capital/equipo/', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(true);
    const page = result as { text: string; truncated: boolean };
    expect(page.truncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });

  it('reports an unreachable page as a rejection, not an exception', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const result = await fetchExternalPage('https://clave.capital/equipo/', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
  });

  it('reports an HTTP error status rather than passing an error page to the model', async () => {
    const fetchImpl = vi.fn(async () => new Response('Not found', {
      status: 404, headers: { 'content-type': 'text/html' },
    }));
    const result = await fetchExternalPage('https://clave.capital/nope', {
      dnsLookup: publicDns, fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('404');
  });
});
