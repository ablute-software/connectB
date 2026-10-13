'use client';
// Prompt 900 §A/§B — Startups › "Closed & deleted": the accounts that ended, who is still attached to each, what else each person
// holds (so "why can't she get in?" has an answer on screen), and the two actions for getting a person out of a dead account:
//   Release email   take the person out of it (the account stays dead) so the e-mail can be used in another capacity;
//   Reopen account  put an account deleted by moderation back to active.
// Both are available only when the rules allow them, and when they are not the button is off AND the reason is written next to it
// (Prompt 569 §0: a disabled button with its reason only in a tooltip reads as "broken"). Nothing is hidden by moving accounts here:
// the Orgs tab says how many are in this one and links to it (Prompt 184 §4 — it changes tabs, nothing is hidden).
//
// Split in two on purpose: ClosedAccountsView is the whole screen as a pure function of its props (so its text is testable), and
// ClosedDeletedTab owns the fetching, the side panel and the reload after an action.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui';
import { AccountActionPanel } from './AccountActionPanel';
import {
  CLOSURE_LABEL,
  type ClosedAccount, type ClosedAccountMember, type EcosystemHat, type EndEvent, type InvestorHat,
} from '@/lib/closed-accounts';
import { panelSpec, type PanelRequest } from '@/lib/closed-accounts-panels';

type Filter = 'all' | 'deleted' | 'closed';
const FILTER_LABEL: Record<Filter, string> = { all: 'All', deleted: 'Deleted by moderation', closed: 'Closed' };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function Pill({ tone, children }: { tone: 'red' | 'amber' | 'gray' | 'violet' | 'green' | 'cyan'; children: React.ReactNode }) {
  const style = {
    red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', gray: 'bg-gray-100 text-gray-600',
    violet: 'bg-violet-50 text-violet-700', green: 'bg-emerald-50 text-emerald-700', cyan: 'bg-cyan-50 text-cyan-700',
  }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>{children}</span>;
}

function HatChip({ kind, hat }: { kind: 'Ecosystem' | 'Investor'; hat: EcosystemHat | InvestorHat }) {
  const detail = [hat.role, 'status' in hat && hat.status !== 'active' ? hat.status : null].filter(Boolean).join(', ');
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] ${hat.live ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-500'}`}
      title={hat.live ? 'A live hat: it lets this person in' : 'Not live: it does not let this person in'}>
      {kind} · {hat.name}{detail ? ` (${detail})` : ''}{hat.live ? '' : ' — not live'}
    </span>
  );
}

function signInTone(text: string): string {
  if (text.startsWith('Signs in through')) return 'text-emerald-700';
  if (text.startsWith('Locked out') || text.startsWith('E-mail on the blocked')) return 'text-[#B00000]';
  return 'text-gray-500';
}

function purgeText(a: ClosedAccount): string {
  if (!a.purgeAfter) return 'no purge date';
  return (a.daysToPurge ?? 0) > 0 ? `${a.daysToPurge}d to purge (${day(a.purgeAfter)})` : `retention ended ${day(a.purgeAfter)}`;
}

const BTN = 'rounded-md border px-2 py-1 text-[11px] font-medium disabled:cursor-not-allowed disabled:opacity-40';

/** "Deleted 2026-09-29 by admin@… — “reason”": the date, the person and the words each way of ending was recorded with. */
function EndLine({ label, e }: { label: string; e: EndEvent }) {
  return (
    <span>
      {label} {day(e.at) ?? 'on an unknown date'}{e.by ? ` by ${e.by}` : ''}{e.reason ? <> — <span className="italic">“{e.reason}”</span></> : ''}
    </span>
  );
}

