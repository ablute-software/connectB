'use client';
// Prompt 904 Part C — a firm's seats, seen by its administrator (docs/calls/SPEC_CALLS_V2.md §9.3).
// For a firm on the 1/2/5 tiers this renders only the "have a code?" box; for a firm with a custom plan
// it shows the numbers, who holds each seat and since when, the reserved ones, and lets an
// administrator reserve a seat for an email, cancel a reservation, or remove a member. Past the
// number, the server refuses and says why; this component only shows what it says.
//
// Stateless view + stateful container, as PasswordInput / EmailCodeSignup: the view is rendered in
// tests with react-dom/server.
import { useCallback, useEffect, useState } from 'react';

export interface SeatsData {
  hasPlan: boolean;
  isAdmin?: boolean;
  planName?: string;
  seats?: number;
  used?: number;
  reserved?: number;
  free?: number;
  ownMemberId?: string;
  members?: { id: string; email: string | null; name: string | null; role: string | null; since: string | null }[];
  invites?: { id: string; email: string; createdAt: string }[];
  /** Prompt 904 decision 3 — domain-matched claimants waiting for this administrator. */
  pendingClaims?: { id: string; email: string; createdAt: string }[];
}

function day(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

export function SeatsPanelView({
  data, busy, error, notice, inviteEmail, code,
  onInviteEmail, onInvite, onCancelInvite, onRemove, onCode, onRedeem, onApproveClaim, onDeclineClaim,
}: {
  data: SeatsData | null;
  busy: boolean;
  error: string;
  notice: string;
  inviteEmail: string;
  code: string;
  onInviteEmail: (v: string) => void;
  onInvite: () => void;
  onCancelInvite: (id: string) => void;
  onRemove: (id: string) => void;
  onCode: (v: string) => void;
  onRedeem: () => void;
  onApproveClaim: (id: string) => void;
  onDeclineClaim: (id: string) => void;
}) {
  if (!data) return null;
  return (
    <div className="space-y-4" data-testid="seats-panel">
      {data.hasPlan && data.isAdmin && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Seats · {data.planName}</h2>
            <span className="text-xs font-medium text-gray-600" data-testid="seat-counts">
              {data.used} of {data.seats} in use{data.reserved ? ` · ${data.reserved} reserved` : ''} · {data.free} free
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-[#0E7490]" style={{ width: `${Math.min(100, Math.round((((data.used ?? 0) + (data.reserved ?? 0)) / Math.max(1, data.seats ?? 1)) * 100))}%` }} />
          </div>

          {(data.pendingClaims ?? []).length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="pending-claims">
              <p className="text-xs font-semibold text-amber-900">Waiting for your approval</p>
              <p className="mt-0.5 text-[11px] text-amber-800">They claimed your firm&apos;s profile with an email at your domain. Nobody gets a seat without you.</p>
              <ul className="mt-2 divide-y divide-amber-100">
                {(data.pendingClaims ?? []).map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-gray-900">{c.email}</span>
                    <span className="flex shrink-0 gap-3 text-xs">
                      <button type="button" onClick={() => onApproveClaim(c.id)} disabled={busy} className="font-medium text-[#0E7490] hover:underline disabled:opacity-40">Accept</button>
                      <button type="button" onClick={() => onDeclineClaim(c.id)} disabled={busy} className="text-gray-500 hover:text-[#B00000] disabled:opacity-40">Decline</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <ul className="mt-3 divide-y divide-gray-100">
            {(data.members ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{m.name ?? m.email ?? 'Member'}</span>
                  {m.name && m.email && <span className="ml-2 text-xs text-gray-400">{m.email}</span>}
                  {m.role && <span className="ml-2 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{m.role}</span>}
                  <span className="ml-2 text-[11px] text-gray-400">since {day(m.since)}</span>
                </div>
                {m.id !== data.ownMemberId && (
                  <button type="button" onClick={() => onRemove(m.id)} disabled={busy}
                    className="shrink-0 text-xs text-gray-400 hover:text-[#B00000] disabled:opacity-40">Remove</button>
                )}
              </li>
            ))}
            {(data.invites ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-1.5 text-sm text-gray-500">
                <div className="min-w-0">
                  <span>{i.email}</span>
                  <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">seat reserved</span>
                </div>
                <button type="button" onClick={() => onCancelInvite(i.id)} disabled={busy}
                  className="shrink-0 text-xs text-gray-400 hover:text-[#B00000] disabled:opacity-40">Cancel</button>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input type="email" autoComplete="off" value={inviteEmail} onChange={(e) => onInviteEmail(e.target.value)}
              placeholder="Email to reserve a seat for" aria-label="Email to reserve a seat for"
              className="min-w-[14rem] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <button type="button" onClick={onInvite} disabled={busy || !inviteEmail.includes('@')}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">
              Reserve seat
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400">
            They sign up (or sign in) with that email, search for your firm and claim its profile — it is approved automatically.
          </p>
          {notice && <p role="status" className="mt-2 text-xs text-emerald-700">{notice}</p>}
          {error && <p role="alert" className="mt-2 text-xs text-[#B00000]" data-testid="seat-error">{error}</p>}
        </div>
      )}

      {data.hasPlan && !data.isAdmin && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs text-gray-600">
          Your firm is on <b>{data.planName}</b> ({data.seats} seats). Seats are managed by your firm&apos;s administrators.
        </div>
      )}

      {!data.hasPlan && (
        <details className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-xs text-gray-600">
          <summary className="cursor-pointer text-xs font-semibold text-gray-700">Have a code for a custom plan?</summary>
          <p className="mt-2">
            If Sherlock Deal gave your firm a plan code, enter it here. It only works for someone who already has an approved
            claim on your firm&apos;s profile.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input autoComplete="off" value={code} onChange={(e) => onCode(e.target.value)} placeholder="PD-XXXX-XXXX"
              aria-label="Plan code" className="min-w-[16rem] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm uppercase" />
            <button type="button" onClick={onRedeem} disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b] disabled:opacity-40">Activate</button>
          </div>
          {notice && <p role="status" className="mt-2 text-xs text-emerald-700">{notice}</p>}
          {error && <p role="alert" className="mt-2 text-xs text-[#B00000]" data-testid="seat-error">{error}</p>}
        </details>
      )}
    </div>
  );
}

/** Fetches the firm's seats and wires the actions. `onChange` lets the parent refresh its own lists. */
export function SeatsPanel({ onData, onChange }: { onData?: (d: SeatsData | null) => void; onChange?: () => void }) {
  const [data, setData] = useState<SeatsData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(() => {
    fetch('/api/portal/seats').then((r) => r.json()).then((d) => {
      const next = d && d.ok ? (d as SeatsData) : null;
      setData(next); onData?.(next);
    }).catch(() => { setData(null); onData?.(null); });
  }, [onData]);
  useEffect(load, [load]);

  async function post(url: string, body: unknown, okNotice: string): Promise<boolean> {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) { setError(json.error ?? 'Something went wrong. Please try again.'); return false; }
      setNotice(okNotice); load(); onChange?.();
      return true;
    } catch {
      setError('We could not reach the server. Check your connection and try again.');
      return false;
    } finally { setBusy(false); }
  }

  return (
    <SeatsPanelView
      data={data} busy={busy} error={error} notice={notice} inviteEmail={inviteEmail} code={code}
      onInviteEmail={(v) => { setInviteEmail(v); setError(''); }}
      onInvite={async () => { if (await post('/api/portal/seats/invite', { email: inviteEmail }, 'Seat reserved.')) setInviteEmail(''); }}
      onCancelInvite={(id) => void post('/api/portal/seats/invite/cancel', { inviteId: id }, 'Reservation cancelled.')}
      onRemove={(id) => void post('/api/portal/seats/remove', { memberId: id }, 'Seat removed.')}
      onCode={(v) => { setCode(v); setError(''); }}
      onRedeem={async () => { if (await post('/api/portal/seats/redeem', { code }, 'Plan activated.')) setCode(''); }}
      onApproveClaim={(id) => void post('/api/portal/seats/claims/approve', { claimId: id }, 'Accepted — they have a seat.')}
      onDeclineClaim={(id) => void post('/api/portal/seats/claims/decline', { claimId: id }, 'Declined.')}
    />
  );
}
