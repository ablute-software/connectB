'use client';
// Prompt 907 (I4) — "Submissions", read-only, in the editor of a call (spec §14.4, §20): the SUBMITTED applications — startup, reference, when —
// and, for each, the version exactly as it was submitted (answers, documents, the form as it was). Drafts never appear here, not even as a count:
// the entity sees only what was submitted. Evaluation, eligibility and distribution come in later stages.
import { useEffect, useState } from 'react';
import { formatInZone } from '@/lib/calls/tz';
import { formatNumberDisplay, visiblePages } from '@/lib/calls/form-logic';
import type { Answers, AnswerValue, FormField } from '@/lib/calls/types';

interface Item { applicationId: string; reference: string | null; startup: string; submittedAt: string }
interface Detail {
  reference: string | null; startup: string; submittedAt: string; version: number; fields: FormField[]; answers: Answers;
  documents: { fileId: string; fieldId: string; fileName: string; size: number; source: string; versionNumber: number | null; url: string }[];
}

const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** An answer as text, for reading (option labels, not ids). Pure; the tests read it. */
export function answerText(field: FormField, value: AnswerValue, currency: string): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map((id) => field.options.find((o) => o.id === id)?.label ?? id).join(', ') || '—';
  if (typeof value === 'object') return value.fileName;
  if (field.kind === 'yes_no' || field.kind === 'single_choice') return field.options.find((o) => o.id === value)?.label ?? value;
  if (field.kind === 'number') return formatNumberDisplay(value, field.validations.currency ? currency : null);
  return value;
}

export function SubmissionsTab({ callId, timezone, currency }: { callId: string; timezone: string; currency: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Detail | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/calls/${callId}/submissions`, { cache: 'no-store' }).then(async (r) => {
      const d = await r.json().catch(() => null);
      if (!alive) return;
      if (r.ok && d?.ok) setItems(d.submissions); else { setItems([]); setError(d?.error ?? 'You cannot view the submissions of this call.'); }
    }).catch(() => { if (alive) { setItems([]); setError('We could not load the submissions.'); } });
    return () => { alive = false; };
  }, [callId]);

  async function show(id: string) {
    setError('');
    const r = await fetch(`/api/calls/${callId}/submissions/${id}`, { cache: 'no-store' });
    const d = await r.json().catch(() => null);
    if (!r.ok || !d?.ok) { setError('We could not open that application.'); return; }
    setOpen(d as Detail);
  }

  if (open) {
    const pages = visiblePages(open.fields, open.answers);
    return (
      <section data-testid="submission-detail">
        <button type="button" onClick={() => setOpen(null)} className="text-sm text-gray-500 hover:text-[#0E7490]">← Submissions</button>
        <h2 className="mt-2 text-base font-semibold text-gray-900">{open.startup} <span className="font-mono text-xs font-normal text-gray-500">{open.reference}</span></h2>
        <p className="text-xs text-gray-500">Submitted {formatInZone(open.submittedAt, timezone)} · version {open.version} · read-only: exactly as it was submitted</p>
        <div className="mt-4 space-y-6">
          {pages.map((p, i) => (
            <div key={p.page}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Page {i + 1}</h3>
              <dl className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {p.fields.map((f) => {
                  const doc = open.documents.find((d) => d.fieldId === f.id);
                  return (
                    <div key={f.id} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[14rem_1fr]">
                      <dt className="text-sm text-gray-500">{f.label}</dt>
                      <dd className="whitespace-pre-line text-sm text-gray-900" data-testid="answer">
                        {f.kind === 'file' && doc
                          ? <a href={doc.url} className="font-medium text-[#0E7490] hover:underline" target="_blank" rel="noreferrer">{doc.fileName}</a>
                          : answerText(f, open.answers[f.id], currency)}
                        {doc && <span className="ml-2 text-xs text-gray-400">{sizeText(doc.size)}{doc.source === 'vault' ? ` · from the Vault (v${doc.versionNumber ?? 1})` : ''}</span>}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section data-testid="submissions-tab">
      <h2 className="text-base font-semibold text-gray-900">Submissions</h2>
      <p className="mt-1 text-xs text-gray-500">Applications that were submitted, read-only. Applications still being filled in are never shown to the organisation that runs the call.</p>
      {error && <p role="alert" className="mt-3 text-sm text-[#B00000]">{error}</p>}
      {items === null ? <p className="mt-4 text-sm text-gray-400">Loading…</p> : items.length === 0 && !error ? (
        <p className="mt-4 text-sm text-gray-500" data-testid="no-submissions">No applications have been submitted yet.</p>
      ) : items.length > 0 ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-2 font-medium">Startup</th><th className="px-4 py-2 font-medium">Reference</th><th className="px-4 py-2 font-medium">Submitted</th><th /></tr></thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.applicationId} className="border-t border-gray-100" data-testid="submission-row">
                  <td className="px-4 py-2 font-medium text-gray-900">{s.startup}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{s.reference ?? '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{formatInZone(s.submittedAt, timezone)}</td>
                  <td className="px-4 py-2 text-right"><button type="button" onClick={() => void show(s.applicationId)} className="text-xs font-semibold text-[#0E7490] hover:underline">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
