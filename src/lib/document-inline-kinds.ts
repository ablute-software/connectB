// Prompt 750 — pure data, no I/O, no 'server-only': the one place that
// knows which file extensions this app will render INLINE (in the
// streaming proxy's Content-Type, document-proxy.ts, AND in the in-
// platform viewer's own choice of <iframe>/<video>/"can't preview" state,
// DocumentViewerModal.tsx). Split out of document-proxy.ts specifically so
// a CLIENT component can import it — document-proxy.ts itself is
// server-only (it holds the actual byte-streaming logic) and can't be
// imported from 'use client' code.
//
// Deliberately narrower than upload-security.ts's EXT_KIND (which also
// accepts docx/xlsx/pptx/doc/xls/ppt/csv/md as legitimate VAULT UPLOADS —
// that allowlist governs what a founder may upload, not what this app will
// render inline in a browser tab). Everything not in this map (every
// Office format, csv, md, and anything unrecognised, including svg/html/
// xml/js by simple absence) is a forced download.
export const INLINE_CONTENT_TYPE: Record<string, string> = {
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

export function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename);
  return m ? m[1].toLowerCase() : '';
}

export type InlineKind = 'video' | 'iframe' | 'none';

// What the viewer should actually DO with a file of this name: a real
// <video> element for mp4/webm, an <iframe> for anything else the browser
// itself renders natively (pdf/images/txt), or nothing — a file type the
// proxy will force-download rather than render, which needs its own
// "can't preview this" state instead of a blank frame.
export function inlineKindFor(filename: string): InlineKind {
  const ext = extOf(filename);
  if (ext === 'mp4' || ext === 'webm') return 'video';
  return INLINE_CONTENT_TYPE[ext] ? 'iframe' : 'none';
}
