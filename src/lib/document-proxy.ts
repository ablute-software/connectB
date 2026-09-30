// Prompt 750 — the fix for the URGENT bug Nuno reproduced live: a data-room
// document opened by an investor navigated the browser to a Supabase
// Storage signed URL. A signed URL is a bearer link — whoever has it can
// open the file, with or without a session, until it expires — so it ended
// up in the address bar, browser history, and clipboard, and worked from an
// anonymous window. Supabase signed URLs cannot be made single-use or
// session-bound; shortening the TTL only shrinks the window, it doesn't
// close it. The only real fix is that the Storage URL never reaches the
// browser at all.
//
// This module is the shared "serve the bytes ourselves" half of that fix.
// Every caller does its OWN grant/NDA/vault/malware check first (unchanged,
// on purpose — this file has no opinion on who may see what, only on how
// the bytes get to them once that's decided) and then calls
// streamStorageObject with the storage_path it already resolved. The only
// URL that ever reaches the browser is our own route.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Never sent to the browser — minted fresh on every request, used once,
// server-side only, for the single internal fetch() below.
const INTERNAL_SIGNED_URL_TTL_SECONDS = 60;

// Prompt 750 §5 — deliberately narrower than upload-security.ts's EXT_KIND
// (which also accepts docx/xlsx/pptx/doc/xls/ppt/csv/md as legitimate
// VAULT UPLOADS — that allowlist governs what a founder may upload, not
// what this app will render inline in a browser tab). Serving a file from
// our own origin risks stored XSS if the browser is ever allowed to
// execute it in place — an .html or .svg opened inline would run with
// whatever session opened it. Everything not in this map (including every
// Office format, csv, md, and anything unrecognised) is forced
// application/octet-stream + Content-Disposition: attachment — inert
// either way, and svg/html/xml/js are never in this map under any name.
const INLINE_CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain; charset=utf-8',
};

function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

// Exported for unit testing — pure, no I/O. Every Office format, csv, md,
// and anything unrecognised (including svg/html/xml/js by simple absence
// from the map) forces a download instead of rendering inline.
export function resolveContentType(filename: string): { contentType: string; inline: boolean } {
  const inlineType = INLINE_CONTENT_TYPE[extOf(filename)];
  return inlineType ? { contentType: inlineType, inline: true } : { contentType: 'application/octet-stream', inline: false };
}

// RFC 5987 — filename for old clients, filename* (UTF-8, percent-encoded)
// for everything else. Never the storage path, never a URL.
export function contentDispositionValue(filename: string, inline: boolean): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `${inline ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  // Prompt 750 §5 — a document served from our own origin must never be
  // able to run as a page: sandbox with no allowed origin blocks scripts,
  // plugins, forms and top-level navigation. PDFs, images and video still
  // render; nothing here executes.
  'Content-Security-Policy': "sandbox; default-src 'none'",
};

function refusalResponse(status: number): Response {
  return new Response(JSON.stringify({ ok: false, reason: 'unavailable' }), {
    status, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS },
  });
}

// Prompt 750 §2 — a video/PDF the browser fetches in many small Range
// requests must count as ONE open, not one per chunk. A request with no
// Range header (the first hit, or a non-seeking client) or a Range that
// starts at byte 0 is "the real open"; every later chunk of the same
// playback/scroll session starts partway through and is not logged again.
export function shouldLogOpen(req: Request): boolean {
  const range = req.headers.get('range');
  if (!range) return true;
  return /^bytes=0-/.test(range.trim());
}

// Streams a private Storage object through this server, so the only URL the
// browser ever sees is this app's own route. Every check (grant, NDA, vault
// freeze, malware flag) must already have passed before this is called —
// this function only moves bytes, it never decides who may have them.
export async function streamStorageObject(opts: {
  admin: SupabaseClient;
  storagePath: string;
  filename: string;
  req: Request;
}): Promise<Response> {
  const { admin, storagePath, filename, req } = opts;

  const { data: signed, error } = await admin.storage.from('data-room')
    .createSignedUrl(storagePath, INTERNAL_SIGNED_URL_TTL_SECONDS);
  if (error || !signed?.signedUrl) return refusalResponse(404);

  const range = req.headers.get('range');
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(signed.signedUrl, {
      headers: range ? { Range: range } : undefined,
      cache: 'no-store',
    });
  } catch {
    return refusalResponse(502);
  }
  if (!upstream.ok && upstream.status !== 206) return refusalResponse(502);
  if (!upstream.body) return refusalResponse(502);

  const { contentType, inline } = resolveContentType(filename);

  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Content-Type', contentType);
  headers.set('Content-Disposition', contentDispositionValue(filename, inline));
  headers.set('Accept-Ranges', 'bytes');
  const contentRange = upstream.headers.get('content-range');
  const contentLength = upstream.headers.get('content-length');
  if (contentRange) headers.set('Content-Range', contentRange);
  if (contentLength) headers.set('Content-Length', contentLength);

  // Real streaming — upstream.body is piped straight through, never
  // buffered into memory with arrayBuffer()/blob(). Required for the 18MB
  // video / 11MB PDF files already in production, and for staying under
  // Vercel's ~4.5MB limit on non-streaming responses.
  return new Response(upstream.body, { status: upstream.status, headers });
}
