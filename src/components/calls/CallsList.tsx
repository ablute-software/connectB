'use client';
// Prompt 905 — Calls, the list of an organisation's calls as cards (the visual language of the pipelines): name,
// state (colour AND label), dates with their time zone, number of applications (0 until Prompt 906), and what is in
// the form. "New call" and "Duplicate" for those who manage calls; a duplicate never copies applications.
import { useCallback, useEffect, useState } from 'react';
import type { PromoterKind } from '@/lib/calls/types';
import { formatInZone } from '@/lib/calls/tz';
import { callsApi, type CallListItem, type PromoterInfo } from './api';
import { StatusBadge } from './StatusBadge';

export function CallsList({ kind, onOpen }: { kind: PromoterKind; onOpen: (id: string) => void }) {
  const [promoter, setPromoter] = useState<PromoterInfo | null>(null);
  const [calls, setCalls] = useState<CallListItem[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await callsApi.list(kind);
    if (!res.ok) { setError(res.body.error ?? 'Could not load your calls.'); setCalls([]); return; }
    setError(''); setPromoter(res.body.promoter); setCalls(res.body.calls);
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy('new'); setError('');
    const res = await callsApi.create(kind);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not create the call.'); return; }
    onOpen(res.body.call.id);
  }
  async function duplicate(id: string) {
    setBusy(id); setError('');
    const res = await callsApi.duplicate(id);
    setBusy(null);
    if (!res.ok) { setError(res.body.error ?? 'Could not duplicate the call.'); return; }
    await load();
  }

  const canManage = promoter?.canManage ?? false;

  return (
    <div data-testid="calls-list">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Calls</h1>
          <p className="text-xs text-gray-500">{promoter ? `Programmes, competitions and funding opportunities run by ${promoter.name}.` : 'Programmes, competitions and funding opportunities.'}</p>
        </div>
        {canManage && (
          <button type="button" onClick={create} disabled={busy === 'new'} data-testid="new-call"
            className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-50">
            {busy === 'new' ? 'Creating…' : '+ New call'}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-[#B00000]">{error}</p>}
      {calls === null ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : calls.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center" data-testid="calls-empty">
          <p className="text-sm font-medium text-gray-700">No calls yet</p>
          <p className="mt-1 text-xs text-gray-400">{canManage ? 'Create your first call: set it up, build its form, preview it and publish a link.' : 'Calls created by your organisation will appear here.'}</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {calls.map((c) => (
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
                {canManage && (
                  <button type="button" onClick={() => void duplicate(c.id)} disabled={busy === c.id} className="text-gray-500 hover:text-[#0E7490] disabled:opacity-40" data-testid="duplicate-call">
                    {busy === c.id ? 'Duplicating…' : 'Duplicate'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
