'use client';
// Prompt 924 (Etapa 4, I2) — the result of an application, as its applicant reads it: above their submitted application, once the entity has published. Nothing is shown (not even a hint) before that.
// What is here is the text that was built when the results went out: the label, the message, and the validated grade if the call shares it.
import { useEffect, useState } from 'react';
import { RichText } from '@/components/RichText';
import { applicantApi, type ResultBody } from '@/lib/calls/applicant/client';

export function ApplicantResult({ applicationId, timezone }: { applicationId: string; timezone?: string }) {
  const [result, setResult] = useState<ResultBody['result']>(null);
  useEffect(() => {
    let alive = true;
    void applicantApi.result(applicationId).then((r) => { if (alive && r.ok) setResult(r.body.result); });
    return () => { alive = false; };
  }, [applicationId]);
  if (!result) return null;
  const when = new Date(result.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone });
  const tone = result.kind === 'advance' ? 'border-emerald-200 bg-emerald-50' : result.kind === 'waitlist' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
  return (
    <section className={`mb-5 min-w-0 rounded-xl border p-4 ${tone}`} data-testid="applicant-result" data-kind={result.kind} aria-label="Your result">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Your result · {when}</p>
      <h2 className="mt-1 min-w-0 text-lg font-semibold text-gray-900 [overflow-wrap:anywhere]" data-testid="result-label">{result.label}</h2>
      <RichText value={result.html} className="mt-2 text-sm text-gray-800" testId="result-message" />
    </section>
  );
}
