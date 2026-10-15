'use client';
// Prompt 909 (I4) — "Source documents" in the General tab: the organisation's own documents that were imported into
// this call, visible to the team, deletable; what the engine found for the next stages (eligibility rules and
// evaluation criteria) as plain text; and the way into "Import from documents".
import { useCallback, useEffect, useState } from 'react';
import { SOURCE_KIND_LABELS, type SourceKind } from '@/lib/calls/ai-import/limits';
import type { ImportStatus } from '@/lib/calls/ai-import/screen-state';
import { callsApi } from './api';
import { ImportStatusPill } from './ImportStatusPill';

interface Doc { id: string; kind: SourceKind; mimeType?: string; fileName: string; sizeBytes: number; pages: number | null; createdAt: string; publicToApplicants?: boolean }

export function SourceDocumentsPanel({ callId, canConfigure, locked, reloadKey, onImport, importStatus = null }: {
  callId: string; canConfigure: boolean; locked: boolean; reloadKey: number; onImport: () => void; importStatus?: ImportStatus;
}) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [found, setFound] = useState<{ eligibility: string[]; evaluation: string[] }>({ eligibility: [], evaluation: [] });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await callsApi.sourceDocuments(callId);
    if (!r.ok) { setDocs([]); return; }
    setDocs(r.body.documents); setFound(r.body.foundLater);
  }, [callId]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  // Prompt 907 (I1): the regulation PDF the call's link offers to applicants. Only a regulation that is a PDF can be shown.
  async function togglePublic(d: Doc, on: boolean) {
    setError('');
    const r = await callsApi.setSourceDocumentPublic(callId, d.id, on);
    if (!r.ok) { setError(r.body.error ?? 'Could not change that.'); return; }
    await load();
  }

  async function remove(d: Doc) {
    if (!window.confirm(`Delete “${d.fileName}” from this call? What was already applied from it stays.`)) return;
    setError('');
    const r = await callsApi.deleteSourceDocument(callId, d.id);
    if (!r.ok) { setError(r.body.error ?? 'Could not delete the document.'); return; }
    await load();
  }

  if (docs === null) return null;
  if (docs.length === 0 && !canConfigure) return null;
  return (
    <section className="mt-8 rounded-lg border border-gray-200 p-4" data-testid="source-documents">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Source documents</h2>
        {canConfigure && (
          <button type="button" onClick={onImport} disabled={locked} data-testid="open-import-docs" title={locked ? 'The configuration is locked.' : undefined}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">Import from documents</button>
        )}
        {canConfigure && <ImportStatusPill status={importStatus} onClick={importStatus === 'ready' ? onImport : undefined} />}
      </div>
      {docs.length === 0 ? <p className="mt-2 text-xs text-gray-400">No documents imported into this call.</p> : (
        <ul className="mt-2 divide-y divide-gray-100 text-xs">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-1.5">
              <span><b className="text-gray-900">{d.fileName}</b> <span className="text-gray-500">· {SOURCE_KIND_LABELS[d.kind]} · {(d.sizeBytes / 1024).toFixed(0)} KB{d.pages ? ` · ${d.pages} page${d.pages === 1 ? '' : 's'}` : ''}</span></span>
              <span className="flex items-center gap-3">
                {canConfigure && d.kind === 'regulation' && d.mimeType === 'application/pdf' && (
                  <label className="flex items-center gap-1 text-gray-600" title="Shown on the call's link, to everyone who has it">
                    <input type="checkbox" checked={d.publicToApplicants === true} onChange={(e) => void togglePublic(d, e.target.checked)} data-testid="show-to-applicants" />
                    Show to applicants
                  </label>
                )}
                {canConfigure && <button type="button" className="text-[#B00000] hover:underline" onClick={() => void remove(d)}>Delete</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-[#B00000]">{error}</p>}
      {(found.eligibility.length > 0 || found.evaluation.length > 0) && (
        <div className="mt-4 border-t border-gray-100 pt-3" data-testid="source-found-later">
          <p className="text-xs font-semibold text-gray-700">Found in the document, configured in a later stage</p>
          {found.eligibility.length > 0 && <><p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Eligibility rules</p><ul className="mt-1 list-disc pl-5 text-xs text-gray-700">{found.eligibility.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
          {found.evaluation.length > 0 && <><p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Evaluation criteria</p><ul className="mt-1 list-disc pl-5 text-xs text-gray-700">{found.evaluation.map((t, i) => <li key={i}>{t}</li>)}</ul></>}
        </div>
      )}
    </section>
  );
}
