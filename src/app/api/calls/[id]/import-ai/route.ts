// Prompt 909 (I4) — import a call's configuration from the promoter's OWN documents (regulation, a previous form,
// an evaluation grid), with AI, as a DRAFT PROPOSAL that changes nothing by itself.
//   POST multipart: files (1 to 3) and, per file, its kind (regulation | form | grid | other)
//        -> reads the files here first (format by its bytes, pages, a PDF with no text is refused: no OCR), then asks
//           the model for a proposal, stores the documents in the call ("Source documents"), records the run (what it
//           proposed, tokens, cost, who) and returns the proposal for review.
//   GET  -> the source documents of the call and the runs (what is still waiting for review, what was found for later)
// Needs the right to configure the call, and the configuration unlocked. Only documents of the promoter: the screen
// says so before sending (spec §2.3), and applicants' documents never come through here.
import { NextResponse, type NextRequest } from 'next/server';
import { authCall } from '@/lib/calls/access';
import { logAiCall, computeCostEur } from '@/lib/ai-cost-log';
import { extractDocument } from '@/lib/calls/ai-import/extract';
import { IMPORT_MAX_FILES, IMPORT_MAX_TOTAL_BYTES, isSourceKind, type SourceKind } from '@/lib/calls/ai-import/limits';
import { ImportProviderError, callAnthropic } from '@/lib/calls/ai-import/anthropic';
import { proposeFromDocuments, type PreparedDoc } from '@/lib/calls/ai-import/propose';
import { createRun, listRuns, listSourceDocuments, saveSourceDocument } from '@/lib/calls/ai-import/store';
import { logCallEvent } from '@/lib/calls/store';

// The model reads up to 40 pages: give it the time (the platform's other long AI routes do the same).
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const LOCKED = 'The configuration is locked. Use “Edit configuration” before the call opens; once it is open it cannot change.';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authCall(params.id);
  if (auth.error) return auth.error;
  const [documents, runs] = await Promise.all([listSourceDocuments(auth.admin, auth.call.id), listRuns(auth.admin, auth.call.id)]);
  const kept = runs.filter((r) => r.status !== 'discarded');
  return NextResponse.json({
    ok: true, documents,
    // A proposal still waiting for review, so closing the screen does not lose it.
    pending: runs.find((r) => r.status === 'proposed') ?? null,
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

  // 2. The model proposes. Nothing is stored yet: a failure costs the person nothing but a retry.
  const docs: PreparedDoc[] = prepared.map((p) => ({
    kind: p.kind, format: p.docInfo.format, text: p.docInfo.text, pdfBase64: p.docInfo.format === 'pdf' ? p.bytes.toString('base64') : null,
  }));
  let result: Awaited<ReturnType<typeof proposeFromDocuments>>;
  try { result = await proposeFromDocuments(docs, { callModel: callAnthropic }); }
  catch (e) {
    const status = e instanceof ImportProviderError ? e.status : 502;
    return NextResponse.json({ ok: false, error: e instanceof ImportProviderError ? e.message : 'We could not read the documents right now. Please try again in a moment.' }, { status });
  }
  // Awaited: ai_call_log is used as proof that a pipeline ran (see ai-review).
  await logAiCall({ route: '/api/calls/import-ai', purpose: 'calls_import_from_documents', model: result.model, usage: result.usage, targetType: 'call', targetId: auth.call.id });

  // 3. Keep the documents in the call, and the run.
  const saved = [];
  for (const p of prepared) {
    const doc = await saveSourceDocument(auth.admin, auth.call.id, { kind: p.kind, format: p.docInfo.format, fileName: p.name, bytes: p.bytes, pages: p.docInfo.pages }, auth.userId);
    if (doc) saved.push(doc);
  }
  const costEur = computeCostEur(result.model, result.usage);
  const run = await createRun(auth.admin, auth.call.id, {
    proposal: result.proposal, sourceDocumentIds: saved.map((d) => d.id), model: result.model,
    tokensIn: result.usage?.input_tokens ?? null, tokensOut: result.usage?.output_tokens ?? null, costEur, userId: auth.userId,
  });
  if (!run) return NextResponse.json({ ok: false, error: 'The proposal could not be saved. Please try again.' }, { status: 500 });
  await logCallEvent(auth.admin, auth.call.id, 'import_proposed', auth.userId, {
    runId: run.id, documents: saved.length, kinds: prepared.map((p) => p.kind), tokensIn: run.tokensIn, tokensOut: run.tokensOut, costEur: run.costEur, model: result.model,
  });
  return NextResponse.json({ ok: true, run, documents: saved });
}