function MemberRow({ a, m, onRelease, onReopen }: {
  a: ClosedAccount; m: ClosedAccountMember;
  onRelease: (a: ClosedAccount, m: ClosedAccountMember) => void; onReopen: (a: ClosedAccount) => void;
}) {
  return (
    <tr className="border-t border-gray-100 align-top">
      <td className="py-2 pr-3 text-xs font-medium text-gray-900">{m.email}</td>
      <td className="py-2 pr-3 text-xs text-gray-600">{m.role ?? '—'}</td>
      <td className="py-2 pr-3 text-xs">{m.emailConfirmed ? <Pill tone="green">confirmed</Pill> : <Pill tone="amber">not confirmed</Pill>}</td>
      <td className="py-2 pr-3">
        <div className="flex max-w-xs flex-col items-start gap-1">
          {m.hats.ecosystem.map((h, i) => <HatChip key={`e${i}`} kind="Ecosystem" hat={h} />)}
          {m.hats.investor.map((h, i) => <HatChip key={`i${i}`} kind="Investor" hat={h} />)}
          {m.hats.ecosystem.length + m.hats.investor.length === 0 && <span className="text-[11px] text-gray-400">Nothing else</span>}
        </div>
      </td>
      <td className={`py-2 pr-3 text-[11px] ${signInTone(m.signIn)}`}>{m.signIn}</td>
      <td className="min-w-64 py-2">
        <div className="flex gap-1.5">
          <button disabled={!m.release.ok} onClick={() => onRelease(a, m)} aria-label={`Release email ${m.email}`}
            title={m.release.ok ? undefined : m.release.reason}
            className={`${BTN} border-[#B00000] text-[#B00000] hover:bg-red-50`}>Release email</button>
          <button disabled={!a.reopen.ok} onClick={() => onReopen(a)} aria-label={`Reopen account ${a.name}`}
            title={a.reopen.ok ? undefined : a.reopen.reason}
            className={`${BTN} border-[#0E7490] text-[#0E7490] hover:bg-cyan-50`}>Reopen account</button>
        </div>
        {!m.release.ok && <p className="mt-1 max-w-72 text-[10px] leading-tight text-gray-500"><b>Release email off:</b> {m.release.reason}</p>}
        {!a.reopen.ok && <p className="mt-1 max-w-72 text-[10px] leading-tight text-gray-500"><b>Reopen account off:</b> {a.reopen.reason}</p>}
      </td>
    </tr>
  );
}

function AccountCard({ a, onRelease, onReopen, onOwnerReopen }: {
  a: ClosedAccount;
  onRelease: (a: ClosedAccount, m: ClosedAccountMember) => void; onReopen: (a: ClosedAccount) => void; onOwnerReopen: (a: ClosedAccount) => void;
}) {
  const ownerClosed = a.closedReason === 'owner' && !!a.closedAt;
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4" aria-label={`${a.name} — closed or deleted account`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">{a.name}</h4>
        {a.isTest && <Pill tone="gray">test</Pill>}
        {a.isInternal && <Pill tone="gray">internal</Pill>}
        {a.ways.map((w) => <Pill key={w} tone={w === 'moderation_deleted' ? 'red' : 'amber'}>{CLOSURE_LABEL[w]}</Pill>)}
        {a.gdprErasure && <Pill tone="violet">GDPR erasure ({a.gdprErasure})</Pill>}
        <span className="ml-auto text-[11px] text-gray-400">{purgeText(a)}</span>
      </div>
      <p className="mt-1 text-xs text-gray-600">
        {a.deleted && <EndLine label="Deleted" e={a.deleted} />}
        {a.deleted && a.closed && ' · '}
        {a.closed && <EndLine label="Closed" e={a.closed} />}
        {!a.deleted && !a.closed && 'Ended on an unknown date'}
        {a.createdAt ? <span className="text-gray-400"> · registered {day(a.createdAt)}</span> : null}
      </p>

      {ownerClosed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {a.ownerReopenable ? (
            <>
              <span>Closed by its owner — they can still get it back for {a.daysToPurge} more {a.daysToPurge === 1 ? 'day' : 'days'}.</span>
              <button onClick={() => onOwnerReopen(a)} className={`${BTN} border-[#0E7490] bg-white text-[#0E7490] hover:bg-cyan-50`}>Reopen account…</button>
            </>
          ) : (
            <span>Closed by its owner — the retention window ended {day(a.purgeAfter)}: not reopenable from the app.</span>
          )}
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        {a.members.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>No member is attached to this account any more.</span>
            <button disabled={!a.reopen.ok} onClick={() => onReopen(a)} title={a.reopen.ok ? undefined : a.reopen.reason}
              className={`${BTN} border-[#0E7490] text-[#0E7490] hover:bg-cyan-50`}>Reopen account</button>
            {!a.reopen.ok && <span className="text-[10px] text-gray-500"><b>Reopen account off:</b> {a.reopen.reason}</span>}
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-400">
                <th className="pb-1 pr-3 font-semibold">E-mail</th><th className="pb-1 pr-3 font-semibold">Role</th>
                <th className="pb-1 pr-3 font-semibold">E-mail confirmed</th><th className="pb-1 pr-3 font-semibold">Also holds</th>
                <th className="pb-1 pr-3 font-semibold">At sign-in</th><th className="pb-1 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>{a.members.map((m) => <MemberRow key={m.userId} a={a} m={m} onRelease={onRelease} onReopen={onReopen} />)}</tbody>
          </table>
        )}
      </div>

      {a.trail.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">History ({a.trail.length})</summary>
          <ul className="mt-1.5 space-y-1 border-l border-gray-100 pl-3">
            {a.trail.map((t, i) => (
              <li key={i} className="text-gray-600">
                <span className="text-gray-400">{day(t.at)}</span> {t.text}{t.by ? <span className="text-gray-400"> · {t.by}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function ClosedAccountsView({ accounts, onRelease, onReopen, onOwnerReopen }: {
  accounts: ClosedAccount[];
  onRelease: (a: ClosedAccount, m: ClosedAccountMember) => void;
  onReopen: (a: ClosedAccount) => void;
  onOwnerReopen: (a: ClosedAccount) => void;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const counts: Record<Filter, number> = useMemo(() => ({
    all: accounts.length,
    deleted: accounts.filter((a) => a.moderationStatus === 'deleted').length,
    closed: accounts.filter((a) => a.closedAt != null).length,
  }), [accounts]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === 'deleted' && a.moderationStatus !== 'deleted') return false;
      if (filter === 'closed' && a.closedAt == null) return false;
      if (!needle) return true;
      return a.name.toLowerCase().includes(needle) || a.members.some((m) => m.email.toLowerCase().includes(needle));
    });
  }, [accounts, q, filter]);

  return (
    <Card title={`Closed & deleted (${shown.length}${shown.length === accounts.length ? '' : ` of ${accounts.length}`})`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or e-mail…" aria-label="Search closed and deleted accounts"
          className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <div className="flex gap-1">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f ? 'bg-[#0E7490] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {FILTER_LABEL[f]} ({counts[f]})
            </button>
          ))}
        </div>
      </div>
      <p className="mb-3 text-[11px] text-gray-500">
        Accounts that ended — closed (by their owner, by the platform, or when their last member left) or deleted by moderation. Release email takes one
        person out of an account so their e-mail can be used in another capacity; Reopen account puts a deleted one back to active. Neither touches the
        person’s sign-in or the blocked list.
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">{accounts.length === 0 ? 'No closed or deleted accounts.' : 'Nothing matches.'}</p>
      ) : (
        <div className="space-y-3">
          {shown.map((a) => <AccountCard key={a.orgId} a={a} onRelease={onRelease} onReopen={onReopen} onOwnerReopen={onOwnerReopen} />)}
        </div>
      )}
    </Card>
  );
}

