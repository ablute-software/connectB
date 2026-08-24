'use client';
// Prompt 353 — the investor-facing gallery: a grid of thumbnails, click
// opens a lightbox (image) or reveals an embed (video — never autoplay,
// never before the click). The lightbox is a full-viewport overlay, so it
// goes through createPortal(document.body) per CLAUDE.md's overlay rule —
// an ancestor with backdrop-blur/transform (this dossier has several)
// would otherwise silently collapse it to that ancestor's own box.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toEmbedUrl } from '@/lib/company-media';

export interface GalleryItem { id: string; caption: string; kind: 'image' | 'video_upload' | 'video_link'; url: string }

function Lightbox({ item, onClose }: { item: GalleryItem; onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  const embedUrl = item.kind === 'video_link' ? toEmbedUrl(item.url) : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        {item.kind === 'image' ? (
          <img src={item.url} alt={item.caption} className="max-h-[80vh] w-auto rounded-lg" />
        ) : item.kind === 'video_upload' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={item.url} controls autoPlay className="max-h-[80vh] w-auto rounded-lg" />
        ) : embedUrl ? (
          <iframe src={embedUrl} allow="fullscreen; encrypted-media" allowFullScreen
            className="aspect-video w-[min(80vw,900px)] rounded-lg" />
        ) : null}
        <p className="mt-2 text-center text-sm text-white/90">{item.caption}</p>
        <button onClick={onClose} className="mt-2 block w-full text-center text-xs text-white/70 hover:underline">Close</button>
      </div>
    </div>,
    document.body,
  );
}

export function MediaGallery({ items }: { items: GalleryItem[] }) {
  const [open, setOpen] = useState<GalleryItem | null>(null);
  if (items.length === 0) return null;

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
      {items.map((it) => (
        <button key={it.id} onClick={() => setOpen(it)}
          className="group relative aspect-video overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
          {it.kind === 'image' ? (
            <img src={it.url} alt={it.caption} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-800">
              <span className="text-2xl text-white">▶</span>
            </div>
          )}
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-left text-[10px] text-white">{it.caption}</span>
        </button>
      ))}
      {open && <Lightbox item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
