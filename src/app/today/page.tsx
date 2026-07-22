'use client';
// Today — the Next Best Action queue
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Card, EntityLink, PersonLink, WaveTag, fmtEur } from '@/components/ui';
import { outboundCounts, preflight, preflightSummary } from '@/lib/rules';
import { ACTION_TYPE_COLOR, ACTION_TYPE_LABEL, recommendedActionType } from '@/lib/relationship';
import type { ActionType } from '@/lib/types';

function ActionTypePill({ type }: { type: ActionType }) {
  return <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${ACTION_TYPE_COLOR[type]}`}>{ACTION_TYPE_LABEL[type]}</span>;
}

export default function TodayPage() {
  const { db, toggleTask } = useStore();
  const now = new Date();
  const caps = outboundCounts(db);
  const capReached = caps.today >= caps.dailyCap || caps.week >= caps.weeklyCap;

  const overdue = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) < now && t.kind !== 'research')
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  const unclassified = db.interactions.filter((i) => i.direction === 'in' && (!i.classification || i.classification === 'unclear'));
  const ready = db.people
    .filter((p) => !p.do_not_contact)
    .filter((p) => {
      const e = db.entities.find((x) => x.id === p.entity_id);
      return e && ['not_contacted', 'contacted'].includes(e.status);
    })
    .filter((p) => preflightSummary(preflight(db, p, null)).green)
    .sort((a, b) => {
      const ea = db.entities.find((x) => x.id === a.entity_id); const eb = db.entities.find((x) => x.id === b.entity_id);
      return (ea?.wave ?? 9) - (eb?.wave ?? 9) || a.seniority_rank - b.seniority_rank;
    });
  const research = db.tasks.filter((t) => !t.done && t.kind === 'research')
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''));
  const thisWeek = db.tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at) >= now
    && new Date(t.due_at) < new Date(now.getTime() + 7 * 24 * 3600 * 1000))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? '')).slice(0, 6);
  const softCircled = db.entities.reduce((s, e) => s + (e.interest_eur ?? 0), 0);
  const activeConvos = db.entities.filter((e) => ['in_conversation', 'diligence'].includes(e.status)).length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Today</h1>
          <span className="text-sm text-gray-500">{now.toISOString().slice(0, 10)} · outbounds {caps.today}/{caps.dailyCap} today, {caps.week}/{caps.weeklyCap} week</span>
        </div>

        <Card title={<span className="text-[#B00000]">Overdue ({overdue.length})</span>}>
          {overdue.length === 0 ? <p className="text-sm text-gray-400">Nothing overdue.</p> : (
            <ul className="divide-y divide-gray-100">
              {overdue.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" checked={false} onChange={() => toggleTask(t.id)} />
                  <ActionTypePill type={t.action_type} />
                  <span className="flex-1">{t.title}
                    {t.entity_id && <> — <EntityLink id={t.entity_id}>{db.entities.find((e) => e.id === t.entity_id)?.name}</EntityLink></>}
                  </span>
                  <span className="font-semibold text-[#B00000]">{t.due_at?.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="text-amber-700">Unclassified replies ({unclassified.length})</span>}>
          {unclassified.length === 0 ? <p className="text-sm text-gray-400">Inbox clear.</p> : (
            <ul className="divide-y divide-gray-100">
              {unclassified.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">
                    {i.person_id && <PersonLink id={i.person_id}>{db.people.find((p) => p.id === i.person_id)?.full_name}</PersonLink>}
                    {' — '}<span className="text-gray-500">“{i.content.slice(0, 70)}…”</span>
                  </span>
                  <Link href={`/entities/${i.entity_id}`} className="rounded border border-gray-300 px-2 py-1 text-xs">Classify</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="text-green-700">Ready to contact ({capReached ? 0 : ready.length})</span>}>
          {capReached ? (
            <p className="text-sm text-gray-500">Daily cap reached ({caps.today}/{caps.dailyCap}). Queue resumes tomorrow — research below.</p>
          ) : ready.length === 0 ? (
            <p className="text-sm text-gray-400">No one is fully green right now — resolve pre-flight blockers or research hooks.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {ready.map((p) => {
                const e = db.entities.find((x) => x.id === p.entity_id)!;
                return (
                  <li key={p.id} className="py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <WaveTag wave={e.wave} />
                      <ActionTypePill type={recommendedActionType(db, e.id, p.id)} />
                      <PersonLink id={p.id}><span className="font-medium">{p.full_name}</span></PersonLink>
                      <span className="text-gray-500">· {e.name}</span>
                      <Link href={`/log?entity=${e.id}&person=${p.id}`}
                        className="ml-auto rounded-lg bg-[#0E7490] px-2.5 py-1 text-xs font-medium text-white">Open draft flow</Link>
                    </div>
                    {p.hook && <div className="mt-0.5 text-xs text-gray-500">{p.hook}</div>}
                    {e.submission_channel && <div className="text-xs text-cyan-800">Official channel first: {e.submission_channel}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title={<span className="text-[#0E7490]">Research needed ({research.length})</span>}>
          {research.length === 0 ? <p className="text-sm text-gray-400">No research tasks.</p> : (
            <ul className="divide-y divide-gray-100">
              {research.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" checked={false} onChange={() => toggleTask(t.id)} />
                  <ActionTypePill type={t.action_type} />
                  <span className="flex-1">{t.title}</span>
                  {t.person_id && <PersonLink id={t.person_id}>open</PersonLink>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-gray-400">No hook = no message. Generic messages burn contacts permanently.</p>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Round progress" tint="blue">
          <div className="text-2xl font-bold text-[#0E7490]">{fmtEur(softCircled)} <span className="text-sm font-normal text-gray-500">/ €1.3M</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-white">
            <div className="h-full bg-[#0E7490]" style={{ width: `${Math.min(100, (softCircled / 1300000) * 100)}%` }} />
          </div>
          <div className="mt-2 text-xs text-gray-500">{activeConvos} active conversation(s) · benchmark: a seed closes on 15–40.</div>
        </Card>
        <Card title="This week">
          {thisWeek.length === 0 ? <p className="text-sm text-gray-400">Nothing scheduled.</p> : (
            <ul className="space-y-1.5 text-sm">
              {thisWeek.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <ActionTypePill type={t.action_type} />
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="shrink-0 text-xs text-gray-400">{t.due_at?.slice(5, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
