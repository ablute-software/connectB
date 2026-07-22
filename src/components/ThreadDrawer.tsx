'use client';
// IRM_SPEC §4c — Thread drawer. Opens on demand from the summary card; keeps
// the pipeline/entity page in context behind it instead of a full navigation.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import type { Entity, RelationshipStage } from '@/lib/types';
import { PersonLink } from '@/components/ui';
import { outboundCounts, LOCK_DAYS } from '@/lib/rules';
import {
  STAGE_ORDER, STAGE_LABEL, entityInteractions, relationshipSummary, relatedContacts,
} from '@/lib/relationship';

export function ThreadDrawer({ entity, open, onClose }: { entity: Entity; open: boolean; onClose: () => void }) {
  const { db, setRelationshipStage } = useStore();
  const [personFilter, setPersonFilter] = useState<string>('all');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [copied, setCopied] = useState(false);

  const people = db.people.filter((p) => p.entity_id === entity.id);
  const all = entityInteractions(db, entity.id);
  const filtered = personFilter === 'all' ? all : all.filter((i) => i.person_id === personFilter);
  const sorted = order === 'newest' ? [...filtered].reverse() : filtered;
  const summary = relationshipSummary(db, entity.id);
  const caps = outboundCounts(db);
  const locked = entity.contact_lock_until && new Date(entity.contact_lock_until) > new Date();
  const related = useMemo(
    () => relatedContacts(db, entity.id, personFilter !== 'all' ? personFilter : undefined),
    [db, entity.id, personFilter],
  );

  if (!open) return null;

  // §4d "share/export": no team/invite system yet to share with (Phase 3), so
  // this is a plain-text export for pasting into Slack/email/notes instead.
  function copyThread() {
    const lines = [
      `${entity.name} — relationship thread`,
      summary.firstContactAt ? `First contact ${summary.firstContactAt.slice(0, 10)}` : 'No contact yet',
      '',
      ...all.map((i) => i.channel === 'stage_change'
        ? `[${i.occurred_at.slice(0, 10)}] ${i.content}`
        : `[${i.occurred_at.slice(0, 10)}] ${i.direction === 'out' ? 'OUT' : 'IN'} · ${i.channel}${
            i.person_id ? ` · ${db.people.find((p) => p.id === i.person_id)?.full_name ?? ''}` : ''
          }\n  ${i.content}`),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-gray-900">{entity.name}</h2>
              <div className="mt-0.5 text-xs text-gray-500">
                {summary.firstContactAt ? `First contact ${summary.firstContactAt.slice(0, 10)}` : 'No contact yet'}
                {summary.lastTouchAt && ` · Last touch ${summary.lastTouchAt.slice(0, 10)} (${summary.daysSinceLastTouch}d ago)`}
                {summary.nextStep && ` · Next: ${summary.nextStep.title}`}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button onClick={copyThread} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">
                {copied ? 'Copied!' : 'Copy thread'}
              </button>
              <button onClick={onClose} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50">Close</button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1">
            {STAGE_ORDER.map((stg) => (
              <button key={stg} onClick={() => setRelationshipStage(entity.id, stg)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  stg === summary.stage ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {STAGE_LABEL[stg]}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs">
              <option value="all">All people at this entity</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <button onClick={() => setOrder(order === 'newest' ? 'oldest' : 'newest')}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
              {order === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
            <Link href={`/log?entity=${entity.id}`} className="ml-auto rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
              Log interaction
            </Link>
          </div>
        </div>

        <div className="space-y-2 px-5 py-4">
          {locked && (
            <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-3 py-2 text-xs text-cyan-900">
              🔒 Locked until {entity.contact_lock_until!.slice(0, 10)} — one approach per entity ({LOCK_DAYS}-day rule).
            </div>
          )}
          {summary.whoseTurn === 'them' && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              Awaiting reply ({summary.daysSinceLastTouch}d) — follow-up allowed after {LOCK_DAYS}d.
            </div>
          )}
          {summary.whoseTurn === 'overdue' && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#B00000]">
              ⚠ No reply for {summary.daysSinceLastTouch}d — follow-up allowed, never a third unanswered message.
            </div>
          )}
          <div className={`rounded-lg border px-3 py-2 text-xs ${
            caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap ? 'border-red-200 bg-red-50 text-[#B00000]' : 'border-gray-100 bg-gray-50 text-gray-500'}`}>
            Volume caps — today {caps.today}/{caps.dailyCap} · week {caps.week}/{caps.weeklyCap}
          </div>

          {related.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="font-semibold">Consistency check — related contacts elsewhere:</div>
              {related.map((r) => (
                <div key={r.person.id} className="mt-1">
                  <PersonLink id={r.person.id}>{r.person.full_name}</PersonLink>
                  {r.entity && <> @ <span className="font-medium">{r.entity.name}</span></>}
                  {r.lastInteraction && <span className="text-amber-700"> · last touch {r.lastInteraction.occurred_at.slice(0, 10)}</span>}
                </div>
              ))}
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="pt-2 text-sm text-gray-400">No interactions yet.</p>
          ) : (
            <ul className="space-y-2 pt-1">
              {sorted.map((i) => i.channel === 'stage_change' ? (
                <li key={i.id} className="flex items-center gap-2 py-1 text-xs font-semibold text-gray-500">
                  <span className="text-[#0E7490]">●</span> {i.content} <span className="font-normal text-gray-400">· {i.occurred_at.slice(0, 10)}</span>
                </li>
              ) : (
                <li key={i.id} className="rounded border border-gray-100 bg-gray-50 p-3 text-sm">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className={i.direction === 'out' ? 'font-bold text-[#0E7490]' : 'font-bold text-green-700'}>
                      {i.direction === 'out' ? '→ OUT' : '← IN'}
                    </span>
                    <span className="rounded bg-white border border-gray-200 px-1.5 py-0.5">{i.channel.replace('_', ' ')}</span>
                    <span>{i.occurred_at.slice(0, 10)}</span>
                    {i.person_id && <PersonLink id={i.person_id}>{db.people.find((p) => p.id === i.person_id)?.full_name}</PersonLink>}
                    {i.classification && <span className="rounded bg-gray-200 px-1.5 py-0.5">{i.classification.replace('_', ' ')}</span>}
                  </div>
                  <blockquote className="whitespace-pre-wrap border-l-2 border-gray-300 pl-2 text-gray-700">{i.content}</blockquote>
                  {i.pass_reason && <div className="mt-1 text-xs text-[#B00000]">Pass reason ({i.pass_reason_category}): {i.pass_reason}</div>}
                  {i.next_action && <div className="mt-1 text-xs text-gray-500">Next: {i.next_action} {i.next_action_due && `· ${i.next_action_due}`}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
