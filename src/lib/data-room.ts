// Data Room V2 — pure helpers for Storage keys and document link
// validation. No I/O, no server-only: shared by the client-side upload flow
// and both store providers' addDocument, and unit-testable with fixtures.

// B1: Supabase Storage object keys must be ASCII-safe — a raw filename like
// "Consulta de Certidão Permanente 07-2026 (1).pdf" breaks the upload with
// "Invalid key". Fold diacritics (same NFD technique as catalog-dedupe.ts's
// normalizeName, for consistency) and replace anything illegal; the
// ORIGINAL filename is kept separately as the document's display name
// (documents.name), never lost — this only ever touches the Storage key.
export function sanitizeStorageKey(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  const asciiBase = base.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const safeBase = asciiBase.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
  const safeExt = ext.replace(/[^A-Za-z0-9.]+/g, '');
  return `${safeBase || 'file'}${safeExt}`;
}

// B2: Google Docs/Sheets/Slides/Drive share links always contain /edit in
// their canonical URL (docs.google.com/document/d/ID/edit?usp=sharing) —
// permissions live server-side, not in the URL — so the blanket "/edit =
// editable" heuristic false-positives on every single Google link.
// Normalize these specific, well-known formats to their view-only
// equivalent before the no-edit-link check ever runs. Every other /edit
// link (Notion, anything else) still gets rejected — this is narrowly
// scoped to formats we can rewrite with confidence, not a general bypass.
const GOOGLE_DOC_EDIT_RE = /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/?#]+)\/edit(?:[/?#].*)?$/i;
const GOOGLE_DRIVE_EDIT_RE = /^(https?:\/\/drive\.google\.com\/file\/d\/[^/?#]+)\/edit(?:[/?#].*)?$/i;

export function normalizeDocumentUrl(url: string): string {
  const doc = url.match(GOOGLE_DOC_EDIT_RE);
  if (doc) return `${doc[1]}/preview`;
  const drive = url.match(GOOGLE_DRIVE_EDIT_RE);
  if (drive) return `${drive[1]}/view`;
  return url;
}

export function isEditableLink(url: string): boolean {
  return normalizeDocumentUrl(url).includes('/edit');
}
