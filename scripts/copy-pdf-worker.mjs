// Prompt 742 §D.1 — pdfjs-dist's worker file must be servable as a plain
// static asset, not bundled by webpack: pointing GlobalWorkerOptions.workerSrc
// at it via `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
// makes Next.js's build try to run Terser over the worker's own ES-module
// syntax and fail with "'import.meta' cannot be used outside of module
// code" (confirmed empirically — this is a known pdfjs-dist + Next.js
// webpack interaction, not something specific to this app). Copying the
// worker into public/ and referencing it by a plain string path sidesteps
// webpack/Terser entirely: the browser loads and runs it directly, the
// same way it would any other static file.
//
// Runs on postinstall so the copy can never silently drift from whatever
// pdfjs-dist version package.json actually resolves to.
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const dest = path.join(here, '..', 'public', 'pdf.worker.min.mjs');

if (!existsSync(src)) {
  console.warn('[copy-pdf-worker] pdfjs-dist worker not found — skipping (pdfjs-dist not installed?).');
  process.exit(0);
}
copyFileSync(src, dest);
console.log('[copy-pdf-worker] copied pdf.worker.min.mjs into public/.');
