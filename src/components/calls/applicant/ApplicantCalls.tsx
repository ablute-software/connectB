'use client';
// Prompt 907 (I4) — the "Calls" area of a startup's workspace (spec §20): Open calls, My applications, Past applications. Every card opens
// the call's own page (/call/<token>), where the application is. Notices (submission received, reminders, a new deadline) are shown on top
// until they are seen. Pure drawing: what is listed, in what order and with which button is decided in src/lib/calls/applicant/overview.ts.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDayInZone, formatInZone } from '@/lib/calls/tz';
import { richTextToPlain } from '@/lib/rich-text';
import { STAGE_LABELS, type CardAction, type Overview } from '@/lib/calls/applicant/overview';
import { CallNotices } from './CallNotices';
import { EntityLogo } from './CallHeader';

type Tab = 'open' | 'mine' | 'past';

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-[#0E7490] bg-[#E8F4F8] font-semibold text-[#0E7490]' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{label}</button>
  );
}
type Filter = 'all' | 'open' | 'in_progress' | 'submitted';
const ACTION_LABEL: Record<CardAction, string> = { apply: 'Apply', continue: 'Continue application', view: 'View application' };

export function ApplicantCalls() {
  const [data, setData] = useState<(Overview & { startup?: boolean }) | null | 'unavailable'>(null);
  const [tab, setTab] = useState<Tab>('open');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/calls/apply/overview', { cache: 'no-store' });
      const d = await r.json().catch(() => null);
      setData(r.ok && d?.ok ? d : 'unavailable');
    } catch { setData('unavailable'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (data === null) return <p className="text-sm text-gray-400">Loading…</p>;
  if (data === 'unavailable') return <p className="text-sm text-gray-500" data-testid="calls-unavailable">Calls are not available right now.</p>;

  const openCards = data.openCalls.filter((c) => filter === 'all' || (filter === 'open' ? c.action === 'apply' : filter === 'in_progress' ? c.action === 'continue' : c.applicationStage !== null && c.applicationStage !== 'in_progress'));

  return (
    <div data-testid="applicant-calls">
      <h1 className="text-lg font-semibold text-gray-900">Calls</h1>
      <p className="mt-1 text-sm text-gray-500">Open calls from investors and ecosystem organisations, and your applications.</p>
      <CallNotices onSeen={() => void load()} />
      <div className="mt-4 flex gap-1 border-b border-gray-200" role="tablist">
        {([['open', 'Open calls', data.openCalls.length], ['mine', 'My applications', data.mine.length], ['past', 'Past applications', data.past.length]] as const).map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-[#0E7490] font-semibold text-[#0E7490]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{label} <span className="text-xs text-gray-400">{n}</span></button>
        ))}
      </div>

      {tab === 'open' && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap gap-2" aria-label="Filter">
            {([['all', 'All'], ['open', 'Open to apply'], ['in_progress', 'In progress'], ['submitted', 'Submitted']] as const).map(([id, label]) => (
              <FilterChip key={id} label={label} active={filter === id} onClick={() => setFilter(id)} />
            ))}
          </div>
          {openCards.length === 0 ? <p className="text-sm text-gray-500" data-testid="no-open-calls">No calls to show here.</p> : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {openCards.map((c) => (
                <li key={c.callId} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4" data-testid="call-card">
                  <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                    <EntityLogo url={c.logoUrl} name={c.promoter} size={24} />
                    <span className="min-w-0 truncate">{c.promoter}{c.linkOnly ? ' · link only' : ''}</span>
                  </p>
                  <h2 className="mt-0.5 text-base font-semibold text-gray-900">{c.name}</h2>
                  {c.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-gray-600">{richTextToPlain(c.description)}</p>}
                  <p className="mt-2 text-xs text-gray-500">Deadline: {formatInZone(c.closesAt, c.timezone)}</p>
                  {c.applicationStage && <p className="mt-1 text-xs font-medium text-emerald-700" data-testid="card-stage">{STAGE_LABELS[c.applicationStage]}{c.reference ? ` · ${c.reference}` : ''}</p>}
                  <Link href={`/call/${c.token}`} data-testid="card-action"
                    className="mt-3 self-start rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">{ACTION_LABEL[c.action]}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="mt-4">
          {data.mine.length === 0 ? <p className="text-sm text-gray-500" data-testid="no-applications">You have no applications yet.</p> : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" data-testid="my-applications">
              {data.mine.map((a) => (
                <li key={a.applicationId} className="flex items-center justify-between gap-3 px-4 py-3" data-testid="application-row">
                  <EntityLogo url={a.logoUrl} name={a.promoter} size={32} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm text-gray-900">{a.name}</b>
                    {a.cancelledPurgeAfter !== undefined ? (
                      <span className="block text-xs text-[#B00000]" data-testid="cancelled-note">{a.promoter} cancelled this call. {a.applicationStatus === 'submitted' ? 'Your application' : 'Your draft'} will be deleted on {formatDayInZone(a.cancelledPurgeAfter, a.timezone)}.{a.applicationStatus === 'submitted' ? ' Until then you can read it and download your files.' : ''}</span>
                    ) : (
                      <span className="text-xs text-gray-500">{a.promoter} · {a.reference ?? '—'} · {a.stage === 'in_progress' ? `deadline ${formatInZone(a.closesAt, a.timezone)}` : a.submittedAt ? `submitted ${formatInZone(a.submittedAt, a.timezone)}` : ''}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    {a.cancelledPurgeAfter !== undefined ? (
                      <>
                        <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-900" data-testid="stage">Cancelled</span>
                        {a.applicationStatus === 'submitted' && <Link href={`/calls/cancelled/${a.applicationId}`} data-testid="view-cancelled" className="inline-flex min-h-[44px] items-center text-xs font-semibold text-[#0E7490] hover:underline">View</Link>}
                      </>
                    ) : (
                      <>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${a.stage === 'in_progress' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`} data-testid="stage">{STAGE_LABELS[a.stage]}</span>
                        {a.token && <Link href={`/call/${a.token}`} className="text-xs font-semibold text-[#0E7490] hover:underline">{a.stage === 'in_progress' ? 'Continue' : 'View'}</Link>}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'past' && (
        <div className="mt-4">
          {data.past.length === 0 ? <p className="text-sm text-gray-500" data-testid="no-past">Nothing here yet.</p> : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white" data-testid="past-applications">
              {data.past.map((p, i) => (
                <li key={`${p.callId}-${i}`} className="px-4 py-3" data-testid="past-row">
                  <b className="text-sm text-gray-900">{p.name}</b>
                  <span className="block text-xs text-gray-500">{p.promoter} · {p.reference ?? '—'} · {p.reason === 'closed_without_submission' ? `closed on ${formatInZone(p.closesAt, p.timezone)} — not submitted` : 'archived'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
