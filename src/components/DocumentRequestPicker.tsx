'use client';
// Prompt 372 Block B — investor-facing "ask for documents" flow. Mounted
// inside the startup dossier's Documents tab for BOTH access levels: an
// investor with zero access sees exactly the same locked-document list as
// one who already has a grant, because /api/portal/document-picker already
// returns "everything not yet visible to me" regardless of current level —
// no separate code path needed here either.
import { useEffect, useState } from 'react';

interface PickerDoc { id: string; name: string; visibility: string; folderId: string | null }
interface PickerFolder { id: string; name: string; parentId: string | null; requestableCount: number }

export function DocumentRequestPicker({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<PickerDoc[] | null>(null);
  // Prompt 519 §1 — Nuno's ask: show the FOLDERS first with a count, let the
  // whole folder be picked in one go, and put the individual documents behind
  // an expander. A flat list made an investor tick fifteen boxes to ask for
  // one folder's worth of diligence.
  const [folders, setFolders] = useState<PickerFolder[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customItems, setCustomItems] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || docs !== null) return;
    fetch(`/api/portal/document-picker?orgId=${encodeURIComponent(orgId)}`)
      .then((r) => r.json()).then((d) => { setDocs(d.documents ?? []); setFolders(d.folders ?? []); })
      .catch(() => { setDocs([]); setFolders([]); });
  }, [open, docs, orgId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Selecting a folder means selecting the requestable documents inside it —
  // there is no "folder request" on the wire, and inventing one would mean a
  // second thing the founder has to answer differently on the review screen.
  // The founder still sees, and answers, one item per document.
  function docsInFolder(folderId: string): PickerDoc[] {
    return (docs ?? []).filter((d) => d.folderId === folderId);
  }

  function toggleFolder(folderId: string) {
    const inside = docsInFolder(folderId).map((d) => d.id);
    const allOn = inside.length > 0 && inside.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of inside) { if (allOn) next.delete(id); else next.add(id); }
      return next;
    });
  }

  function toggleExpanded(folderId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId); else next.add(folderId);
      return next;
    });
  }

  function addCustomItem() {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    setCustomItems((prev) => [...prev, trimmed]);
    setCustomInput('');
  }

  async function submit() {
    const items = [
      ...[...selected].map((documentId) => ({ documentId })),
      ...customItems.map((label) => ({ label })),
    ];
    if (items.length === 0) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/portal/document-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, message: message.trim() || undefined, items }),
      });
      const body = await res.json();
      if (!body.ok) { setResult({ ok: false, text: body.error ?? 'Could not send the request.' }); return; }
      if (!body.created) { setResult({ ok: true, text: body.message ?? 'Already pending — no need to ask twice.' }); return; }
      const skipped = body.alreadyPendingCount > 0 ? ` (${body.alreadyPendingCount} already pending, skipped)` : '';
      setResult({ ok: true, text: `Request sent${skipped}.` });
      setSelected(new Set());
      setCustomItems([]);
      setMessage('');
      setDocs(null); // refetch on next open — the picked items may now be pending elsewhere
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-600 hover:border-[#0E7490] hover:text-[#0E7490]">
        Ask for a document →
      </button>
    );
  }

  const totalSelected = selected.size + customItems.length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Ask for a document</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Close</button>
      </div>

      {docs === null ? (
        <p className="mt-2 text-xs text-gray-400">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">Nothing else is listed to ask for right now — use the field below to describe what you need.</p>
      ) : (
        <div className="mt-2 space-y-1.5">
          {folders.map((f) => {
            const inside = docsInFolder(f.id);
            const on = inside.filter((d) => selected.has(d.id)).length;
            const all = inside.length > 0 && on === inside.length;
            return (
              <div key={f.id} className="rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <input type="checkbox" checked={all} aria-label={`Request the whole ${f.name} folder`}
                    // Partly-selected reads as neither on nor off, which is
                    // the truth and stops the box lying about what will be sent.
                    ref={(el) => { if (el) el.indeterminate = on > 0 && !all; }}
                    onChange={() => toggleFolder(f.id)} />
                  <span className="text-sm font-medium text-gray-800">📁 {f.name}</span>
                  <span className="text-xs text-gray-400">{f.requestableCount} document{f.requestableCount === 1 ? '' : 's'}</span>
                  <button onClick={() => toggleExpanded(f.id)}
                    className="ml-auto text-xs text-[#0E7490] hover:underline">
                    {expanded.has(f.id) ? 'Hide' : 'Choose individually'}
                  </button>
                </div>
                {expanded.has(f.id) && (
                  <div className="space-y-1 border-t border-gray-100 px-3 py-1.5 pl-8">
                    {inside.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                        {d.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {/* Documents that sit outside any folder still need somewhere to be
              asked for — they are not dropped just because they have no
              parent to group under. */}
          {docs.filter((d) => !d.folderId).map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
              {d.name}
            </label>
          ))}
        </div>
      )}

      <div className="mt-3">
        <label className="text-xs font-medium text-gray-500">Not listed? Describe it</label>
        <div className="mt-1 flex gap-2">
          <input value={customInput} onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomItem(); } }}
            placeholder="e.g. latest cap table" className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
          <button onClick={addCustomItem} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-[#0E7490]">Add</button>
        </div>
        {customItems.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {customItems.map((item, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-gray-600">
                <span>{item}</span>
                <button onClick={() => setCustomItems((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-600">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <label className="text-xs font-medium text-gray-500">Message (optional)</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2}
          className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" placeholder="Any context for the founder…" />
      </div>

      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.text}</p>
      )}

      <button onClick={submit} disabled={totalSelected === 0 || submitting}
        className="mt-3 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        {submitting ? 'Sending…' : `Send request${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
      </button>
    </div>
  );
}
