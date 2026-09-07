'use client';
// Prompt 375 §B — "never silent": a misconfigured scanner shows up here
// with a real, on-demand credential check, not a status that quietly
// degrades into something that LOOKS like a normal in-progress scan.
import { useEffect, useState } from 'react';

interface Health { configured: boolean; ok: boolean; detail: string }

export default function ScanHealthPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  // Prompt 599 §1 — "não apresenta nada": the check calls VirusTotal live
  // and can take seconds, and there was no loading state, so the page sat
  // header-only. It also fed the route's auth/not-configured shape
  // ({ok:false, error}) straight into setHealth, which then rendered as
  // "No key configured" with an undefined detail — the wrong message.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/backoffice/scan-health').then((r) => r.json()).then((body) => {
      if (body && body.ok === false && typeof body.error === 'string' && !('configured' in body)) { setErr(body.error); return; }
      setHealth(body);
    }).catch(() => setErr('Could not check.')).finally(() => setChecking(false));
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900">Malware scanner health</h1>
      <p className="mt-1 text-sm text-gray-500">
        This app never submits document content to VirusTotal (Prompt 375) — only a SHA-256 hash lookup, which works
        with or without a configured key. This checks whether the key, if set, actually authenticates.
      </p>

      {checking && <p className="mt-4 text-sm text-gray-400">Checking the scanner credential live…</p>}
      {err && <p className="mt-4 text-sm text-[#B00000]">{err}</p>}
      {health && (
        <div className={`mt-4 rounded-lg border p-4 ${health.ok ? 'border-emerald-200 bg-emerald-50' : health.configured ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
          <p className={`text-sm font-semibold ${health.ok ? 'text-emerald-800' : health.configured ? 'text-[#B00000]' : 'text-gray-600'}`}>
            {health.ok ? '✓ Scanner healthy' : health.configured ? '⚠ Scanner misconfigured' : 'No key configured (local-only mode)'}
          </p>
          <p className="mt-1 text-xs text-gray-600">{health.detail}</p>
        </div>
      )}
    </div>
  );
}
