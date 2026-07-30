'use client';
// Prompt 66 — Form Assist. Modal opened from the entity Approach card when
// the official channel is a web form. Generates a ready-to-copy answer
// pack (Option A, with the optional paste-the-real-questions refinement
// folded in) — never touches the third-party form itself.
import { useState } from 'react';
import { buildFormAssistContext } from '@/lib/form-assist';
import type { Db } from '@/lib/types';

interface Answer { label: string; answer: string; confidence: number; rationale: string }

export function FormAssistModal({ db, entityId, onClose }: { db: Db; entityId: string; onClose: () => void }) {
  const [pastedQuestions, setPastedQuestions] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  async function generate() {
    setBusy(true); setErr(''); setAnswers(null);
    try {
      const context = buildFormAssistContext(db, entityId);
      const res = await fetch('/api/form-assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, pastedQuestions: pastedQuestions.trim() || undefined }),
      });
      const body = await res.json();
      if (body.error) { setErr(body.error); return; }
      if (body.configured === false) { setErr(body.message); return; }
      setAnswers(body.answers);
    } catch {
      setErr('Failed to generate answers — try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex((cur) => cur === i ? null : cur), 1500);
    } catch { /* clipboard permission denied — silently no-op, the text is still selectable */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Form answers pack</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Draft answers to copy into the real form. We never submit or touch the third-party form itself.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {!answers && (
          <div className="space-y-3">
            <label className="block text-sm text-gray-600">
              Paste the form&apos;s own questions here (optional) — leave blank for generic sections.
              <textarea value={pastedQuestions} onChange={(e) => setPastedQuestions(e.target.value)} rows={5}
                placeholder="e.g.&#10;What problem are you solving?&#10;How much are you raising and why?"
                className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm" />
            </label>
            {err && <p className="text-sm text-[#B00000]">{err}</p>}
            <button disabled={busy} onClick={generate}
              className="rounded-lg bg-[#0E7490] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              {busy ? 'Generating…' : '✨ Generate answers'}
            </button>
          </div>
        )}

        {answers && (
          <div className="space-y-3">
            <div className="space-y-3">
              {answers.map((a, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-3">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{a.label}</p>
                    <button onClick={() => copy(i, a.answer)}
                      className="shrink-0 rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                      {copiedIndex === i ? 'Copied ✓' : 'Copy'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-gray-800">{a.answer}</p>
                  {a.confidence < 0.6 && (
                    <p className="mt-1.5 text-xs text-amber-700">⚠ {a.rationale}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setAnswers(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                ↻ Regenerate
              </button>
              <button onClick={onClose} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
