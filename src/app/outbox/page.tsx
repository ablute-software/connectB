'use client';
// Outbox — approval queue for automation runs (draft_review mode)
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink, PersonLink } from '@/components/ui';
import { lintMessage } from '@/lib/rules';

export default function OutboxPage() {
  const { db, approveRun, rejectRun, updateRunDraft, runAutomationTick } = useStore();
  const [tickMsg, setTickMsg] = useState('');
  const pending = db.runs.filter((r) => r.status === 'pending_review');
  const recent = db.runs.filter((r) => r.status !== 'pending_review')
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Outbox — pending review ({pending.length})</h1>
        <button onClick={() => { const n = runAutomationTick(); setTickMsg(`Engine tick: ${n} new run(s)/task(s).`); }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
          Run engine tick now
        </button>
      </div>
      {tickMsg && <div className="rounded bg-[#E8F4F8] px-3 py-2 text-sm text-cyan-900">{tickMsg}</div>}
      <p className="text-xs text-gray-400">
        In production the engine runs on a schedule (Vercel cron → /api/automations) and full_auto runs execute
        without stopping here — but only when pre-flight is green. Anything blocked lands in this queue with the reason.
      </p>

      {pending.length === 0 ? (
        <Card><p className="text-sm text-gray-400">Nothing waiting for review.</p></Card>
      ) : pending.map((r) => {
        const auto = db.automations.find((a) => a.id === r.automation_id);
        const person = db.people.find((p) => p.id === r.person_id);
        const entity = db.entities.find((e) => e.id === r.entity_id);
        const lint = r.payload.draft && person ? lintMessage(r.payload.draft, person, entity, r.payload.channel ?? 'email') : [];
        const lintErrors = lint.filter((f) => f.severity === 'error');
        return (
          <Card key={r.id} title={
            <span>{auto?.name}
              {entity && <> — <EntityLink id={entity.id}>{entity.name}</EntityLink></>}
              {person && <> · <PersonLink id={person.id}>{person.full_name}</PersonLink></>}
            </span>}>
            {r.blocked_reason && <div className="mb-2 rounded bg-amber-50 border border-amber-200 px-2 py-1 text-xs text-amber-800">{r.blocked_reason}</div>}
            {r.payload.draft != null ? (
              <>
                {r.payload.subject && <div className="mb-1 text-sm"><span className="text-xs text-gray-500">Subject:</span> {r.payload.subject}</div>}
                <textarea value={r.payload.draft} onChange={(e) => updateRunDraft(r.id, e.target.value)} rows={7}
                  className="w-full rounded border border-gray-300 p-2 text-sm font-mono" />
                {lint.map((f, i) => (
                  <div key={i} className={`mt-1 text-xs ${f.severity === 'error' ? 'text-[#B00000]' : f.severity === 'warning' ? 'text-amber-700' : 'text-gray-400'}`}>
                    {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.message}
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm text-gray-700">{r.payload.note}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button disabled={lintErrors.length > 0} onClick={() => approveRun(r.id)}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
                Approve & execute
              </button>
              <button onClick={() => rejectRun(r.id)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Reject</button>
              {lintErrors.length > 0 && <span className="self-center text-xs text-[#B00000]">Fix linter errors to approve.</span>}
            </div>
          </Card>
        );
      })}

      {recent.length > 0 && (
        <Card title="Recent runs">
          <ul className="divide-y divide-gray-100 text-sm">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-1.5">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  r.status === 'executed' ? 'bg-green-100 text-green-800'
                  : r.status === 'rejected' ? 'bg-gray-200 text-gray-600'
                  : r.status === 'blocked_preflight' ? 'bg-red-100 text-red-800'
                  : 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                <span className="text-gray-600">{db.automations.find((a) => a.id === r.automation_id)?.name}</span>
                <span className="ml-auto text-xs text-gray-400">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
