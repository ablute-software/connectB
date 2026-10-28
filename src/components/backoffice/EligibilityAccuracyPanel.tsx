'use client';
// Prompt 918 (I3) — back office, Calls: how the internal eligibility engine is doing, by kind of rule and by kind of document, from the corrections people made. A simple view (spec §7.6: the data is kept now;
// a richer analysis screen comes later). Read only.
import { useEffect, useState } from 'react';
import type { AccuracyRow } from '@/lib/calls/eligibility-review';

interface Data { available: boolean; byRule?: AccuracyRow[]; byDocument?: AccuracyRow[]; corrections?: { total: number; callExceptions: number; applicationLevel: number }; queue?: Record<string, number> }
const KIND: Record<string, string> = { options: 'Options', number: 'Number', date: 'Date', yes_no: 'Yes / No', doc_present: 'Document present', doc_right: 'Right document', doc_valid: 'Valid document', doc_authentic: 'Authentic document', open: 'Open answer' };

function Table({ rows, label, testId }: { rows: AccuracyRow[]; label: (k: string) => string; testId: string }) {
  if (rows.length === 0) return <p className="mt-1 text-xs text-gray-500">Nothing evaluated yet.</p>;
  return (
    <table className="mt-1 w-full table-fixed text-left text-xs" data-testid={testId}>
      <thead className="text-gray-500"><tr><th className="py-1 pr-2 font-medium">Kind</th><th className="py-1 pr-2 text-right font-medium">Decisions</th><th className="py-1 pr-2 text-right font-medium">Corrected</th><th className="py-1 text-right font-medium">Hit rate</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.key} className="border-t border-gray-100"><td className="break-words py-1 pr-2 text-gray-800">{label(r.key)}</td><td className="py-1 pr-2 text-right">{r.decisions}</td><td className="py-1 pr-2 text-right">{r.corrected}</td><td className="py-1 text-right font-semibold">{r.accuracy == null ? '—' : `${r.accuracy}%`}</td></tr>
      ))}</tbody>
    </table>
  );
}

export function EligibilityAccuracyPanel() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/backoffice/calls-eligibility-accuracy', { cache: 'no-store' }).then((r) => r.json()).then((x) => { if (alive) setD(x?.ok ? x : { available: false }); }).catch(() => { if (alive) setD({ available: false }); });
    return () => { alive = false; };
  }, []);
  if (!d || !d.available || !d.byRule || !d.byDocument) return null;
  const q = d.queue ?? {};
  return (
    <section className="min-w-0 rounded-lg border border-gray-200 bg-white p-4" data-testid="eligibility-accuracy" aria-label="Eligibility engine">
      <h2 className="text-sm font-semibold text-gray-900">Eligibility engine</h2>
      <p className="mt-0.5 text-xs text-gray-500">How the platform&apos;s own checks do, from what people corrected. An exception of one call is not counted as a mistake of the engine. It uses no external AI: it has no cost per application.</p>
      <p className="mt-2 text-xs text-gray-700" data-testid="eligibility-queue">Queue: {q.queued ?? 0} waiting · {q.processing ?? 0} running · {q.done ?? 0} done · <b className={q.technical_failure ? 'text-[#B00000]' : ''}>{q.technical_failure ?? 0} technical failures</b>. Corrections: {d.corrections?.total ?? 0} ({d.corrections?.callExceptions ?? 0} exceptions of a call, {d.corrections?.applicationLevel ?? 0} on a whole application).</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">By kind of rule</p><Table rows={d.byRule} label={(k) => KIND[k] ?? k} testId="accuracy-by-rule" /></div>
        <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">By kind of document</p><Table rows={d.byDocument} label={(k) => k.replace(/_/g, ' ')} testId="accuracy-by-document" /></div>
      </div>
    </section>
  );
}
