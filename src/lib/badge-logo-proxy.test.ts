// Prompt 918 C.4 / D.1 — the logo of a badge is relayed from OUR origin, and only ever the right bytes: the founder's own upload, or a
// public image a verification found. The cases that matter: another org's file is never signed, a non-image is never relayed, the
// investor's browser is never sent to a third party, and nothing usable means "not found" (the page draws the icon for the kind).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./document-proxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./document-proxy')>()),
  streamStorageObject: vi.fn(),
}));
vi.mock('./public-fetch', () => ({ fetchPublicDocument: vi.fn() }));

import { streamStorageObject } from './document-proxy';
import { fetchPublicDocument } from './public-fetch';
import { foundLogoHeaders, relayableImageType, serveBadgeLogo, uploadIsServable } from './badge-logo-proxy';

const ORG = '5ead0ea1-d6bb-4354-b1e7-300df91ca33e';
const OTHER_ORG = '7c1a5974-000b-4dd2-8632-87f99250cf68';
const admin = {} as SupabaseClient;
const req = new Request('https://app.test/api/portal/badge-logo/b1');
const stream = vi.mocked(streamStorageObject);
const fetchDoc = vi.mocked(fetchPublicDocument);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
function found(over: Record<string, unknown> = {}) {
  return { ok: true as const, finalUrl: 'https://cdn.altice.pt/logo.png', status: 200, contentType: 'image/png', contentLength: PNG.length, bytes: PNG, truncated: false, ...over };
}

beforeEach(() => {
  stream.mockReset();
  fetchDoc.mockReset();
  stream.mockResolvedValue(new Response('stored-bytes', { status: 200, headers: { 'Content-Type': 'image/png' } }));
});

describe('relayableImageType', () => {
  it('canonicalises the header and accepts the raster formats and SVG', () => {
    expect(relayableImageType('image/png')).toBe('image/png');
    expect(relayableImageType('IMAGE/JPEG; charset=binary')).toBe('image/jpeg');
    expect(relayableImageType(' image/svg+xml ')).toBe('image/svg+xml');
    for (const t of ['image/webp', 'image/gif', 'image/avif']) expect(relayableImageType(t)).toBe(t);
  });
  it('refuses anything that is not an image we relay — html, scripts, pdf, octet-stream, empty', () => {
    for (const t of ['text/html', 'application/javascript', 'application/pdf', 'application/octet-stream', 'image/tiff', 'text/plain; charset=image/png', '', null, undefined]) {
      expect(relayableImageType(t as never), String(t)).toBeNull();
    }
  });
});

describe('foundLogoHeaders — a relayed third-party image can never run as a page', () => {
  it('sandboxes it, forbids sniffing, keeps it out of shared caches and search engines', () => {
    const h = foundLogoHeaders('image/svg+xml');
    expect(h['Content-Type']).toBe('image/svg+xml');
    expect(h['Content-Security-Policy']).toBe("sandbox; default-src 'none'");
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Cache-Control']).toMatch(/^private,/);
    expect(h['X-Robots-Tag']).toContain('noindex');
  });
});

describe('uploadIsServable', () => {
  it('accepts an image in the badge\'s own org folder', () => {
    expect(uploadIsServable(ORG, `${ORG}/a690337a-logo_AIIA2023.png`)).toBe(true);
    expect(uploadIsServable(ORG, `${ORG}/x.JPG`)).toBe(true);
    expect(uploadIsServable(ORG, `${ORG}/x.webp`)).toBe(true);
  });
  it('refuses another org\'s folder, a path that climbs, a document, an svg (downloaded, not rendered) and nothing', () => {
    expect(uploadIsServable(ORG, `${OTHER_ORG}/secret.png`)).toBe(false);
    expect(uploadIsServable(ORG, `${ORG}/../${OTHER_ORG}/secret.png`)).toBe(false);
    expect(uploadIsServable(ORG, `${ORG}/pitch.pdf`)).toBe(false);
    expect(uploadIsServable(ORG, `${ORG}/clip.mp4`)).toBe(false);
    expect(uploadIsServable(ORG, `${ORG}/logo.svg`)).toBe(false);
    expect(uploadIsServable(ORG, null)).toBe(false);
    expect(uploadIsServable(ORG, undefined)).toBe(false);
  });
});

describe('serveBadgeLogo — C.4: the upload first, then the one verification found', () => {
  it('streams the upload through the Storage proxy (never a URL) and does not touch the web', async () => {
    const res = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: `${ORG}/uuid-logo.png`, logo_url: 'https://cdn.altice.pt/logo.png' } });
    expect(res.status).toBe(200);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream.mock.calls[0][0]).toMatchObject({ admin, storagePath: `${ORG}/uuid-logo.png`, filename: 'uuid-logo.png', req });
    expect(fetchDoc).not.toHaveBeenCalled();
  });

  it('NEVER signs a path outside the badge\'s org folder: it falls through to the found logo, or answers not found', async () => {
    fetchDoc.mockResolvedValue(found());
    const res = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: `${OTHER_ORG}/secret.png`, logo_url: 'https://cdn.altice.pt/logo.png' } });
    expect(stream).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    stream.mockClear();
    const none = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: `${OTHER_ORG}/secret.png`, logo_url: null } });
    expect(stream).not.toHaveBeenCalled();
    expect(none.status).toBe(404);
  });

  it('an upload that is not an image (a PDF picked by mistake) is skipped in favour of the found logo', async () => {
    fetchDoc.mockResolvedValue(found());
    const res = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: `${ORG}/deck.pdf`, logo_url: 'https://cdn.altice.pt/logo.png' } });
    expect(stream).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('relays a found logo: the bytes, the type, the safe headers; fetched with the public fetcher, capped at 2 MB, images only', async () => {
    fetchDoc.mockResolvedValue(found({ contentType: 'image/png; charset=binary' }));
    const res = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: null, logo_url: 'https://cdn.altice.pt/logo.png' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(fetchDoc).toHaveBeenCalledWith('https://cdn.altice.pt/logo.png', expect.objectContaining({ method: 'GET', maxBytes: 2 * 1024 * 1024, accept: 'image/*' }));
  });

  it('a found logo that is truncated, empty, not an image or unreachable is "not found" — never relayed, never an error page', async () => {
    const badge = { org_id: ORG, logo_storage_path: null, logo_url: 'https://cdn.altice.pt/logo.png' };
    for (const r of [
      found({ truncated: true }), found({ bytes: Buffer.alloc(0) }), found({ contentType: 'text/html' }), found({ contentType: 'application/javascript' }),
      { ok: false as const, reason: 'private_address' as const }, { ok: false as const, reason: 'timeout' as const },
    ]) {
      fetchDoc.mockResolvedValueOnce(r);
      const res = await serveBadgeLogo({ admin, req, badge });
      expect(res.status, JSON.stringify(r).slice(0, 80)).toBe(404);
      expect(res.headers.get('content-type')).toBe('application/json');
    }
  });

  it('no logo at all, or a logo address that is not a public web address, is not found and fetches nothing', async () => {
    for (const logo_url of [null, '', 'javascript:alert(1)', 'http://127.0.0.1/logo.png', 'https://localhost/logo.png']) {
      const res = await serveBadgeLogo({ admin, req, badge: { org_id: ORG, logo_storage_path: null, logo_url } });
      expect(res.status, String(logo_url)).toBe(404);
    }
    expect(fetchDoc).not.toHaveBeenCalled();
    expect(stream).not.toHaveBeenCalled();
  });
});
