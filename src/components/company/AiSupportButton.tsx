'use client';
// Prompt 327 Pedidos E/F — one shared component for both call sites
// (Roadmap milestones, Round "Use of funds"). Never auto-applies a
// suggestion: the founder reviews each one and clicks to use it, same
// discipline as RoadmapCard.tsx's own pastRound hint.
import { useState } from 'react';
import Link from 'next/link';

export function AiSupportButton({ kind, onUse }: { kind: 'roadmap' | 'use_of_funds'; onUse: (suggestion: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [message, setMessage] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState('');

  function ask() {
    setOpen(true); setLoading(true); setError(''); setSuggestions([]);
    fetch('/api/company/ai-support', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }),
    }).then((r) => r.json()).then((b) => {
      if (!b.ok) { setError(b.error ?? 'Could not get suggestions.'); setAvailable(null); return; }
      setAvailable(b.available);
      if (!b.available) setMessage(b.message);
      else setSuggestions(b.suggestions ?? []);
    }).catch(() => setError('Could not get suggestions.')).finally(() => setLoading(false));
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={ask}
        className="rounded-full border border-cyan-300 px-2.5 py-1 text-[11px] font-semibold text-[#0E7490] hover:bg-cyan-50">
        ✨ AI support
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1.5 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-700">AI suggestions</span>
            <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
          </div>
          {loading && <p className="text-xs text-gray-400">Thinking…</p>}
          {!loading && error && <p className="text-xs text-[#B00000]">{error}</p>}
          {!loading && !error && available === false && (
            <p className="text-xs text-gray-500">
              {message} <Link href="/readiness" className="font-medium text-[#0E7490] underline">Go to Readiness &amp; Train</Link>
            </p>
          )}
          {!loading && !error && available === true && (
            suggestions.length === 0 ? (
              <p className="text-xs text-gray-400">Nothing concrete enough to suggest yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {suggestions.map((s, i) => (
                  <li key={i} className="rounded-lg border border-gray-100 p-2 text-xs text-gray-700">
                    {s}
                    <button onClick={() => { onUse(s); setOpen(false); }}
                      className="mt-1 block text-[11px] font-semibold text-[#0E7490] hover:underline">
                      Use this
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      )}
    </div>
  );
}
