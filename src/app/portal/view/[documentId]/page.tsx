'use client';
// Prompt 742 §D.2 — the in-app viewer page. Reached either directly, or
// via a 302 from /api/portal/open/[documentId] for a pdf/image/embed
// document (that GET route no longer mints a URL or logs an open itself
// for those three kinds — this page's own POST call to
// /api/portal/view/[documentId] is what does both, exactly once).
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PdfPages } from '@/components/portal/PdfPages';
import { DocumentWatermark } from '@/components/portal/DocumentWatermark';
import { useDocumentViewProgress } from '@/lib/use-document-view-progress';
import { LoadingState } from '@/components/workspace-shell/LoadingState';

interface ViewerPayload {
  ok: true; viewId: string | null; kind: 'pdf' | 'image' | 'embed' | 'external';
  url: string; name: string; watermark: boolean; downloadable: boolean; viewerLabel: string; viewerEmail: string;
}
interface ViewerError { ok: false; reason: string }

const REFUSAL_TEXT: Record<string, string> = {
  sign_in_required: 'Sign in to open this document.',
  not_found: 'This document is not available to you.',
  nda_required: 'This document requires a signed NDA first — check your access requests.',
  frozen: 'The founder has temporarily closed the data room.',
  unavailable: 'This document is not available right now.',
  not_configured: 'This is not available in this environment.',
};

export default function DocumentViewerPage() {
  const params = useParams<{ documentId: string }>();
  const [data, setData] = useState<ViewerPayload | ViewerError | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/view/${encodeURIComponent(params.documentId)}`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [params.documentId]);

  const ok = data && data.ok;
  const { markPageIntersection } = useDocumentViewProgress('/api/portal/view-progress', ok ? (data as ViewerPayload).viewId : null);

  if (!data) return <div className="p-8"><LoadingState text="Loading…" compact /></div>;
  if (!data.ok) {
    return (
      <div className="mx-auto mt-16 max-w-sm space-y-3 text-center">
        <p className="text-sm text-gray-500">{REFUSAL_TEXT[data.reason] ?? 'This document is not available.'}</p>
        <Link href="/portal" className="text-xs font-medium text-[#0E7490] hover:underline">← Back</Link>
      </div>
    );
  }

  const doc = data;
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <span className="truncate text-sm font-medium text-gray-900">{doc.name}</span>
        <div className="flex items-center gap-3">
          {doc.downloadable && (
            <a href={doc.url} download className="text-xs font-medium text-[#0E7490] hover:underline">Download</a>
          )}
          <Link href="/portal" className="text-xs text-gray-400 hover:text-gray-600">Close</Link>
        </div>
      </header>
      {/* D.5 — discreet, factual, never a counter: "how much" is the
          founder's own view (access-log), not something surfaced here. */}
      <p className="border-b border-gray-100 bg-white px-4 py-1.5 text-center text-[11px] text-gray-400">
        The founder can see that you opened this document, for how long and how many pages.
      </p>
      <div className="relative">
        {doc.watermark && <DocumentWatermark email={doc.viewerEmail} />}
        {doc.kind === 'pdf' && <PdfPages url={doc.url} onPageIntersection={markPageIntersection} />}
        {doc.kind === 'image' && (
          <div className="flex justify-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- a signed URL, not a static asset Next can optimize */}
            <img src={doc.url} alt={doc.name} className="max-w-full rounded shadow" />
          </div>
        )}
        {doc.kind === 'embed' && (
          <iframe src={doc.url} title={doc.name} className="h-[calc(100vh-90px)] w-full border-0" />
        )}
        {doc.kind === 'external' && (
          <div className="p-8 text-center text-sm text-gray-500">
            <a href={doc.url} target="_blank" rel="noreferrer" className="font-medium text-[#0E7490] hover:underline">
              Open “{doc.name}” →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
