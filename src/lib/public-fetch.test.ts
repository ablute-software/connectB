// Prompt 918 B — the safe public fetch behind a badge's source link: it reads public pages and never reaches anything that is not public.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.fn();
vi.mock('node:dns/promises', () => ({ default: { lookup: (...args: unknown[]) => lookup(...args) } }));

import { fetchPublicDocument, fetchSourcePage, publicImageOk } from './public-fetch';

const PUBLIC = [{ address: '203.0.113.7', family: 4 }];
const fetchMock = vi.fn();

function resp(body: string | Uint8Array | null, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body as BodyInit | null, { status: init.status ?? 200, headers: init.headers });
}

beforeEach(() => {
  lookup.mockReset(); fetchMock.mockReset();
  lookup.mockResolvedValue(PUBLIC);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchPublicDocument — nunca chega a nada que não seja público', () => {
  it('um host que resolve a um endereço privado/loopback/link-local/CGNAT nunca é pedido', async () => {
    for (const address of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '192.168.1.9', '172.20.0.2', '100.64.0.1', '0.0.0.0']) {
      lookup.mockResolvedValue([{ address, family: 4 }]);
      expect(await fetchPublicDocument('https://awards.example.org/2023', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' }), address)
        .toEqual({ ok: false, reason: 'private_address' });
    }
    lookup.mockResolvedValue([{ address: '::1', family: 6 }]);
    expect(await fetchPublicDocument('https://awards.example.org/2023', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'private_address' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('um nome que não resolve nunca é tratado como seguro; um que resolve a um público E a um privado também não', async () => {
    lookup.mockRejectedValue(new Error('ENOTFOUND'));
    expect(await fetchPublicDocument('https://nowhere.example.org/', { method: 'GET', maxBytes: 10, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'private_address' });
    lookup.mockResolvedValue([{ address: '203.0.113.7', family: 4 }, { address: '10.1.1.1', family: 4 }]);
    expect(await fetchPublicDocument('https://mixed.example.org/', { method: 'GET', maxBytes: 10, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'private_address' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('credenciais no URL, literais de IP, localhost, portas fora do 443 e esquemas que não são http(s) nem chegam ao DNS', async () => {
    for (const url of ['https://user:pw@awards.example.org/', 'https://127.0.0.1/', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://localhost/', 'https://awards.example.org:8443/', 'ftp://awards.example.org/', 'javascript:alert(1)', 'not a url']) {
      const r = await fetchPublicDocument(url, { method: 'GET', maxBytes: 10, timeoutMs: 2000, accept: '*/*' });
      expect(r.ok, url).toBe(false);
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('um http:// é pedido por https://', async () => {
    fetchMock.mockResolvedValue(resp('ok', { headers: { 'content-type': 'text/html' } }));
    const r = await fetchPublicDocument('http://awards.example.org/2023', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: 'text/html' });
    expect(r).toMatchObject({ ok: true, finalUrl: 'https://awards.example.org/2023' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://awards.example.org/2023');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('cada redirecção volta a passar pelo mesmo portão: um destino que resolve a um endereço privado pára a cadeia', async () => {
    lookup.mockImplementation(async (host: string) => (host === 'internal.example.org' ? [{ address: '10.0.0.9', family: 4 }] : PUBLIC));
    fetchMock.mockResolvedValueOnce(resp(null, { status: 302, headers: { location: 'https://internal.example.org/admin' } }));
    const r = await fetchPublicDocument('https://awards.example.org/go', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' });
    expect(r).toEqual({ ok: false, reason: 'private_address' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('segue redirecções públicas (relativas incluídas) e devolve o URL final; mais de 5 saltos falha', async () => {
    fetchMock.mockResolvedValueOnce(resp(null, { status: 301, headers: { location: '/premios/2023/' } })).mockResolvedValueOnce(resp('page', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const r = await fetchPublicDocument('https://awards.example.org/old', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' });
    expect(r).toMatchObject({ ok: true, finalUrl: 'https://awards.example.org/premios/2023/', contentType: 'text/html; charset=utf-8' });

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => resp(null, { status: 302, headers: { location: 'https://awards.example.org/loop' } }));
    expect(await fetchPublicDocument('https://awards.example.org/loop', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'too_many_redirects' });
  });

  it('um corpo maior que o tecto é lido só até ao tecto (truncated) — nunca em memória inteiro', async () => {
    fetchMock.mockResolvedValue(resp('x'.repeat(5000), { headers: { 'content-type': 'text/html' } }));
    const r = await fetchPublicDocument('https://awards.example.org/big', { method: 'GET', maxBytes: 1000, timeoutMs: 2000, accept: '*/*' });
    expect(r).toMatchObject({ ok: true, truncated: true });
    expect((r as { bytes: Buffer }).bytes.length).toBe(1000);
  });

  it('404/500 -> http_error; falha de rede -> network_error; HEAD não lê corpo', async () => {
    fetchMock.mockResolvedValueOnce(resp('nope', { status: 404 }));
    expect(await fetchPublicDocument('https://awards.example.org/x', { method: 'GET', maxBytes: 10, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'http_error' });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await fetchPublicDocument('https://awards.example.org/x', { method: 'GET', maxBytes: 10, timeoutMs: 2000, accept: '*/*' })).toEqual({ ok: false, reason: 'network_error' });
    fetchMock.mockResolvedValueOnce(resp(null, { headers: { 'content-type': 'image/png', 'content-length': '1234' } }));
    expect(await fetchPublicDocument('https://awards.example.org/l.png', { method: 'HEAD', maxBytes: 1, timeoutMs: 2000, accept: 'image/*' })).toMatchObject({ ok: true, contentLength: 1234, bytes: expect.any(Buffer) });
  });
});

describe('fetchSourcePage', () => {
  it('HTML (e texto) devolve o texto da página; um PDF ou uma imagem não é "página"', async () => {
    fetchMock.mockResolvedValueOnce(resp('<html><title>T</title></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(await fetchSourcePage('https://awards.example.org/2023')).toEqual({ ok: true, finalUrl: 'https://awards.example.org/2023', html: '<html><title>T</title></html>' });
    fetchMock.mockResolvedValueOnce(resp('%PDF', { headers: { 'content-type': 'application/pdf' } }));
    expect(await fetchSourcePage('https://awards.example.org/list.pdf')).toEqual({ ok: false, reason: 'not_html' });
  });
});

describe('publicImageOk — HEAD, image/*, menos de 2 MB (B.2)', () => {
  const head = (type: string, length?: number, status = 200) => resp(null, { status, headers: { 'content-type': type, ...(length !== undefined ? { 'content-length': String(length) } : {}) } });

  it('uma imagem com tamanho declarado dentro do limite passa; acima de 2 MB, ou a zero, não', async () => {
    fetchMock.mockResolvedValueOnce(head('image/png', 4_000));
    expect(await publicImageOk('https://cdn.example.org/logo.png')).toBe(true);
    fetchMock.mockResolvedValueOnce(head('image/png', 2 * 1024 * 1024 + 1));
    expect(await publicImageOk('https://cdn.example.org/big.png')).toBe(false);
    fetchMock.mockResolvedValueOnce(head('image/png', 0));
    expect(await publicImageOk('https://cdn.example.org/empty.png')).toBe(false);
  });

  it('o que não é imagem (uma página, um script) nunca passa', async () => {
    fetchMock.mockResolvedValueOnce(head('text/html; charset=utf-8', 500));
    expect(await publicImageOk('https://cdn.example.org/logo')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('um servidor que recusa HEAD (405) ou não diz o tamanho é perguntado uma vez com um GET limitado', async () => {
    fetchMock.mockResolvedValueOnce(head('image/png', undefined, 405)).mockResolvedValueOnce(resp(new Uint8Array(3000), { headers: { 'content-type': 'image/png' } }));
    expect(await publicImageOk('https://cdn.example.org/logo.png')).toBe(true);
    expect(fetchMock.mock.calls.map((c) => (c[1] as { method: string }).method)).toEqual(['HEAD', 'GET']);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(head('image/svg+xml')).mockResolvedValueOnce(resp(new Uint8Array(2 * 1024 * 1024 + 500), { headers: { 'content-type': 'image/svg+xml' } }));
    expect(await publicImageOk('https://cdn.example.org/huge.svg')).toBe(false); // read up to the cap and still going: too large
  });

  it('inacessível ou recusado por nós (privado) -> false, sem segunda tentativa', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect(await publicImageOk('https://cdn.example.org/logo.png')).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    expect(await publicImageOk('https://internal.example.org/logo.png')).toBe(false);
  });
});
