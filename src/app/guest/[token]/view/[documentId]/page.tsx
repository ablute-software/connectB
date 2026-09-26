'use client';
// Prompt 742 §D.2 — the guest equivalent of /portal/view/[documentId].
// Mirrors that page closely (same rendering, same watermark/download
// gating) — the two differ only in which routes they call and the
// refusal vocabulary, which is the guest shelf's own (decideGuestOpen),
// not the investor route's.
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
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
  invalid: 'This link is not valid.',
  expired: 'This link has expired — ask the founder for a new one.',
  rate_limited: 'Too many attempts — try again shortly.',
  frozen: 'The founder has temporarily closed the data room.',
  confirmation_required: 'Confirm your access first to open this document.',
  nda_required: 'This document requires a signed NDA first.',
};

export default function GuestDocumentViewerPage() {
  const params = useParams<{ token: string; documentId: string }>();
  const [data, setData] = useState<ViewerPayload | ViewerError | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/guest/${encodeURIComponent(params.token)}/view/${encodeURIComponent(params.documentId)}`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, [params.token, params.documentId]);

  const ok = data && data.ok;
  const { markPageIntersection } = useDocumentViewProgress(
    `/api/guest/${encodeURIComponent(params.token)}/view-progress`, ok ? (data as ViewerPayload).viewId : null,
  );

  if (!data) return <div className="p-8"><LoadingState text="Loading…" compact /></div>;
  if (!data.ok) {
    return (
      <div className="mx-auto mt-16 max-w-sm text-center">
        <p className="text-sm text-gray-500">{REFUSAL_TEXT[data.reason] ?? 'This document is not available.'}</p>
      </div>
    );
  }

  const doc = data;
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2">
        <span className="truncate text-sm font-medium text-gray-900">{doc.name}</span>
        {doc.downloadable && (
          <a href={doc.url} download className="text-xs font-medium text-[#0E7490] hover:underline">Download</a>
        )}
      </header>
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
