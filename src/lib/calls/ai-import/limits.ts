// Prompt 909 (I4) — what the import from documents accepts, written ONCE so the screen and the server say the same
// thing (spec §5.3: "os formatos efetivamente suportados têm de ser comunicados na interface"). Client-safe.

export const IMPORT_MAX_FILES = 3;
/** The whole request. Vercel's serverless request body is capped at 4.5 MB, so 4 MB leaves room for the form data. */
export const IMPORT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const IMPORT_MAX_PDF_PAGES = 40;
/** Text read out of Word / Excel: about 40 000 words. More than that is refused, never silently cut. */
export const IMPORT_MAX_TEXT_CHARS = 150_000;

export type FileFormat = 'pdf' | 'docx' | 'xlsx';
export const IMPORT_FORMATS: { format: FileFormat; label: string; extension: string }[] = [
  { format: 'pdf', label: 'PDF with readable text', extension: '.pdf' },
  { format: 'docx', label: 'Word', extension: '.docx' },
  { format: 'xlsx', label: 'Excel', extension: '.xlsx' },
];
export const IMPORT_ACCEPT = IMPORT_FORMATS.map((f) => f.extension).join(',');

export const IMPORT_FORMATS_TEXT =
  `PDF with readable text, Word (.docx) and Excel (.xlsx). Up to ${IMPORT_MAX_FILES} files, ${IMPORT_MAX_TOTAL_BYTES / (1024 * 1024)} MB in total; PDFs up to ${IMPORT_MAX_PDF_PAGES} pages. `
  + 'A scanned PDF (only images of pages) cannot be read: there is no text recognition.';

/** Said on the screen BEFORE anything is sent (spec §2.3: only the promoter's own documents, never applicants'). */
// The platform reads the form first; only what it cannot read is sent to the AI provider (Prompt 917, Adenda 1, Part B). The notice says so — in both cases.
export const IMPORT_PRIVACY_NOTICE = "We read your document on our platform. If a part is unclear, that part is sent to our AI provider to complete the proposal. Do not upload applicants' documents or confidential evaluation grids.";

export const SCANNED_PDF_MESSAGE = 'This PDF has no readable text. Upload the original document.';

// Evaluation grids are NOT a kind here any more (Nuno, 15/10/2026): they are confidential to the organisation and never go to an external AI. Importing a
// grid will be done INSIDE the platform, deterministically, by the grid editor of Stage 3. A request that still says "grid" is refused by the server.
export type SourceKind = 'regulation' | 'form' | 'other';
export const SOURCE_KINDS: SourceKind[] = ['regulation', 'form', 'other'];
export const GRID_REFUSED_MESSAGE = 'Evaluation grids are confidential and are not read by AI. Upload the regulation or a previous form; the grid is imported in the platform’s own grid editor.';
export const isGridKind = (v: unknown): boolean => typeof v === 'string' && v.trim().toLowerCase() === 'grid';
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  regulation: 'Regulation', form: 'Previous form', other: 'Other document',
};
export const isSourceKind = (v: unknown): v is SourceKind => SOURCE_KINDS.includes(v as SourceKind);
