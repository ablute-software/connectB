// Prompt 922 (I1) — reads an evaluation grid from an uploaded document (PDF with text, Word, Excel) with the platform's own reader and returns a proposal. "Read on our platform only. Evaluation grids are never
// sent to an AI provider." There is no fallback to one: a document the reader cannot read is said to be unreadable and the administrator builds the grid by hand. The bytes are read in memory and NOT kept:
// only the proposal (the criteria read and where each came from) is stored, with what the administrator corrects, per call.
import 'server-only';
import { extractDocument } from './ai-import/extract';
import { proposeGrid, type GridProposal } from './eval-grid-reader';

export const GRID_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const GRID_NOTICE = 'Read on our platform only. Evaluation grids are never sent to an AI provider.';

export type GridReading = { ok: true; proposal: GridProposal; format: string; pages: number | null } | { ok: false; error: string };

/** The proposal for one uploaded file. Never throws: every failure is a sentence for the screen. */
export async function readGridDocument(fileName: string, bytes: Buffer): Promise<GridReading> {
  if (bytes.length === 0) return { ok: false, error: 'The file is empty.' };
  if (bytes.length > GRID_IMPORT_MAX_BYTES) return { ok: false, error: 'The file is too large (10 MB at most).' };
  const ex = await extractDocument(fileName, bytes);
  if (!ex.ok) return { ok: false, error: ex.error };
  if (!ex.text) return { ok: false, error: 'No text could be read from the file. A scanned file cannot be read automatically: build the grid by hand.' };
  return { ok: true, proposal: proposeGrid(ex.text), format: ex.format, pages: ex.pages };
}
