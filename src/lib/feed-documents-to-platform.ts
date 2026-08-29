// Prompt 464 §B — the client-driven replacement for the Prompt 463 §C
// fire-and-forget that never actually ran: a Vercel serverless instance is
// frozen the instant its response is sent, so a `void extractDocument(...)`
// left running after `return` gets no more CPU — confirmed empirically in
// production (zero new document_extractions rows, zero new ai_call_log
// entries after a real pass with the deck selected). The client now drives
// this instead, one real awaited request per document.
//
// Pulled out as a pure orchestration function, injected with the actual
// HTTP call, so the SERIAL ordering and per-document failure naming can be
// tested without mocking fetch/DOM through a full component render — this
// codebase's own convention is pure functions get tested, not components.
export interface FeedOneResult { ok: boolean; skippedReason?: string }

export async function feedDocumentsToRestOfPlatform(
  readDocuments: { id: string; name: string }[],
  extractOne: (documentId: string) => Promise<FeedOneResult>,
  onProgress?: (doc: { name: string; index: number; total: number }) => void,
): Promise<{ name: string; skippedReason?: string }[]> {
  const failures: { name: string; skippedReason?: string }[] = [];
  for (let i = 0; i < readDocuments.length; i++) {
    const doc = readDocuments[i];
    onProgress?.({ name: doc.name, index: i + 1, total: readDocuments.length });
    // Never Promise.all/parallel: each call reads a whole PDF and pays a
    // real model request — running several at once is an unnecessary spike
    // and makes any one failure illegible (Prompt 464's own requirement).
    const result = await extractOne(doc.id);
    if (!result.ok) failures.push({ name: doc.name, skippedReason: result.skippedReason });
  }
  return failures;
}
