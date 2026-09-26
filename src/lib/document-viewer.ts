// Prompt 742 §D — pure classification for the in-app document viewer. No
// I/O: given a document's storage_path/external_url, decides which of the
// 4 viewer kinds applies. Kept separate from data-room.ts's
// normalizeDocumentUrl (which exists to reject non-Google /edit links when
// a founder ADDS a link — a different question from "how should the
// viewer render this").
export type ViewerKind = 'pdf' | 'image' | 'embed' | 'external';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);

// D.1 — Google Docs/Slides/Sheets/Drive links embed via their own
// `/preview` variant (normalizeDocumentUrl converts a Drive /edit link to
// /view, which generally refuses to be framed — the viewer needs /preview
// specifically, regardless of what suffix — /edit, /view, none — the
// stored link happens to carry).
const GOOGLE_DOC_RE = /^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[^/?#]+)(?:[/?#].*)?$/i;
const GOOGLE_DRIVE_RE = /^(https?:\/\/drive\.google\.com\/file\/d\/[^/?#]+)(?:[/?#].*)?$/i;

export function googlePreviewUrl(url: string): string | null {
  const doc = url.match(GOOGLE_DOC_RE);
  if (doc) return `${doc[1]}/preview`;
  const drive = url.match(GOOGLE_DRIVE_RE);
  if (drive) return `${drive[1]}/preview`;
  return null;
}

export function resolveViewerKind(doc: { storage_path?: string | null; external_url?: string | null }): ViewerKind {
  if (doc.storage_path) {
    const ext = doc.storage_path.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf') return 'pdf';
    if (IMAGE_EXTENSIONS.has(ext)) return 'image';
    return 'external';
  }
  if (doc.external_url && googlePreviewUrl(doc.external_url)) return 'embed';
  return 'external';
}

// D.5/D.1 — a short, honest label per kind; 'external' never claims to be
// measured (D.1: "sem medição" for that bucket).
export const VIEWER_KIND_LABEL: Record<ViewerKind, string> = {
  pdf: 'PDF viewer', image: 'Image viewer', embed: 'Google preview', external: 'Opens in a new tab',
};
