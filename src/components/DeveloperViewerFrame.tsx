'use client';
// Prompt 123 Block A — Developer Viewer's visible frame. Two jobs:
// 1. Make the mode impossible to miss (permanent orange glow + pill —
//    never hidden, never subtle, so nobody forgets they're inside someone
//    else's workspace).
// 2. A layer-3 (cosmetic, per the spec's own "UI escondida não é
//    segurança") global write-block: catches clicks on buttons/submits
//    across the main content and shows a toast instead of forwarding
//    them. This is NOT the security boundary — RLS (layer 1) and
//    assertNotViewer() on every service-role mutating route (layer 2) are
//    what actually stop a write; this only makes the read-only nature
//    obvious everywhere at once, rather than requiring a disabled prop on
//    every button across the app.
import { useEffect, useState } from 'react';
import { isMutatingControlText, VIEWER_READ_ONLY_TOOLTIP } from '@/lib/viewer-readonly-controls';

const ORIGIN_KEY = 'sd_viewer_origin_path';

export function markViewerOrigin() {
  try { sessionStorage.setItem(ORIGIN_KEY, window.location.pathname); } catch { /* ignore */ }
}

export function DeveloperViewerFrame({ orgId, orgName }: { orgId: string; orgName: string | null }) {
  const [exiting, setExiting] = useState(false);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Click-catch, capture phase so it runs before the real handler. Only
  // intercepts controls that would actually mutate something — plain
  // navigation (links) stays untouched, or exiting viewer mode would be
  // the one thing you couldn't click your way out of.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      const target = (e.target as HTMLElement)?.closest('button, input[type="submit"], [role="button"]');
      if (!target || target.closest('[data-viewer-exempt]')) return;
      const isSubmitLike = target.tagName === 'BUTTON'
        ? (target as HTMLButtonElement).type !== 'button'
        : true;
      if (!isSubmitLike) return; // type="button" without a form submission is often just a tab/expand toggle
      // Read-only navigation controls (tabs, expand/collapse, filters) are
      // common and shouldn't all need per-button exemption tagging — so
      // this only blocks controls whose visible text signals a mutation.
      // Deliberately a blunt heuristic (word list), not a perfect
      // classifier — layers 1/2 are what actually prevent damage if this
      // misses one.
      // (Prompt 904 §A.3: the word list moved to lib/viewer-readonly-controls.ts and learned the verbs the first
      // list missed — Accept, Edit, Post, Suggest, Research, Change.)
      if (!isMutatingControlText(target.textContent || '')) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      setToast(true);
    }
    // Attached to `document` (capture phase), not a wrapper ref — this
    // component renders alongside the app's real content (see shell.tsx's
    // mount point), it doesn't wrap it, so there's no single DOM node that
    // contains everything to attach a scoped listener to.
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, []);

  // Prompt 904 §A.3 — the screen must not INVITE a write it will refuse: every control the word list calls a
  // write is greyed and says why on hover. aria-disabled (not `disabled`) on purpose — a disabled button shows no
  // tooltip in some browsers, and the click-catch above still answers a click with the toast. Re-applied as the
  // page re-renders. The API is the barrier (withActingOrg / the middleware gate); this only saves the click.
  useEffect(() => {
    function mark() {
      document.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]').forEach((el) => {
        if (el.closest('[data-viewer-exempt]') || el.dataset.viewerReadonly === '1') return;
        const label = el.tagName === 'INPUT' ? (el as HTMLInputElement).value : el.textContent || '';
        if (!isMutatingControlText(label)) return;
        el.dataset.viewerReadonly = '1';
        el.setAttribute('aria-disabled', 'true');
        if (!el.getAttribute('title')) el.setAttribute('title', VIEWER_READ_ONLY_TOOLTIP);
        el.style.opacity = '0.5';
        el.style.cursor = 'not-allowed';
      });
    }
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  async function exit() {
    setExiting(true);
    try {
      await fetch('/api/backoffice/viewer/exit', { method: 'POST' }).catch(() => {});
      let origin = '/backoffice/startups';
      try { origin = sessionStorage.getItem(ORIGIN_KEY) || origin; } catch { /* ignore */ }
      window.location.href = origin;
    } finally { setExiting(false); }
  }

  return (
    <>
      {/* The frame itself — fixed to the viewport (not the document), so it
          reads correctly regardless of page height (same lesson
          VaultPinGate's own header comment already names). */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[60]"
        style={{ boxShadow: 'inset 0 0 0 4px rgba(249,115,22,.9), inset 0 0 40px 10px rgba(249,115,22,.35)' }}
      />
      <div data-viewer-exempt className="pointer-events-none fixed inset-x-0 top-0 z-[61] flex justify-center">
        <div className="pointer-events-auto mt-2 flex items-center gap-2 rounded-full bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white shadow-lg">
          <span>👁 Developer Viewer: {orgName ?? orgId}</span>
          <button onClick={exit} disabled={exiting}
            className="rounded-full bg-white/20 px-2.5 py-0.5 font-bold hover:bg-white/30 disabled:opacity-50">
            {exiting ? 'Exiting…' : 'EXIT VIEWER MODE'}
          </button>
        </div>
      </div>
      {toast && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-[61] -translate-x-1/2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white shadow-lg">
          {VIEWER_READ_ONLY_TOOLTIP} — this action is disabled.
        </div>
      )}
    </>
  );
}
