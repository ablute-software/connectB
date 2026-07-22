'use client';
// Meeting prep — print-friendly one-pager
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';

export default function PrepPage({ params }: { params: { id: string } }) {
  const { db } = useStore();
  const person = db.people.find((p) => p.id === params.id);
  const [questions, setQuestions] = useState<string>('');
  if (!person) return <div className="text-gray-500">Person not found.</div>;
  const entity = db.entities.find((e) => e.id === person.entity_id);
  const history = db.interactions.filter((i) => i.person_id === person.id || i.entity_id === person.entity_id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 5);

  return (
    <div className="mx-auto max-w-2xl space-y-4 print:max-w-none">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold">Meeting prep — {person.full_name}{entity ? ` · ${entity.name}` : ''}</h1>
          <div className="text-sm text-gray-500">{person.role} {entity && <>· <EntityLink id={entity.id}>{entity.name}</EntityLink></>}</div>
        </div>
        <button onClick={() => window.print()} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-500 print:hidden">Print</button>
      </div>

      <Card title="1 · The hook" tint="blue">
        <p className="text-sm">{person.hook ?? 'No researched hook — research before the meeting.'}</p>
      </Card>
      <Card title="2 · Our angle">
        <p className="text-sm">{entity?.our_angle ?? '—'}</p>
      </Card>
      <Card title="3 · The ask (one, small)">
        <p className="text-sm font-semibold">{entity?.the_ask ?? '—'}</p>
      </Card>
      {person.watch_outs && (
        <Card title="4 · Watch-outs" tint="amber"><p className="text-sm font-medium">{person.watch_outs}</p></Card>
      )}
      <Card title="5 · Kill words">
        {person.kill_words.length === 0
          ? <p className="text-sm text-gray-400">— none recorded</p>
          : <div className="flex gap-2">{person.kill_words.map((k) => <span key={k} className="rounded bg-red-100 px-2 py-0.5 text-sm text-red-800">{k}</span>)}</div>}
      </Card>
      {entity?.hard_filter_status === 'open' && (
        <Card title="6 · Open hard filter" tint="red"><p className="text-sm">{entity.hard_filter}</p></Card>
      )}
      <Card title="History (last 5)">
        {history.length === 0 ? <p className="text-sm text-gray-400">No interactions yet.</p> : (
          <ul className="space-y-1 text-sm text-gray-600">
            {history.map((i) => (
              <li key={i.id}>
                <span className="text-xs text-gray-400">{i.occurred_at.slice(0, 10)} · {i.direction.toUpperCase()} · {i.channel.replace('_', ' ')}</span>
                {' — '}{i.content.slice(0, 120)}{i.content.length > 120 ? '…' : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Open questions (fill before the call)">
        <textarea value={questions} onChange={(e) => setQuestions(e.target.value)} rows={5}
          placeholder="- …" className="w-full rounded border border-gray-200 p-2 text-sm" />
      </Card>
      <div className="pt-2 text-center text-[10px] text-gray-400">ablute_ · CONFIDENTIAL — SUBJECT TO NON-DISCLOSURE AGREEMENT · Seed Round 2026 · €1.3M</div>
    </div>
  );
}
