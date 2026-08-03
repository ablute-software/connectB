'use client';
// Prompt 99 §4 — "Treinar": after at least one Optimizar review has run, the
// app asks 6-8 investor-style questions (fixed bank + derived from the
// latest review's weaknesses/risks — source 3, real portal_questions, is
// prepared-not-built per §4.3), one at a time, then grades the session.
// Always a report, never an automated action — same spirit as the rest of
// this page.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import type { CompanyFactCategory } from '@/lib/types';

interface Question { text: string; category: CompanyFactCategory; source: 'fixed' | 'derived' }
interface CoachingRun {
  id: string; created_at: string;
  questions: Question[]; answers: string[];
  feedback: { per_question: { note: string }[]; strengths_to_keep: string[]; top_adjustments: string[] };
}
interface Finding { text: string; category: CompanyFactCategory }
interface StructuredResult { weaknesses?: Finding[]; risks?: Finding[] }

const FIXED_BANK: Question[] = [
  { text: 'Walk me through why this specific team is the right one to solve this problem.', category: 'team', source: 'fixed' },
  { text: 'How big is this market really, and how do you know?', category: 'market', source: 'fixed' },
  { text: 'What is the strongest piece of proof you have that people actually want this?', category: 'traction', source: 'fixed' },
  { text: 'What are your unit economics, and how did you arrive at those numbers?', category: 'financing', source: 'fixed' },
  { text: 'What stops a larger incumbent from doing this next quarter?', category: 'positioning', source: 'fixed' },
  { text: 'Why this amount, and what does it specifically get you?', category: 'financing', source: 'fixed' },
  { text: 'What is your regulatory path, and what could block it — if applicable to your sector?', category: 'regulatory', source: 'fixed' },
];

export function TreinarPanel() {
  const { db } = useStore();
  const [hasAnyReview, setHasAnyReview] = useState<boolean | null>(null);
  const [latestFindings, setLatestFindings] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<CoachingRun[]>([]);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<CoachingRun | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!authEnabled || !db.org.id) { setHasAnyReview(false); return; }
    browserClient().from('ai_reviews').select('id, kind, result, created_at')
      .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        const rows = data as { result: StructuredResult | null }[] | null;
        setHasAnyReview(!!rows?.length);
        const r = rows?.[0]?.result;
        setLatestFindings([...(r?.weaknesses ?? []), ...(r?.risks ?? [])]);
      });
    browserClient().from('coaching_runs').select('id, questions, answers, feedback, created_at')
      .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setRuns((data as CoachingRun[] | null) ?? []));
  }, [db.org.id]);

  function startSession() {
    const derived: Question[] = latestFindings.slice(0, 4).map((f) => ({
      text: `An investor pushed back on this: "${f.text}" — how would you answer that, right now?`,
      category: f.category, source: 'derived',
    }));
    const fixed = FIXED_BANK.slice(0, Math.max(4, 7 - derived.length));
    const qs = [...fixed, ...derived].slice(0, 8);
    setQuestions(qs); setStep(0); setAnswers([]); setDraft(''); setResult(null); setErr('');
  }

  function nextQuestion() {
    if (!draft.trim() || !questions) return;
    const nextAnswers = [...answers, draft.trim()];
    setAnswers(nextAnswers); setDraft('');
    if (step + 1 < questions.length) { setStep(step + 1); return; }
    void submitSession(nextAnswers);
  }

  async function submitSession(finalAnswers: string[]) {
    if (!questions) return;
    setGrading(true); setErr('');
    try {
      const res = await fetch('/api/coaching/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qas: questions.map((q, i) => ({ question: q, answer: finalAnswers[i] })),
          context: { name: db.org.name, sector: db.org.sector, stage: db.org.stage, country: db.org.country, round_target_eur: db.org.round_target_eur },
        }),
      });
      const data = await res.json();
      if (!data.ok) { setErr(data.error ?? data.message ?? 'Failed'); return; }
      setResult(data.run); setRuns((prev) => [data.run, ...prev]); setQuestions(null);
    } catch (e) { setErr((e as Error).message); } finally { setGrading(false); }
  }

  if (hasAnyReview === null) return <p className="text-sm text-gray-400">Loading…</p>;
  if (!hasAnyReview) {
    return (
      <Card title="Treinar — investor Q&A practice">
        <p className="text-xs text-gray-500">
          Run at least one review in Optimizar first — Treinar uses its weaknesses/risks to build part of the session,
          otherwise the questions would be too generic to be useful.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Treinar — investor Q&A practice">
      <p className="mb-2 text-xs text-gray-500">
        6-8 questions, one at a time — some standard diligence questions, some pulled directly from what your latest
        review flagged as weak. At the end: a short note per answer and the 2-3 adjustments that matter most.
      </p>

      {!questions && !result && (
        <button onClick={startSession} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">
          Start session
        </button>
      )}

      {questions && (
        <div className="mt-2 rounded-lg border border-cyan-100 bg-cyan-50/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
            Question {step + 1} of {questions.length} · {questions[step].category}
          </p>
          <p className="mt-1 text-sm text-gray-800">{questions[step].text}</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4}
            placeholder="Answer as you would to an investor…" className="mt-2 w-full rounded border border-gray-300 p-2 text-sm" />
          <button disabled={!draft.trim() || grading} onClick={nextQuestion}
            className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {grading ? 'Grading session…' : step + 1 < questions.length ? 'Next question' : 'Finish & get feedback'}
          </button>
        </div>
      )}
      {err && (
        <div className="mt-2">
          <p className="text-xs text-[#B00000]">{err}</p>
          {questions && step + 1 === questions.length && answers.length === questions.length && (
            <button onClick={() => void submitSession(answers)} disabled={grading}
              className="mt-1 text-xs font-medium text-[#0E7490] hover:underline disabled:opacity-40">
              {grading ? 'Retrying…' : 'Retry — your answers were not lost'}
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="text-xs text-gray-400">{result.created_at.slice(0, 10)}</p>
          <div className="mt-2 space-y-2">
            {result.questions.map((q, i) => (
              <div key={i} className="border-b border-gray-100 pb-2 last:border-0">
                <p className="text-xs font-medium text-gray-500">{q.text}</p>
                <p className="text-xs text-gray-600 italic">"{result.answers[i]}"</p>
                <p className="mt-0.5 text-xs text-cyan-700">{result.feedback.per_question[i]?.note}</p>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Strengths to keep</p>
            <ul className="ml-4 list-disc text-xs text-gray-700">{result.feedback.strengths_to_keep.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div className="mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Top adjustments</p>
            <ul className="ml-4 list-disc text-xs text-gray-700">{result.feedback.top_adjustments.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <button onClick={startSession} className="mt-3 text-xs font-medium text-[#0E7490] hover:underline">Start another session</button>
        </div>
      )}

      {runs.length > (result ? 1 : 0) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-gray-400">History ({runs.length - (result ? 1 : 0)} earlier)</summary>
          <ul className="mt-1 space-y-1 text-xs text-gray-600">
            {runs.slice(result ? 1 : 0).map((r) => <li key={r.id}>{r.created_at.slice(0, 10)} — {r.questions.length} questions</li>)}
          </ul>
        </details>
      )}
    </Card>
  );
}