export function ClosedDeletedTab({ onChanged }: { onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<ClosedAccount[] | null>(null);
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState('');
  const [panel, setPanel] = useState<PanelRequest | null>(null);

  const load = useCallback(() => {
    fetch('/api/backoffice/closed-accounts').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load.'); return; }
      setErr(''); setAccounts(body.accounts as ClosedAccount[]);
    }).catch(() => setErr('Could not load.'));
  }, []);
  useEffect(load, [load]);

  if (err && !accounts) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!accounts) return <p className="text-sm text-gray-400">Loading…</p>;

  const spec = panel ? panelSpec(panel) : null;
  return (
    <div className="space-y-3">
      {flash && (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>{flash}</span>
          <button onClick={() => setFlash('')} className="ml-auto text-emerald-600 hover:text-emerald-800" aria-label="Dismiss">✕</button>
        </div>
      )}
      <ClosedAccountsView accounts={accounts}
        onRelease={(account, member) => setPanel({ kind: 'release', account, member })}
        onReopen={(account) => setPanel({ kind: 'reopen', account })}
        onOwnerReopen={(account) => setPanel({ kind: 'owner_reopen', account })} />
      {panel && spec && (
        <AccountActionPanel title={spec.title} name={spec.name} lead={spec.lead} heading={spec.heading} cascadeLines={spec.lines}
          confirmLabel={spec.confirmLabel} confirmPhrase={spec.confirmPhrase} tone={spec.tone} reasonPlaceholder={spec.reasonPlaceholder}
          onConfirm={async (reason) => {
            const res = await fetch(spec.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec.body(reason)) });
            const body = await res.json().catch(() => ({}));
            if (body.ok) setFlash(spec.success(body.result as Record<string, unknown> | null | undefined));
            return { ok: !!body.ok, error: body.error };
          }}
          onClose={() => setPanel(null)}
          onDone={() => { setPanel(null); load(); onChanged?.(); }} />
      )}
    </div>
  );
}
