'use client';
// Prompt 750 — the in-platform reading window Nuno expected instead of a
// new browser tab. Made cheap by the streaming-proxy fix elsewhere in this
// prompt: an <iframe>/<video> pointed at our own /api/portal/open/<id> (or
// the guest twin) never puts a Storage URL in the address bar, because the
// proxy route itself is the only URL involved — the same URL an <a href>
// used to point at, just rendered inline instead of navigated to.
//
// Deliberately generic over the caller's own document-list shape (items +
// index + onIndexChange) rather than owning any fetch itself — the
// Documents tab, the journey rail and the Data room tab each already have
// their own ordered list of documents; this component only needs an id, a
// display name and an optional folder label for each one, plus a function
// to turn an id into this app's own open-route URL (different for a
// signed-in investor vs. a guest token).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { inlineKindFor } from '@/lib/document-inline-kinds';

export interface ViewerDocItem {
  id: string;
  name: string;
  folderName?: string;
}

export function DocumentViewerModal({
  items,
  index,
  onIndexChange,
  onClose,
  openUrl,
}: {
  items: ViewerDocItem[];
  index: number;
  onIndexChange: (nextIndex: number) => void;
  onClose: () => void;
  /** Builds the proxy URL for one document id — never a Storage URL. */
  openUrl: (id: string) => string;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const doc = items[index];

  // Prompt 750 §"Não há navegação" — the trigger element still has focus
  // when this mounts (opening the modal is a plain state change, not a
  // navigation); restoring it on close is what "o foco volta ao documento
  // que se tinha clicado" means in practice, with no ref-passing needed
  // from any of the three callers.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    return () => previouslyFocused.current?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && index < items.length - 1) onIndexChange(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndexChange]);

  // Mobile opens already full screen, per spec.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches) setFullscreen(true);
  }, []);

  if (typeof document === 'undefined' || !doc) return null;

  const kind = inlineKindFor(doc.name);
  const src = openUrl(doc.id);

  return createPortal(
    <div
      className={fullscreen ? 'fixed inset-0 z-50 bg-black' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'}
      // Click-outside-closes only applies to the normal (backdrop-visible)
      // mode — full screen has no backdrop to click, per spec.
      onClick={fullscreen ? undefined : onClose}
    >
      <div
        className={fullscreen
          ? 'flex h-full w-full flex-col bg-white'
          : 'flex h-[90vh] w-[90vw] max-w-[1200px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Fixed header — never scrolls with the document, X always visible. */}
        <div className="relative flex shrink-0 items-center gap-1.5 border-b border-gray-100 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <button onClick={() => setSelectorOpen((v) => !v)}
              className="max-w-full truncate text-left text-sm font-semibold text-gray-900 hover:underline">
              {doc.name}
            </button>
            <div className="text-[11px] text-gray-400">
              {doc.folderName ? `${doc.folderName} · ` : ''}{index + 1} of {items.length}
            </div>
            {selectorOpen && (
              <div className="absolute left-4 top-full z-10 mt-1 max-h-64 w-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                {items.map((it, i) => (
                  <button key={it.id} onClick={() => { onIndexChange(i); setSelectorOpen(false); }}
                    className={`block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${
                      i === index ? 'bg-[#E8F4F8] font-semibold text-[#0E7490]' : 'text-gray-700'}`}>
                    {it.folderName ? `${it.folderName} / ` : ''}{it.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => onIndexChange(index - 1)} disabled={index === 0} aria-label="Previous document"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
            ‹
          </button>
          <button onClick={() => onIndexChange(index + 1)} disabled={index === items.length - 1} aria-label="Next document"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
            ›
          </button>
          <button onClick={() => setFullscreen((v) => !v)}
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
            {fullscreen ? 'Exit full screen' : 'Expand'}
          </button>
          <button onClick={onClose} aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-900">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-gray-50">
          {kind === 'video' ? (
            <video key={src} src={src} controls className="h-full w-full bg-black" />
          ) : kind === 'iframe' ? (
            <iframe key={src} src={src} title={doc.name} className="h-full w-full border-0" />
          ) : (
            // Prompt 750, review fix (Nuno) — Word/Excel/PowerPoint and
            // every other non-inline-allowlisted type used to land here as
            // a blank iframe: the proxy sets Content-Disposition: attachment
            // for these, so the browser downloads them silently INSIDE the
            // frame instead of showing anything. A named state with a real
            // download action instead of a frame the investor has no way to
            // interpret.
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-gray-500">This file type can&apos;t be previewed here.</p>
              <a href={src} className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white hover:bg-[#0c637b]">
                Download {doc.name}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
