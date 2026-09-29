'use client';
// Meeting prep — print-friendly one-pager
//
// Prompt 893 §D/§E — relabeled to match the dossier's own vocabulary ("How
// we pitch this firm"/"What we ask for first", same fields as
// entities.our_angle/the_ask, just no longer called "Our angle"/"The ask"
// here while the rest of the app says something different). §E: the
// history card used to hard-cap at 5 lines truncated to 120 characters —
// now every interaction with this person (or this entity, same filter the
// page already used) is listed, newest first, individually collapsible;
// a dedicated card surfaces their last message in full, not truncated.
// "Terms on the table" is Prompt 894's own extension point — nothing of
// that prompt's scope is implemented here. Still one-pager, still
// printable, still no AI (a "Watson prep brief" is its own future prompt).
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, EntityLink } from '@/components/ui';
import { TermsOnTheTablePlaceholder } from '@/components/dossier/TermsOnTheTablePlaceholder';
import type { Interaction } from '@/lib/types';

function HistoryRow({ interaction }: { interaction: Interaction }) {
  const [expanded, setExpanded] = useState(false);
  const preview = interaction.content.length > 140 ? `${interaction.content.slice(0, 140)}…` : interaction.content;
  return (
    <li className="py-1.5">
      <button type="button" onClick={() => setExpanded((e) => !e)} className="block w-full text-left">
        <span className="text-xs text-gray-400">
          {interaction.occurred_at.slice(0, 10)} · {interaction.direction.toUpperCase()} · {interaction.channel.replace('_', ' ')}
          {' '}{expanded ? '▾' : '▸'}
        </span>
        {' — '}
        <span className="text-sm text-gray-700">{expanded ? interaction.content : preview}</span>
      </button>
    </li>
  );
}

export default function PrepPage({ params }: { params: { id: string } }) {
  const { db } = useStore();
  const person = db.people.find((p) => p.id === params.id);
  const [questions, setQuestions] = useState<string>('');
  if (!person) return <div className="text-gray-500">Person not found.</div>;
  const entity = db.entities.find((e) => e.id === person.entity_id);
  // Prompt 893 §E — every interaction, newest first (was .slice(0, 5)).
  // Same filter as before: this person specifically, OR this entity in
  // general (a firm-wide reply that never named a specific person).
  const history = db.interactions.filter((i) => i.person_id === person.id || i.entity_id === person.entity_id)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const lastInboundMessage = history.find((i) => i.direction === 'in');

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
      <Card title="2 · How we pitch this firm">
        <p className="text-sm">{entity?.our_angle ?? '—'}</p>
      </Card>
      <Card title="3 · What we ask for first">
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
      {/* Prompt 893 §E — their last message, in full, never truncated — the
          founder walking into a meeting shouldn't have to dig through
          History to re-read exactly what the other side last said. */}
      {lastInboundMessage && (
        <Card title="Their last message — in full">
          <div className="text-xs text-gray-400">{lastInboundMessage.occurred_at.slice(0, 10)} · {lastInboundMessage.channel.replace('_', ' ')}</div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{lastInboundMessage.content}</p>
        </Card>
      )}
      {/* Prompt 893 §H — extension point for Prompt 894 ("Terms on the
          table") only; no deal-terms logic here. */}
      <TermsOnTheTablePlaceholder />
      <Card title={`History — every interaction (${history.length}), newest first`}>
        {history.length === 0 ? <p className="text-sm text-gray-400">No interactions yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {history.map((i) => <HistoryRow key={i.id} interaction={i} />)}
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
