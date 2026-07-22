'use client';
// Settings — org, plan (demo toggle), caps, AI Review (paid), demo reset
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';

export default function SettingsPage() {
  const { db, resetDemo } = useStore();
  const [draft, setDraft] = useState('');
  const [personId, setPersonId] = useState('');
  const [aiResult, setAiResult] = useState<string>('');
  const [aiLoading, setAiLoading] = useState(false);

  async function reviewMessage() {
    setAiLoading(true); setAiResult('');
    const person = db.people.find((p) => p.id === personId);
    const entity = person && db.entities.find((e) => e.id === person.entity_id);
    try {
      const res = await fetch('/api/ai-review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'message_review', draft,
          context: person && entity ? {
            person: person.full_name, role: person.role, hook: person.hook,
            kill_words: person.kill_words, watch_outs: person.watch_outs,
            entity: entity.name, thesis: entity.thesis, the_ask: entity.the_ask,
          } : undefined,
        }),
      });
      const data = await res.json();
      setAiResult(data.review ?? data.error ?? 'No response');
    } catch (e) {
      setAiResult(`Error: ${(e as Error).message}`);
    } finally { setAiLoading(false); }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Settings</h1>

      <Card title="Organisation">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-gray-500">Org</dt><dd>{db.org.name}</dd></div>
          <div><dt className="text-xs text-gray-500">Plan</dt><dd className="capitalize">{db.org.plan}</dd></div>
          <div><dt className="text-xs text-gray-500">Sender</dt><dd>{db.org.sender_email}</dd></div>
          <div><dt className="text-xs text-gray-500">BCC (reply record)</dt><dd>{db.org.bcc_email}</dd></div>
          <div><dt className="text-xs text-gray-500">Daily cap</dt><dd>{db.org.daily_cap} outbounds</dd></div>
          <div><dt className="text-xs text-gray-500">Weekly cap</dt><dd>{db.org.weekly_cap} outbounds</dd></div>
        </dl>
        <p className="mt-2 text-xs text-gray-400">
          In production these live on the org record (Supabase) and billing is handled by Stripe.
          Caps are strategic, not technical — a €1.3M seed closes on 15–40 conversations.
        </p>
      </Card>

      <Card title="AI Review — second opinion on a draft (paid feature)">
        <p className="mb-2 text-xs text-gray-500">
          Beyond the mechanical linter: tone, hook strength, investor fit — using the IRM context (thesis, kill words,
          watch-outs) as grounding. Requires <code className="rounded bg-gray-100 px-1">ANTHROPIC_API_KEY</code> in the environment.
          The AI never sends anything and never edits your data — it produces a report; acting on it is yours.
        </p>
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} className="mb-2 rounded border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Reviewing for… (person)</option>
          {db.people.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {db.entities.find((e) => e.id === p.entity_id)?.name}</option>)}
        </select>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5}
          placeholder="Paste the draft to review…" className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
        <button disabled={!draft || aiLoading} onClick={reviewMessage}
          className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
          {aiLoading ? 'Reviewing…' : 'Review with Claude'}
        </button>
        {aiResult && <pre className="mt-3 whitespace-pre-wrap rounded bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700">{aiResult}</pre>}
      </Card>

      <Card title="Deck / one-pager review & market data (paid)">
        <p className="text-sm text-gray-500">
          Submit a document from the Data Room for an AI report: per-dimension ranking (problem clarity, traction
          evidence, number credibility, narrative, design), issues with severity and location, and rewrite suggestions.
          Market-data enrichment researches an investor (thesis, typical cheques, recent deals) with cited sources,
          marked “AI-sourced — verify before relying”. Wire-up: <code className="rounded bg-gray-100 px-1">/api/ai-review</code> with
          kinds <code className="rounded bg-gray-100 px-1">deck_review</code> · <code className="rounded bg-gray-100 px-1">market_data</code>.
        </p>
      </Card>

      <Card title="Demo data">
        <button onClick={() => { if (window.confirm('Reset all demo data to the seeded pipeline?')) resetDemo(); }}
          className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-[#B00000] hover:bg-red-50">
          Reset demo to seed
        </button>
        <p className="mt-2 text-xs text-gray-400">Demo state persists in this browser (localStorage). Connecting Supabase replaces this with the real database.</p>
      </Card>
    </div>
  );
}
