// Prompt 909 (I4) — import a call's configuration from the promoter's OWN documents (regulation, a previous form,
// an evaluation grid), with AI, as a DRAFT PROPOSAL that changes nothing by itself.
//   POST multipart: files (1 to 3) and, per file, its kind (regulation | form | grid | other)
//        -> reads the files here first (format by its bytes, pages, a PDF with no text is refused: no OCR), stores the
//           documents in the call ("Source documents"), creates the run in state "reading" and ANSWERS AT ONCE with its id.
//           The model works after the response (lib/background.ts + ai-import/job.ts) and the run becomes "proposed"
//           (what it proposed, tokens, cost, who) or "failed" (why, in a sentence). The screen polls the run.
//   GET  -> the source documents of the call and the runs: a run still reading, a proposal waiting for review, the last failure,
//           what was found for later.
// Why not one request: reading a 52-question form took the model ~60 s, the old limit, and the browser got a gateway timeout
// (not JSON) while the server finished and saved the proposal (Prompt 909, Adenda 2, 14/10/2026).
// Needs the right to configure the call, and the configuration unlocked. Only documents of the promoter: the screen
// says so before sending (spec §2.3), and applicants' documents never come through here.
import { NextResponse, type NextRequest } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { extractDocument } from '@/lib/calls/ai-import/extract';
import { IMPORT_MAX_FILES, IMPORT_MAX_TOTAL_BYTES, isSourceKind, type SourceKind } from '@/lib/calls/ai-import/limits';
import { callAnthropic } from '@/lib/calls/ai-import/anthropic';
import { runImportJob } from '@/lib/calls/ai-import/job';
import type { PreparedDoc } from '@/lib/calls/ai-import/propose';
import { createReadingRun, expireStaleRuns, listRuns, listSourceDocuments, saveSourceDocument } from '@/lib/calls/ai-import/store';
import { runInBackground } from '@/lib/background';
import { logCallEvent } from '@/lib/calls/store';

// The request itself is short now; this is the time the background work (the model's reading) may take. Keep it equal to IMPORT_MAX_DURATION_S in
// ai-import/job.ts (Next reads this literal statically; a test keeps the two in step).
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const LOCKED = 'The configuration is locked. Use “Edit configuration” before the call opens; once it is open it cannot change.';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  await expireStaleRuns(auth.admin, auth.call.id);
  const [documents, runs] = await Promise.all([listSourceDocuments(auth.admin, auth.call.id), listRuns(auth.admin, auth.call.id)]);
  const kept = runs.filter((r) => r.status === 'proposed' || r.status === 'applied');
  const newest = runs[0] ?? null;
  return NextResponse.json({
    ok: true, documents,
    // A proposal still waiting for review, so closing the screen does not lose it; and a run still being read, so reopening the screen resumes the wait.
    pending: runs.find((r) => r.status === 'proposed') ?? null,
    reading: runs.find((r) => r.status === 'reading') ?? null,
    // The newest run failed (and nothing newer happened): say why, once the screen is opened again.
    lastFailure: newest && newest.status === 'failed' ? { id: newest.id, message: newest.errorMessage, code: newest.errorCode, at: newest.finishedAt ?? newest.createdAt } : null,
    foundLater: {
      eligibility: [...new Set(kept.flatMap((r) => r.foundLater.eligibility))],
      evaluation: [...new Set(kept.flatMap((r) => r.foundLater.evaluation))],
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id, { write: true });
  if (auth.error) return auth.error;
  if (auth.call.status !== 'draft') return NextResponse.json({ ok: false, code: 'locked', error: LOCKED }, { status: 409 });
  // One reading at a time per call: a second one would only compete with the first. The screen resumes the one in progress.
  await expireStaleRuns(auth.admin, auth.call.id);
  const inProgress = (await listRuns(auth.admin, auth.call.id)).find((r) => r.status === 'reading');
  if (inProgress) return NextResponse.json({ ok: false, code: 'busy', runId: inProgress.id, error: 'The documents of this call are already being read. Wait for it to finish.' }, { status: 409 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Send the documents as a file upload.' }, { status: 400 }); }
  const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f && typeof (f as File).name === 'string');
  const kinds = form.getAll('kinds').map(String);
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'Choose at least one document.' }, { status: 400 });
  if (files.length > IMPORT_MAX_FILES) return NextResponse.json({ ok: false, error: `Up to ${IMPORT_MAX_FILES} documents at a time.` }, { status: 400 });
  if (files.reduce((n, f) => n + f.size, 0) > IMPORT_MAX_TOTAL_BYTES) {
    return NextResponse.json({ ok: false, code: 'too_large', error: `The documents are too large: ${IMPORT_MAX_TOTAL_BYTES / (1024 * 1024)} MB in total at most.` }, { status: 413 });
  }

  // 1. Read every file BEFORE anything is sent or stored: format by its bytes, pages, text.
  const prepared: { name: string; kind: SourceKind; bytes: Buffer; docInfo: Awaited<ReturnType<typeof extractDocument>> & { ok: true } }[] = [];
  for (const [i, file] of files.entries()) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) return NextResponse.json({ ok: false, file: file.name, error: `“${file.name}” is empty.` }, { status: 400 });
    const info = await extractDocument(file.name, bytes);
    if (!info.ok) return NextResponse.json({ ok: false, code: info.code, file: file.name, error: files.length > 1 ? `${file.name}: ${info.error}` : info.error }, { status: 400 });
    prepared.push({ name: file.name, kind: isSourceKind(kinds[i]) ? (kinds[i] as SourceKind) : 'other', bytes, docInfo: info });
  }

  // 2. Keep the documents in the call, create the run "reading" and answer at once. A document that cannot be stored is dropped from the run.
  const saved = [];
  for (const p of prepared) {
    const doc = await saveSourceDocument(auth.admin, auth.call.id, { kind: p.kind, format: p.docInfo.format, fileName: p.name, bytes: p.bytes, pages: p.docInfo.pages }, auth.userId);
    if (doc) saved.push(doc);
  }
  const sent = prepared.map((p) => ({ name: p.name, kind: p.kind, bytes: p.bytes.length }));
  const run = await createReadingRun(auth.admin, auth.call.id, { sourceDocumentIds: saved.map((d) => d.id), sourceBytes: sent.reduce((n, f) => n + f.bytes, 0), userId: auth.userId });
  if (!run) return NextResponse.json({ ok: false, error: 'We could not start reading the documents. Please try again.' }, { status: 500 });
  await logCallEvent(auth.admin, auth.call.id, 'import_started', auth.userId, { runId: run.id, documents: saved.length, kinds: sent.map((f) => f.kind), bytes: run.sourceBytes });

  // 3. The model works after the response. The job owns the run from here: it ends "proposed" or "failed".
  const docs: PreparedDoc[] = prepared.map((p) => ({
    kind: p.kind, format: p.docInfo.format, text: p.docInfo.text, pdfBase64: p.docInfo.format === 'pdf' ? p.bytes.toString('base64') : null,
  }));
  runInBackground(runImportJob(
    { admin: auth.admin, callId: auth.call.id, runId: run.id, userId: auth.userId, docs, files: sent, sourceDocumentIds: saved.map((d) => d.id) },
    { callModel: callAnthropic },
  ));
  return NextResponse.json({ ok: true, run: { id: run.id, status: run.status, startedAt: run.createdAt }, documents: saved }, { status: 202 });
}
