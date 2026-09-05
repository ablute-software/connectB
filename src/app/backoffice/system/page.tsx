'use client';
// Prompt 576 Fase 2 §7 — one format for every health signal: a status dot,
// its name, a one-line real detail (never just "ok"), and when it was
// checked. Each row links to its own existing detail page for anyone who
// wants more than the one-line summary. The checks themselves live in
// src/lib/system-status.ts, shared with /api/backoffice/system-status and
// with Attention's non-ok rows — this page never redefines them.
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SystemSignal { key: string; name: string; ok: boolean | null; detail: string; checkedAt: string }

const DETAIL_HREF: Record<string, string> = {
  email: '/backoffice/email-delivery',
  gap_engine: '/backoffice/gap-engine-health',
  ai_costs: '/backoffice/costs',
  scan_health: '/backoffice/scan-health',
};

function checkedAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 30) return 'checked just now';
  if (seconds < 60) return `checked ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `checked ${minutes}m ago`;
  return `checked ${Math.floor(minutes / 60)}h ago`;
}

export default function BackofficeSystemPage() {
  const [signals, setSignals] = useState<SystemSignal[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/system-status').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setSignals(body.signals);
    }).catch(() => setErr('not available'));
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">System</h1>
        <p className="mt-0.5 text-sm text-gray-500">Signals that only matter when they stop being nominal. Silent by default — a red dot here is what puts a row on Attention.</p>
      </div>

      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!signals && !err && <p className="text-sm text-gray-400">Loading…</p>}

      {signals && (
        <div className="space-y-2.5">
          {signals.map((s) => (
            <Link key={s.key} href={DETAIL_HREF[s.key] ?? '#'}
              className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-3.5 transition hover:border-gray-200">
              <span className={`h-[9px] w-[9px] flex-none rounded-full ${s.ok === false ? 'bg-red-500' : s.ok === null ? 'bg-gray-300' : 'bg-green-500'}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900">{s.name}</div>
                <div className="truncate text-xs text-gray-500">{s.detail}</div>
              </div>
              <span className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                s.ok === false ? 'bg-red-50 text-[#B00000]' : s.ok === null ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'}`}>
                {s.ok === false ? 'Needs a look' : s.ok === null ? 'No baseline yet' : 'Nominal'}
              </span>
              <span className="flex-none font-mono text-[11px] text-gray-400">{checkedAgo(s.checkedAt)}</span>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-gray-400">The moment any dot turns red, that row — and only that row — moves onto Attention.</p>
    </div>
  );
}
