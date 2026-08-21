'use client';
// Prompt 298 §1 — extracted from BlueprintPanel.tsx §3 (the one-at-a-time
// interrogation UI) so Review can reuse the EXACT same flow instead of a
// second, drifting copy. Reused by BlueprintPanel.tsx and ReviewPanel.tsx.
//
// Two paths always available side by side (Prompt 298 §2, explicit ask):
// Manual — the founder types or pastes something already researched — and
// AI-assisted, whose button text is explicit about which of two roles AI
// plays for THIS question: 'draft' (the platform might already know this —
// generates a candidate from accepted claims) or 'polish' (only the founder
// can know this — AI can improve their own wording, never invent the
// answer). The role comes from the server (/api/blueprint/gap-assist),
// never guessed client-side.
import { useState } from 'react';

const SEVERITY_STYLE: Record<string, string> = { critical: 'bg-red-100 text-red-800', high: 'bg-amber-100 text-amber-800', medium: 'bg-gray-100 text-gray-600' };

export interface GapView {
  rule: string; key: string; severity: string; message: string;
  prompt: { question: string; options: string[]; freeTextLabel: string };
  // Prompt 299 §2 — G7 spans several categories (unlike every other rule),
  // so its answer needs to carry the ORIGINAL claim's category through
  // rather than fall back to the answer route's one-category-per-rule map.
  meta?: Record<string, string>;
}

export function GapInterrogation({
  gap, remaining, busy, onSubmit,
}: {
  gap: GapView;
  remaining: number;
  busy: boolean;
  onSubmit: (opts: { option?: string; answer?: string; dismissed: boolean; category?: string }) => void | Promise<void>;
}) {
  const [option, setOption] = useState('');
  const [answer, setAnswer] = useState('');
  const [assisting, setAssisting] = useState(false);
  const [assistErr, setAssistErr] = useState('');
  const [assistRole, setAssistRole] = useState<'draft' | 'polish' | null>(null);

  async function assist() {
    setAssisting(true); setAssistErr('');
    try {
      const res = await fetch('/api/blueprint/gap-assist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gapKey: gap.key, currentAnswer: answer }),
      });
      const body = await res.json();
      if (!body.ok) { setAssistErr(body.error ?? 'AI assist failed.'); return; }
      setAssistRole(body.role);
      if (body.text) setAnswer(body.text);
      else if (body.message) setAssistErr(body.message);
    } catch { setAssistErr('AI assist failed.'); } finally { setAssisting(false); }
  }

  return (
    <div>
      <div className="flex items-start gap-2">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[gap.severity] ?? 'bg-gray-100 text-gray-600'}`}>
          {gap.severity}
        </span>
        <p className="text-sm font-medium text-gray-900">{gap.prompt.question}</p>
      </div>
      <p className="mt-1 text-xs text-gray-500">{gap.message}</p>

      {gap.prompt.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {gap.prompt.options.map((o) => (
            <button key={o} onClick={() => setOption(o === option ? '' : o)}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                o === option ? 'border-[#0E7490] bg-[#E8F4F8] text-[#0E7490]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
              {o}
            </button>
          ))}
        </div>
      )}

      <textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setAssistRole(null); }} rows={2}
        placeholder={gap.prompt.freeTextLabel}
        className="mt-2 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={() => onSubmit({ option: option || undefined, answer: answer || undefined, dismissed: false, category: gap.meta?.category })}
          disabled={busy || (!option && !answer.trim())}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          Save answer
        </button>
        <button onClick={() => onSubmit({ dismissed: true })} disabled={busy}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          Skip this one
        </button>
        <button onClick={assist} disabled={assisting || busy}
          className="rounded-lg border border-[#0E7490] px-3 py-1.5 text-xs font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">
          {assisting ? 'Thinking…' : answer.trim() ? 'AI: polish my wording' : 'AI: draft from what we already know'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-gray-400">
        {assistRole === 'polish' && 'AI improved your own wording — no new facts were added.'}
        {assistRole === 'draft' && 'AI drafted this from your already-confirmed facts — check it before saving.'}
        {!assistRole && 'Your answer becomes a claim in your own words. Its strength is measured from what you write — never chosen.'}
      </p>
      {assistErr && <p className="mt-1 text-[11px] text-amber-700">{assistErr}</p>}
      {remaining > 1 && <p className="mt-1 text-[11px] text-gray-400">{remaining - 1} more after this one.</p>}
    </div>
  );
}
