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

interface SearchResult {
  kind: 'org' | 'catalog_entity' | 'person'; id: string; label: string; sublabel?: string; href: string;
  // Prompt 592 — set only for 'person': the org whose private pipeline this
  // contact belongs to. go() below must enter Developer Viewer for it
  // before navigating, or href (a founder-side /entities/[id] route) 404s
  // for a platform-admin session with no membership in that org.
  orgId?: string | null;
}

const KIND_LABEL: Record<SearchResult['kind'], string> = { org: 'Startup', catalog_entity: 'Investor', person: 'Person' };

export function BackofficeSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  // Prompt 587 §B — the shortcut itself already handles both metaKey (Mac)
  // and ctrlKey (Windows/Linux, where Nuno actually tests) below; only the
  // HINT text was Mac-only, showing "⌘K" on a keyboard that doesn't have
  // that key. navigator.platform is checked client-side only (SSR default
  // is the Windows/Linux label, the common case and Nuno's own).
  const [modifierLabel, setModifierLabel] = useState('Ctrl K');
  useEffect(() => {
    if (/mac/i.test(navigator.platform || navigator.userAgent)) setModifierLabel('⌘K');
  }, []);

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

  // Prompt 592 — a 'person' result points into a startup's private
  // pipeline (/entities/[id]), which the founder-side store only ever
  // resolves for a member of that org or a Developer Viewer session. Enter
  // one for orgId first (the exact mechanism startups/page.tsx's own "Open
  // as viewer" button already uses — same route, same audit trail), then
  // navigate; without this the same click just 404s, which is the bug
  // Nuno hit. org/catalog_entity results already land inside the
  // back-office, no viewer session needed.
  async function go(r: SearchResult) {
    setOpen(false);
    if (r.kind === 'person' && r.orgId) {
      try {
        const res = await fetch('/api/backoffice/viewer/enter', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId: r.orgId }),
        });
        const body = await res.json();
        if (!body.ok) { alert(`Could not open this person's workspace: ${body.error}`); return; }
      } catch {
        alert("Could not open this person's workspace.");
        return;
      }
      // Prompt 598 §B — a FULL page load, not router.push. The viewer cookie
      // was just set on this response, but a client-side transition keeps
      // the already-booted founder store and its already-resolved org, so
      // /entities/[id] still resolved against "no viewer session" and showed
      // "we couldn't find this entity". startups/page.tsx's own "Open as
      // viewer" button has always done a full load for exactly this reason
      // (window.location.href = '/'); this is the same move, just landing on
      // the person's entity instead of the pipeline home.
      window.location.href = r.href;
      return;
    }
    router.push(r.href);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (!results?.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[activeIndex]); }
  }

  return (
    <>
      {/* Prompt 587 §A — was its own hardcoded gray-800 patch, a second dark
          surface next to the Operator-mode box's own; now the same
          --sb-* tokens as the rest of the shell, one continuous surface. */}
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-lg border border-[var(--sb-border)] bg-[var(--sb-active)] px-2.5 py-2 text-left text-[12.5px] text-[var(--sb-dim)] transition hover:bg-white/5">
        <span className="flex items-center gap-2">
          <span aria-hidden>⌕</span> Search firms, people, orgs…
        </span>
        <span className="rounded border border-[var(--sb-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--sb-dim)]">{modifierLabel}</span>
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
