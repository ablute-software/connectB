'use client';
// Prompt 353 — founder-side "Photos & media" card: upload images/short
// videos (Vault-style: content-sniffed + malware-scanned server-side) or
// paste a YouTube/Vimeo link, each tagged with a category that decides
// where it lands in the investor dossier (Company -> About, Technology ->
// the "Product & technology" block within About, Team -> Team).
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui';
import { MEDIA_CATEGORIES, MAX_MEDIA_PER_ORG, type MediaCategory } from '@/lib/company-media';

interface MediaItem {
  id: string; kind: 'image' | 'video_upload' | 'video_link'; category: MediaCategory; caption: string;
  storage_path: string | null; external_url: string | null; malware_scan_status: 'pending' | 'clean' | 'flagged'; sort_order: number;
}

const SCAN_LABEL: Record<MediaItem['malware_scan_status'], string> = {
  pending: 'Scanning…', clean: '', flagged: 'Blocked — flagged by malware scan',
};

export function PhotosMediaCard({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [category, setCategory] = useState<MediaCategory>('company');
  const [caption, setCaption] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch('/api/company-media').then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => setItems([]));
  }
  useEffect(load, []);

  async function submitFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a file first.'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.append('file', file); form.append('category', category); form.append('caption', caption);
      const res = await fetch('/api/company-media/upload', { method: 'POST', body: form });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Upload failed.'); return; }
      setCaption(''); if (fileRef.current) fileRef.current.value = '';
      load();
    } finally { setBusy(false); }
  }

  async function submitLink() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/company-media/link', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: linkUrl, category, caption }),
      });
      const body = await res.json();
      if (!body.ok) { setError(body.error ?? 'Could not add this link.'); return; }
      setCaption(''); setLinkUrl('');
      load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    await fetch(`/api/company-media?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  }

  async function move(id: string, dir: -1 | 1) {
    if (!items) return;
    const idx = items.findIndex((i) => i.id === id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    await fetch('/api/company-media', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderedIds: next.map((i) => i.id) }),
    });
  }

  if (!canEdit && (!items || items.length === 0)) return null;

  return (
    <Card title="Photos & media">
      <p className="text-xs text-gray-400">
        Shown to investors in the section that matches each item&apos;s category — Company in About, Technology in
        Product &amp; technology, Team in Team. Never shown on the compact Pipeline card.
      </p>

      {items === null ? (
        <p className="mt-2 text-xs text-gray-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">No photos or videos yet.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
              <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 capitalize">{it.category}</span>
              <span className="flex-1 truncate text-gray-700">{it.caption}</span>
              {it.malware_scan_status !== 'clean' && (
                <span className={`shrink-0 text-[10px] ${it.malware_scan_status === 'flagged' ? 'text-[#B00000]' : 'text-gray-400'}`}>
                  {SCAN_LABEL[it.malware_scan_status]}
                </span>
              )}
              {canEdit && (
                <>
                  <button onClick={() => move(it.id, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
                  <button onClick={() => move(it.id, 1)} disabled={i === items.length - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
                  <button onClick={() => remove(it.id)} className="text-gray-400 hover:text-[#B00000]">Remove</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (items?.length ?? 0) < MAX_MEDIA_PER_ORG && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
          <div className="flex gap-1.5">
            <button onClick={() => setMode('file')} className={`rounded-full px-2.5 py-1 text-xs font-medium ${mode === 'file' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>Upload file</button>
            <button onClick={() => setMode('link')} className={`rounded-full px-2.5 py-1 text-xs font-medium ${mode === 'link' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>Video link</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {MEDIA_CATEGORIES.map((c) => (
              <button key={c.value} onClick={() => setCategory(c.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${category === c.value ? 'bg-[#E8F4F8] text-[#0E7490] border border-[#0E7490]' : 'border border-gray-200 text-gray-600'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <input autoComplete="off" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption — what is this? (required)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          {mode === 'file' ? (
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              className="mt-2 block w-full text-xs" />
          ) : (
            <input autoComplete="off" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="YouTube or Vimeo link"
              className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          )}
          {error && <p className="mt-1.5 text-[11px] text-[#B00000]">{error}</p>}
          <button onClick={mode === 'file' ? submitFile : submitLink} disabled={busy || !caption.trim()}
            className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      )}
    </Card>
  );
}
