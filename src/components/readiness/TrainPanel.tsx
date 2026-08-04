'use client';
// Prompt 99 §4 — "Train": the app asks 6-8 investor-style questions (fixed
// bank + derived from the latest review's weaknesses/risks/recommendations
// — source 3, real portal_questions, is prepared-not-built per §4.3), one
// at a time, then grades the session. Always a report, never an automated
// action — same spirit as the rest of this page.
//
// Prompt 115 Block B — moved and renamed from this file's original
// dashboard/ location and Portuguese component name, as part of promoting
// this whole feature out of Dashboard into its own "Readiness & Train" nav
// tab, and closing a Prompt 108 naming debt: no PT/EN hybrid names left in
// this feature.
//
// Prompt 115 Block F — question bank grew from 7 to 24 (3 per real
// interview category) with a genuinely non-repeating, session-count-indexed
// rotation (lib/train-questions.ts — unit-tested there, not reimplemented
// here); added a third 'diligence' source built from the latest review's
// recommendations (ai_reviews only, never access_grants/interactions); and
// the entry gate loosened — fixed questions work from minute 1, only the
// derived/diligence portions need a prior Review to draw from.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import { buildSession, type Question, type Finding } from '@/lib/train-questions';

interface CoachingRun {
  id: string; created_at: string;
  questions: Question[]; answers: string[];
  feedback: { per_question: { note: string }[]; strengths_to_keep: string[]; top_adjustments: string[] };
}
interface StructuredResult { weaknesses?: Finding[]; risks?: Finding[]; recommendations?: Finding[] }

export function TrainPanel() {
  const { db } = useStore();
  const [loaded, setLoaded] = useState(false);
  const [latestWeaknessesAndRisks, setLatestWeaknessesAndRisks] = useState<Finding[]>([]);
  const [latestRecommendations, setLatestRecommendations] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<CoachingRun[]>([]);

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<CoachingRun | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!authEnabled || !db.org.id) { setLoaded(true); return; }
    Promise.all([
      browserClient().from('ai_reviews').select('id, kind, result, created_at')
        .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(1),
      browserClient().from('coaching_runs').select('id, questions, answers, feedback, created_at')
        .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(10),
    ]).then(([reviewRes, runsRes]) => {
      const rows = reviewRes.data as { result: StructuredResult | null }[] | null;
      const r = rows?.[0]?.result;
      setLatestWeaknessesAndRisks([...(r?.weaknesses ?? []), ...(r?.risks ?? [])]);
      setLatestRecommendations(r?.recommendations ?? []);
      setRuns((runsRes.data as CoachingRun[] | null) ?? []);
      setLoaded(true);
    });
  }, [db.org.id]);

  function startSession() {
    // `runs` is ordered most-recent-first, so the first 2 entries are
    // exactly the "last 2 sessions" — combined with the one about to be
    // built, that's the 3-session non-repeat window the rotation targets.
    const recentTexts = new Set(runs.slice(0, 2).flatMap((r) => r.questions.map((q) => q.text)));
    const qs = buildSession(runs.length, latestWeaknessesAndRisks, latestRecommendations, recentTexts);
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

  if (!loaded) return <p className="text-sm text-gray-400">Loading…</p>;
  const hasReviewMaterial = latestWeaknessesAndRisks.length > 0 || latestRecommendations.length > 0;

  return (
    <Card title="Train — investor Q&A practice">
      <p className="mb-2 text-xs text-gray-500">
        {hasReviewMaterial
          ? '8 questions, one at a time — standard diligence questions plus some pulled directly from what your latest review flagged. At the end: a short note per answer and the 2-3 adjustments that matter most.'
          : '8 standard diligence questions, one at a time. Run a review in the Review tab first and future sessions will also pull questions from what it flags — but you don’t have to wait to start practicing.'}
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
