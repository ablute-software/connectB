'use client';
// Prompt 742 §D.1 — renders a PDF page by page, at the size the SCROLL
// CONTAINER entered the viewport (a 30-60 page deck on a phone must never
// render every page eagerly — a real complaint the prompt names directly).
// pdfjs-dist is imported dynamically, client-only, so it never enters the
// server bundle or the common client chunk other pages pay for.
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export function PdfPages({ url, onPageIntersection }: {
  url: string;
  onPageIntersection: (pageNum: number, ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderedRef = useRef<Set<number>>(new Set());
  const [numPages, setNumPages] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const pdfjs = await import('pdfjs-dist');
        // A plain static path, not `new URL(..., import.meta.url)`: that
        // pattern makes Next.js try to run its build-time minifier over the
        // worker's own ES-module syntax and fail ("'import.meta' cannot be
        // used outside of module code" — confirmed empirically). The file
        // is copied into public/ by scripts/copy-pdf-worker.mjs
        // (postinstall), so the browser just fetches and runs it directly.
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const loadingTask = pdfjs.getDocument({ url });
        loadingTaskRef.current = loadingTask;
        const doc = await loadingTask.promise;
        if (cancelled) { loadingTask.destroy(); return; }
        pdfRef.current = doc;
        setNumPages(doc.numPages);
      } catch {
        if (!cancelled) setError('Could not load this PDF.');
      }
    }
    load();
    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      pdfRef.current = null;
    };
  }, [url]);

  // One observer for every page placeholder: lazily renders a page's
  // canvas the first time it's ever seen, and separately reports every
  // ratio change upward for the ≥50%-for-≥2s "distinct pages seen" rule
  // (use-document-view-progress.ts owns that timing, not this component).
  useEffect(() => {
    if (!numPages || !containerRef.current) return;
    const nodes = containerRef.current.querySelectorAll<HTMLElement>('[data-pdf-page]');
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNum = Number((entry.target as HTMLElement).dataset.pdfPage);
        onPageIntersection(pageNum, entry.intersectionRatio);
        if (entry.isIntersecting) renderPage(pageNum, entry.target as HTMLElement);
      }
    }, { threshold: [0, 0.5, 1] });
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages]);

  async function renderPage(pageNum: number, container: HTMLElement) {
    if (renderedRef.current.has(pageNum) || !pdfRef.current) return;
    renderedRef.current.add(pageNum);
    const canvas = container.querySelector('canvas');
    if (!canvas) return;
    const page = await pdfRef.current.getPage(pageNum);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = (container.clientWidth || unscaled.width) / unscaled.width;
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  }

  if (error) return <p className="p-4 text-sm text-[#B00000]">{error}</p>;
  if (!numPages) return <p className="p-4 text-sm text-gray-400">Loading…</p>;

  return (
    <div ref={containerRef} className="mx-auto flex max-w-3xl flex-col gap-3 p-3">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
        <div key={pageNum} data-pdf-page={pageNum} className="relative flex min-h-[400px] items-center justify-center rounded bg-white shadow">
          <canvas />
          <span className="absolute bottom-1 right-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{pageNum} / {numPages}</span>
        </div>
      ))}
    </div>
  );
}
