'use client';
// Prompt 908 — back-office "Calls": every call of every investor firm and ecosystem organisation, read only.
// The list, its filters and the expanded detail live in BackofficeCallsTable; this page fetches and frames it.
import { useEffect, useState } from 'react';
import { BackofficeCallsTable } from '@/components/backoffice/BackofficeCallsPanel';
import { ImportCorrectionsPanel } from '@/components/backoffice/ImportCorrectionsPanel';
import type { BackofficeCallRow } from '@/lib/calls/backoffice-view';

export default function BackofficeCallsPage() {
  const [rows, setRows] = useState<BackofficeCallRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/calls').then((r) => r.json()).then((d) => {
      if (!d.ok) { setError(d.error ?? 'Could not load the calls.'); setRows([]); return; }
      setRows(d.rows as BackofficeCallRow[]);
    }).catch(() => { setError('Could not load the calls.'); setRows([]); });
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calls</h1>
        <p className="mt-1 text-xs text-gray-500">
          Every call created by an investor firm or an ecosystem organisation. Read only: applications appear as numbers, never their content.
        </p>
      </div>
      <ImportCorrectionsPanel />
      {error && <p role="alert" className="text-xs text-[#B00000]">{error}</p>}
      {rows === null ? <p className="text-xs text-gray-400">Loading…</p> : (
        <BackofficeCallsTable rows={rows} origin={typeof window !== 'undefined' ? window.location.origin : ''} />
      )}
    </div>
  );
}
