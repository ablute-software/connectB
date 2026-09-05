'use client';
// Prompt 576 §3 — global search (⌘K). Full-viewport overlay, so per this
// repo's own rule (see WelcomeModal/HelpSupportWidget) it renders through a
// portal: WorkspaceHeader's backdrop-blur is exactly the kind of ancestor
// that silently becomes the containing block for a plain `fixed` div and
// collapses it — this is not a hypothetical, it happened once already
// (2026-08-06, the MatchDeal pairing modal under this same header).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

interface SearchResult { kind: 'org' | 'catalog_entity' | 'person'; id: string; label: string; sublabel?: string; href: string }

const KIND_LABEL: Record<SearchResult['kind'], string> = { org: 'Startup', catalog_entity: 'Investor', person: 'Person' };

export function BackofficeSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (open) { setQ(''); setResults(null); setActiveIndex(0); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) { setResults(null); return; }
    const t = setTimeout(() => {
      fetch(`/api/backoffice/search?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((body) => {
        // A well-formed {ok:false} (demo mode, an expired session) is not a
        // thrown error and must not leave the panel on "Searching…" forever
        // — same failure shape as any other fetch, same "show empty rather
        // than spin" handling.
        setResults(body.ok ? body.results : []);
        setActiveIndex(0);
      }).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, open]);

  function go(r: SearchResult) { setOpen(false); router.push(r.href); }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (!results?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[activeIndex]); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-800/60 px-2.5 py-2 text-left text-[12.5px] text-gray-400 transition hover:bg-gray-800">
        <span className="flex items-center gap-2">
          <span aria-hidden>⌕</span> Search firms, people, orgs…
        </span>
        <span className="rounded border border-gray-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-500">⌘K</span>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]" onClick={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onInputKeyDown}
              placeholder="Search firms, people, orgs…" autoComplete="off"
              className="w-full rounded-t-2xl border-b border-gray-100 px-4 py-3.5 text-sm outline-none placeholder:text-gray-400" />
            <div className="max-h-80 overflow-y-auto py-1.5">
              {q.trim().length < 2 && <p className="px-4 py-3 text-xs text-gray-400">Type at least 2 characters…</p>}
              {q.trim().length >= 2 && results === null && <p className="px-4 py-3 text-xs text-gray-400">Searching…</p>}
              {results?.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">No matches.</p>}
              {results?.map((r, i) => (
                <button key={`${r.kind}-${r.id}`} onClick={() => go(r)} onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] ${i === activeIndex ? 'bg-[#0E7490]/10' : ''}`}>
                  <span>
                    <span className="font-medium text-gray-900">{r.label}</span>
                    {r.sublabel && <span className="ml-1.5 text-gray-400">· {r.sublabel}</span>}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{KIND_LABEL[r.kind]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
