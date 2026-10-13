'use client';
// Prompt 905 — Calls, the list of an organisation's calls as cards (the visual language of the pipelines): name,
// state (colour AND label), dates with their time zone, number of applications (0 until Prompt 906), and what is in
// the form. "New call" and "Duplicate" for those who manage calls; a duplicate never copies applications.
import { useCallback, useEffect, useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { formatInZone } from '@/lib/calls/tz';
import { callsApi, type CallListItem, type PromoterInfo } from './api';
import { ARCHIVE_CONFIRM, DELETE_CONFIRM, callMenu, hasMenu, visibleCalls } from '@/lib/calls/list-view';
import { StatusBadge } from './StatusBadge';

export function CallsList({ kind, onOpen }: { kind: PromoterKind; onOpen: (id: string, opts?: { importFirst?: boolean }) => void }) {
  const [promoter, setPromoter] = useState<PromoterInfo | null>(null);
  const [calls, setCalls] = useState<CallListItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const res = await callsApi.list(kind);
    if (!res.ok) { setError(res.body.error ?? 'Could not load your calls.'); setCalls([]); return; }
    setError(''); setPromoter(res.body.promoter); setCalls(res.body.calls);
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  async function create(importFirst = false) {
    setBusy('new'); setError('');
    const res = await callsApi.create(kind);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not create the call.'); return; }
    onOpen(res.body.call.id, { importFirst });
  }
  /** "Duplicate a call" from the New call menu: pick one of yours below, the copy opens. */
  async function duplicateAndOpen(id: string) {
    setBusy(id); setError('');
    const res = await callsApi.duplicate(id);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not duplicate the call.'); return; }
    setPicking(false);
    onOpen(res.body.call.id);
  }
  async function duplicate(id: string) {
    setBusy(id); setError('');
    const res = await callsApi.duplicate(id);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not duplicate the call.'); return; }
    await load();
  }

  async function archive(id: string) {
    if (!window.confirm(ARCHIVE_CONFIRM)) return;
    setBusy(id); setError('');
    const res = await callsApi.act(id, 'archive');
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not archive the call.'); return; }
    await load();
  }
  async function remove(id: string) {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setBusy(id); setError('');
    const res = await callsApi.remove(id);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not delete the call.'); return; }
    await load();
  }

  const canManage = promoter?.canManage ?? false;
  const shown = calls ? visibleCalls(calls, showArchived) : null;
  const archivedCount = calls ? calls.length - visibleCalls(calls, false).length : 0;

  return (
    <div data-testid="calls-list">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Calls</h1>
          <p className="text-xs text-gray-500">{promoter ? `Programmes, competitions and funding opportunities run by ${promoter.name}.` : 'Programmes, competitions and funding opportunities.'}</p>
        </div>
        {canManage && (
          <details className="relative" data-testid="new-call-menu">
            <summary aria-disabled={busy === 'new'} data-testid="new-call"
              className="cursor-pointer list-none rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b]">
              {busy === 'new' ? 'Creating…' : '+ New call'}
            </summary>
            <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-gray-200 bg-white py-1 shadow-md">
              <button type="button" disabled={busy === 'new'} onClick={() => void create(false)} className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" data-testid="new-call-manual">
                Create manually<span className="block text-[11px] text-gray-400">Start with an empty call</span></button>
              <button type="button" disabled={busy === 'new'} onClick={(e) => { setPicking(true); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }} className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" data-testid="new-call-duplicate">
                Duplicate a call<span className="block text-[11px] text-gray-400">Copy the configuration, form, phases and team</span></button>
              <button type="button" disabled={busy === 'new'} onClick={() => void create(true)} className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50" data-testid="new-call-import">
                Import from documents<span className="block text-[11px] text-gray-400">Propose a draft from your regulation or form</span></button>
            </div>
          </details>
        )}
      </div>
      {picking && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4" data-testid="duplicate-picker">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Which call do you want to duplicate?</p>
            <button type="button" onClick={() => setPicking(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
          </div>
          {(calls ?? []).filter((c) => c.canConfigure).length === 0 ? <p className="mt-2 text-xs text-gray-400">There is no call you can duplicate yet.</p> : (
            <ul className="mt-2 divide-y divide-gray-100 text-sm">
              {(calls ?? []).filter((c) => c.canConfigure).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>{c.name} <span className="text-xs text-gray-400">· {c.effectiveStatus}</span></span>
                  <button type="button" disabled={busy === c.id} onClick={() => void duplicateAndOpen(c.id)} className="text-xs font-semibold text-[#0E7490] hover:underline disabled:opacity-40" data-testid={`pick-${c.id}`}>{busy === c.id ? 'Duplicating…' : 'Duplicate'}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{error}</p>}
      {archivedCount > 0 || showArchived ? (
        <label className="mb-3 flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} data-testid="show-archived" />
          Show archived{!showArchived && archivedCount > 0 ? ` (${archivedCount})` : ''}
        </label>
      ) : null}
      {shown === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center" data-testid="calls-empty">
          <p className="text-sm font-medium text-gray-700">No calls yet</p>
          <p className="mt-1 text-xs text-gray-400">{canManage ? 'Create your first call: set it up, build its form, preview it and publish a link.' : 'Calls created by your organisation will appear here.'}</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-col rounded-lg border border-gray-200 bg-white p-4" data-testid="call-card">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpen(c.id)} className="min-w-0 text-left">
                  <h2 className="truncate text-sm font-semibold text-gray-900 hover:text-[#0E7490]">{c.name}</h2>
                </button>
                <StatusBadge status={c.effectiveStatus} />
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-gray-400">Opens</dt><dd className="text-gray-700">{formatInZone(c.opensAt, c.timezone)}</dd>
                <dt className="text-gray-400">Closes</dt><dd className="text-gray-700">{formatInZone(c.closesAt, c.timezone)}</dd>
              </dl>
              <p className="mt-3 text-xs text-gray-500">
                <b className="text-gray-800">{c.applications}</b> application{c.applications === 1 ? '' : 's'} · {c.fields} field{c.fields === 1 ? '' : 's'} · {c.phases} phase{c.phases === 1 ? '' : 's'}
              </p>
              <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-3 text-xs">
                <button type="button" onClick={() => onOpen(c.id)} className="font-semibold text-[#0E7490] hover:underline">{canManage ? 'Open' : 'View'}</button>
                {hasMenu(callMenu(c, c.canConfigure)) && (
                  <details className="relative ml-auto" data-testid="call-menu">
                    <summary aria-label={`More actions for ${c.name}`} className="cursor-pointer list-none rounded px-2 py-0.5 text-base leading-none text-gray-500 hover:bg-gray-100">⋯</summary>
                    <div className="absolute right-0 z-10 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-md">
                      {callMenu(c, c.canConfigure).duplicate && (
                        <button type="button" onClick={() => void duplicate(c.id)} disabled={busy === c.id} className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40" data-testid="duplicate-call">
                          {busy === c.id ? 'Duplicating…' : 'Duplicate'}
                        </button>
                      )}
                      {callMenu(c, c.canConfigure).archive && (
                        <button type="button" onClick={() => void archive(c.id)} disabled={busy === c.id} className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40" data-testid="archive-call-menu">Archive call</button>
                      )}
                      {callMenu(c, c.canConfigure).delete && (
                        <button type="button" onClick={() => void remove(c.id)} disabled={busy === c.id} className="block w-full px-3 py-1.5 text-left text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40" data-testid="delete-call-menu">Delete call</button>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
