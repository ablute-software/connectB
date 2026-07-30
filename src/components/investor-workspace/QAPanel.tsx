'use client';
// Investor Workspace Fase 3 (prompt 56), Bloco 1 — investor-side Q&A: ask a
// question, see your own thread plus every FAQ the founder has promoted.
import { useEffect, useState } from 'react';

interface Question { id: string; question: string; answer: string | null; is_faq: boolean; created_at: string; asked_by_email: string }

export function QAPanel({ orgId }: { orgId: string }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  function load() {
    fetch(`/api/portal/questions?org_id=${orgId}`).then((r) => r.json()).then((d) => setQuestions(d.questions ?? []));
  }
  useEffect(load, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await fetch('/api/portal/questions', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, question: draft.trim() }),
      });
      setDraft('');
      load();
    } finally { setSending(false); }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">Questions</h2>
      <div className="mt-2 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask the founder anything…"
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
        <button onClick={ask} disabled={sending || !draft.trim()}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {sending ? 'Sending…' : 'Ask'}
        </button>
      </div>
      {questions && questions.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {questions.map((q) => (
            <div key={q.id} className="rounded-lg border border-gray-100 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                {q.question}
                {q.is_faq && <span className="rounded-full bg-[#E8F4F8] px-1.5 py-0.5 text-[10px] font-semibold text-[#0E7490]">FAQ</span>}
              </div>
              {q.answer ? (
                <p className="mt-1 text-xs text-gray-600">{q.answer}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Awaiting answer…</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
