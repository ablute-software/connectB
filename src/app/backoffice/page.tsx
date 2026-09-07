'use client';
// Prompt 576 Fase 2 — replaces "Today". Every row here is a summary that
// links to where the actual decision happens (a Queue tab, Support, or the
// System list) — this page never resolves anything itself. Confirmed before
// removing Today's inline Approve/Reject buttons: GdprTab/SubmissionsTab/
// ClaimsTab on the Queue already call the exact same resolve/review
// endpoints those buttons did, so nothing here is a dead end.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';

interface AttentionRow {
  tag: string; title: string; context: string; ageLabel: string;
  href: string; buttonLabel: string; urgent?: boolean;
}
interface AttentionData { rows: AttentionRow[]; allClear: string[] }

export default function BackofficeAttentionPage() {
  const [data, setData] = useState<AttentionData | null>(null);
  const [err, setErr] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/backoffice/attention').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body);
    });
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Attention</h1>
        <p className="mt-0.5 text-sm text-gray-500">Everything that needs a decision, most urgent and oldest first. Resolve on the Queue, Support or System — this is the index, not the form.</p>
      </div>

      {data.allClear.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">All clear:</span>
          {data.allClear.map((tag) => (
            <span key={tag} className="flex items-center gap-1.5">
              <span className="text-green-600">✓</span> {tag}
            </span>
          ))}
        </div>
      )}

      {data.rows.length === 0 && <Card><p className="text-sm text-gray-400">Nothing needs attention right now.</p></Card>}

      <div className="space-y-2.5">
        {data.rows.map((r, i) => (
          <div key={i} className={`flex items-center gap-4 rounded-xl border bg-white px-4 py-3.5 ${r.urgent ? 'border-red-200' : 'border-gray-100'}`}>
            <span className={`flex-none rounded px-2 py-1 text-[10.5px] font-bold uppercase tracking-wide ${r.urgent ? 'bg-red-50 text-[#B00000]' : 'bg-[#E8F4F8] text-[#0E7490]'}`}>
              {r.tag}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900">{r.title}</div>
              <div className="truncate text-xs text-gray-400">{r.context}</div>
            </div>
            <span className={`flex-none text-xs ${r.urgent ? 'font-semibold text-[#B00000]' : 'text-gray-400'}`}>{r.ageLabel}</span>
            <button onClick={() => router.push(r.href)}
              className="flex-none rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800">
              {r.buttonLabel}
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">Counts reflect what&apos;s pending right now, not lifetime totals — refreshed on every load.</p>
    </div>
  );
}
