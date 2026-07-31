'use client';
// Generic free-text tag input (Prompt 80 addenda, spec §3): a tag is
// committed on comma, semicolon, or Enter; pasting text containing either
// separator splits it into multiple tags in one go. Duplicates are
// case-insensitive ("Gambling" === "gambling"), empty/whitespace-only
// entries are rejected, and clicking an existing tag turns it back into an
// editable input (commit on Enter/blur, Escape cancels). Used both for the
// free-text half of ExclusionsPicker and standalone for focus_keywords.
import { useState, type KeyboardEvent, type ClipboardEvent } from 'react';

const SPLIT_RE = /[,;]/;

function norm(s: string) { return s.trim(); }
function key(s: string) { return s.toLowerCase(); }

export function TagInput({ tags, onChange, placeholder }: {
  tags: string[]; onChange: (tags: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');

  function addFromText(text: string) {
    const parts = text.split(SPLIT_RE).map(norm).filter(Boolean);
    if (parts.length === 0) return;
    const seen = new Set(tags.map(key));
    const next = [...tags];
    for (const p of parts) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(p);
    }
    if (next.length !== tags.length) onChange(next);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      addFromText(draft);
      setDraft('');
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (SPLIT_RE.test(text)) {
      e.preventDefault();
      addFromText(text);
      setDraft('');
    }
  }

  function handleBlur() {
    if (draft.trim()) { addFromText(draft); setDraft(''); }
  }

  function removeAt(i: number) {
    onChange(tags.filter((_, idx) => idx !== i));
  }

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditDraft(tags[i]);
  }

  function commitEdit(i: number) {
    const value = norm(editDraft);
    setEditingIndex(null);
    if (!value) { removeAt(i); return; }
    const seen = new Set(tags.filter((_, idx) => idx !== i).map(key));
    if (seen.has(key(value))) { removeAt(i); return; } // editing into an existing tag just merges
    const next = [...tags];
    next[i] = value;
    onChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-gray-300 px-2 py-1.5">
      {tags.map((t, i) => editingIndex === i ? (
        <input key={i} autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit(i); } if (e.key === 'Escape') setEditingIndex(null); }}
          onBlur={() => commitEdit(i)}
          className="w-28 rounded border border-[#0E7490] px-1 py-0.5 text-xs" />
      ) : (
        <span key={i} className="flex items-center gap-1 rounded-full bg-[#E8F4F8] px-2 py-0.5 text-xs text-[#0E7490]">
          <button type="button" onClick={() => startEdit(i)} className="hover:underline">{t}</button>
          <button type="button" onClick={() => removeAt(i)} aria-label={`Remove ${t}`} className="text-[#0E7490]/60 hover:text-[#0E7490]">×</button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} onBlur={handleBlur}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="min-w-[120px] flex-1 border-none px-1 py-0.5 text-xs outline-none" />
    </div>
  );
}
