// Prompt 918 C.4 / D.1 — a badge's logo, served from OUR origin. Two kinds exist and both are relayed here, so the browser only ever sees
// our own route:
//  · the founder's UPLOAD (logo_storage_path, a file in the data-room bucket) — streamed with document-proxy.ts (Prompt 750: no
//    Storage URL ever reaches a browser). Only a file inside the badge's OWN org folder is served: this signs with the service role.
//  · the one a VERIFICATION found (logo_url, a public image on the web) — fetched here with the public fetcher's guards and relayed.
//    The investor's browser never contacts that host: an <img> aimed at an address chosen by the founder's source page would tell it
//    which investor opened which dossier, and when.
// Who may see which badge is decided by the two routes that call this (the investor's: verified badge + eligible investor; the
// founder's: the badge is the founder's own). This file only moves bytes. Order (C.4): upload > found. Nothing usable → 404, and the
// page draws the icon for the badge's kind.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveContentType, streamStorageObject } from './document-proxy';
import { fetchPublicDocument } from './public-fetch';
import { MAX_LOGO_BYTES } from './company-badge-verification';
import { isOwnStoragePath, normalizeSourceUrl } from './company-badges';

export interface BadgeLogoRow { org_id: string; logo_storage_path: string | null; logo_url: string | null }

// Raster formats plus SVG. An SVG is a document that can carry script: it is only ever safe as an <img> or under the sandbox CSP below.
const RELAYABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);

/** The content type a found logo is relayed as ("image/png; charset=binary" → "image/png"), or null when it is not an image we relay. */
export function relayableImageType(header: string | null | undefined): string | null {
  const type = (header ?? '').split(';')[0].trim().toLowerCase();
  return RELAYABLE_IMAGE_TYPES.has(type) ? type : null;
}

/** Headers of a relayed (found) logo. Sandbox + no default sources: opened on its own, even an SVG with a script in it cannot run. */
export function foundLogoHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  };
}

function notFound(): Response {
  return new Response(JSON.stringify({ ok: false, reason: 'not_found' }), {
    status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' },
  });
}

/** An upload is only served when it sits in the badge's own org folder and is an image the browser renders inline (not a PDF someone picked by mistake). */
export function uploadIsServable(orgId: string, path: string | null | undefined): path is string {
  if (!isOwnStoragePath(orgId, path)) return false;
  const filename = path.split('/').pop() ?? '';
  const { contentType, inline } = resolveContentType(filename);
  return inline && contentType.startsWith('image/');
}

export async function serveBadgeLogo(opts: { admin: SupabaseClient; badge: BadgeLogoRow; req: Request }): Promise<Response> {
  const { admin, badge, req } = opts;

  if (uploadIsServable(badge.org_id, badge.logo_storage_path)) {
    const path = badge.logo_storage_path as string;
    return streamStorageObject({ admin, storagePath: path, filename: path.split('/').pop() as string, req });
  }

  const url = normalizeSourceUrl(badge.logo_url);
  if (!url) return notFound();
  const got = await fetchPublicDocument(url, { method: 'GET', maxBytes: MAX_LOGO_BYTES, timeoutMs: 6_000, accept: 'image/*' });
  if (!got.ok || got.truncated || got.bytes.length === 0) return notFound();
  const type = relayableImageType(got.contentType);
  if (!type) return notFound();
  return new Response(new Uint8Array(got.bytes), { status: 200, headers: foundLogoHeaders(type) });
}
