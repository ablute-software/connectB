'use client';
// Prompt 904 Part C (C3, C6) — back-office: seats of custom plans, per firm.
//   • Pre-assignment: pick a catalog profile and give it N seats BEFORE anyone has claimed it.
//   • Per firm: the plan, seats in use / reserved / free, who holds each seat since when, release,
//     reassign to another email, promote to administrator, reserve a seat, and the history.
//   • Entity-bound codes: create (shown ONCE), see their state, revoke.
// Never touch the real Portugal Ventures profile from tests: use a zz-test-… catalog entry.
import { useCallback, useEffect, useState } from 'react';

type FirmRow = { entityId: string; name: string; planName: string; seats: number; tier: string; adminEmail: string | null; activatedVia: string; used: number; reserved: number; free: number };
type Hit = { id: string; name: string; website: string | null; is_test: boolean | null };
type Member = { id: string; email: string | null; name: string | null; role: string | null; since: string | null };
type Invite = { id: string; email: string; createdAt: string };
type Code = { id: string; codeHint: string; seats: number; status: string; expiresAt: string; redeemedAt: string | null; createdAt: string };
type Ev = { id: number; event: string; email: string | null; actorUserId: string | null; detail: Record<string, unknown>; createdAt: string };
type Detail = {
  entity: { id: string; name: string; is_test: boolean | null };
  plan: { planName: string; seats: number; tier: string; adminEmail: string | null } | null;
  limit: number; used: number; reserved: number; free: number;
  members: Member[]; invites: Invite[]; codes: Code[]; events: Ev[];
};

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');
const post = async (body: Record<string, unknown>) => {
  const res = await fetch('/api/backoffice/investor-seats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json() as Promise<Record<string, unknown> & { ok: boolean; error?: string }>;
};

export default function SeatPlansPage() {
  const [firms, setFirms] = useState<FirmRow[] | null>(null);
  const [pending, setPending] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  const [seats, setSeats] = useState('10');
  const [planName, setPlanName] = useState('Private Detective');
  const [adminEmail, setAdminEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [codeSeats, setCodeSeats] = useState('10');
  const [codeDays, setCodeDays] = useState('30');
  const [reassignTo, setReassignTo] = useState<Record<string, string>>({});

  const loadList = useCallback(() => {
    fetch('/api/backoffice/investor-seats').then((r) => r.json()).then((d) => {
      if (d.migrationPending) { setPending(true); setFirms([]); return; }
      setFirms(d.ok ? d.firms : []);
    });
  }, []);
  const loadDetail = useCallback((id: string) => {
    fetch(`/api/backoffice/investor-seats?entityId=${id}`).then((r) => r.json()).then((d) => {
      if (!d.ok) { setErr(d.error ?? 'Could not load.'); return; }
      setDetail(d as Detail);
      setSeats(String(d.plan?.seats ?? d.limit ?? 10));
      setPlanName(d.plan?.planName ?? 'Private Detective');
      setAdminEmail(d.plan?.adminEmail ?? '');
    });
  }, []);
  useEffect(loadList, [loadList]);
  useEffect(() => { if (selected) loadDetail(selected); else setDetail(null); }, [selected, loadDetail]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/backoffice/investor-seats?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((d) => setHits(d.ok ? d.results : []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function act(body: Record<string, unknown>, okMsg: string) {
    if (!selected) return;
    setErr(''); setMsg(''); setNewCode(null);
    const d = await post({ entityId: selected, ...body });
    if (!d.ok) { setErr(d.error ?? 'Failed.'); return; }
    setMsg(okMsg);
    if (typeof d.code === 'string') setNewCode(d.code);
    loadDetail(selected); loadList();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-bold text-gray-900">Custom plan seats</h1>
      <p className="text-xs text-gray-500">
        Give a firm&apos;s catalog profile N seats before anyone has claimed it (pre-assignment), or create a code bound to that
        profile. Leave the real Portugal Ventures profile for when you decide to; tests go on a zz-test-… profile.
      </p>

      {pending && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          The database migration for custom seat plans has not been applied yet, so nothing here can be saved.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Firms with a custom plan</h2>
        {firms === null ? <p className="mt-2 text-xs text-gray-400">Loading…</p> : firms.length === 0 ? (
          <p className="mt-2 text-xs text-gray-400">None yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="text-gray-500"><tr><th className="py-1">Firm</th><th>Plan</th><th>Seats</th><th>In use</th><th>Reserved</th><th>Free</th><th>Via</th></tr></thead>
            <tbody>
              {firms.map((f) => (
                <tr key={f.entityId} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50" onClick={() => setSelected(f.entityId)}>
                  <td className="py-1.5 font-medium text-gray-900">{f.name}</td><td>{f.planName}</td><td>{f.seats}</td>
                  <td>{f.used}</td><td>{f.reserved}</td><td>{f.free}</td><td>{f.activatedVia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Pick a firm</h2>
        <input autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the catalog by name…" aria-label="Search the catalog"
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        {hits.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" onClick={() => { setSelected(h.id); setQ(''); setHits([]); }} className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-gray-50">
                  <span>{h.name}{h.is_test ? <span className="ml-2 rounded bg-gray-100 px-1 text-[10px] text-gray-500">test</span> : null}</span>
                  <span className="text-xs text-gray-400">{h.website ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail && selected && (
        <>
          <div className="rounded-lg border border-gray-200 bg-white space-y-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-gray-900">{detail.entity.name}</h2>
              <span className="text-xs text-gray-600" data-testid="detail-counts">
                {detail.plan ? `${detail.plan.planName} · ` : 'No custom plan · '}{detail.used} of {detail.limit} in use · {detail.reserved} reserved · {detail.free} free
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-gray-500">Seats
                <input type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(e.target.value)} autoComplete="off"
                  className="mt-0.5 block w-24 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-500">Plan name
                <input value={planName} onChange={(e) => setPlanName(e.target.value)} autoComplete="off"
                  className="mt-0.5 block w-48 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-500">Administrator email
                <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} autoComplete="off" placeholder="who administers the firm"
                  className="mt-0.5 block w-64 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
              <button type="button" onClick={() => act({ action: 'set_plan', seats: Number(seats), planName, adminEmail: adminEmail.trim() || null }, detail.plan ? 'Plan updated.' : 'Plan assigned.')}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
                {detail.plan ? 'Update plan' : 'Assign plan'}
              </button>
              {detail.plan && (
                <button type="button" onClick={() => { if (window.confirm('End this custom plan? The firm goes back to its 1/2/5 tier. Nobody is removed.')) void act({ action: 'end_plan' }, 'Plan ended.'); }}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">End plan</button>
              )}
            </div>
            {err && <p role="alert" className="text-xs text-[#B00000]">{err}</p>}
            {msg && <p role="status" className="text-xs text-emerald-700">{msg}</p>}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Who holds each seat</h3>
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-gray-500"><tr><th className="py-1">Person</th><th>Role</th><th>Since</th><th /></tr></thead>
              <tbody>
                {detail.members.map((m) => (
                  <tr key={m.id} className="border-t border-gray-100">
                    <td className="py-1.5"><span className="font-medium text-gray-900">{m.name ?? m.email}</span>{m.name && <span className="ml-2 text-gray-400">{m.email}</span>}</td>
                    <td>{m.role}</td><td>{day(m.since)}</td>
                    <td className="space-x-2 whitespace-nowrap text-right">
                      {m.role !== 'admin' && m.role !== 'owner' && <button type="button" className="text-[#0E7490] hover:underline" onClick={() => void act({ action: 'promote', memberId: m.id }, 'Promoted to administrator.')}>Make admin</button>}
                      <input value={reassignTo[m.id] ?? ''} onChange={(e) => setReassignTo((s) => ({ ...s, [m.id]: e.target.value }))} placeholder="reassign to email" autoComplete="off" aria-label="Reassign to email"
                        className="w-40 rounded border border-gray-300 px-1.5 py-0.5" />
                      <button type="button" disabled={!(reassignTo[m.id] ?? '').includes('@')} className="text-[#0E7490] hover:underline disabled:opacity-40"
                        onClick={() => void act({ action: 'reassign', memberId: m.id, toEmail: reassignTo[m.id] }, 'Seat reassigned.')}>Reassign</button>
                      <button type="button" className="text-[#B00000] hover:underline" onClick={() => { if (window.confirm(`Release ${m.email ?? 'this member'}'s seat?`)) void act({ action: 'release', memberId: m.id }, 'Seat released.'); }}>Release</button>
                    </td>
                  </tr>
                ))}
                {detail.invites.map((i) => (
                  <tr key={i.id} className="border-t border-gray-100 text-gray-500">
                    <td className="py-1.5">{i.email} <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">reserved</span></td><td>—</td><td>{day(i.createdAt)}</td>
                    <td className="text-right"><button type="button" className="text-[#B00000] hover:underline" onClick={() => void act({ action: 'cancel_invite', inviteId: i.id }, 'Reservation cancelled.')}>Cancel</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detail.plan && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Reserve a seat for this email" autoComplete="off" aria-label="Reserve a seat for this email"
                  className="w-72 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
                <button type="button" disabled={!inviteEmail.includes('@')} onClick={async () => { await act({ action: 'invite', email: inviteEmail }, 'Seat reserved.'); setInviteEmail(''); }}
                  className="rounded-lg border border-[#0E7490] px-3 py-1 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">Reserve seat</button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">Codes bound to this profile</h3>
            <p className="mt-1 text-[11px] text-gray-500">
              A code only works for someone with an approved claim and an active seat on THIS profile, once, before it expires. The code is shown once, here.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="text-xs text-gray-500">Seats
                <input type="number" min={1} max={500} value={codeSeats} onChange={(e) => setCodeSeats(e.target.value)} autoComplete="off" className="mt-0.5 block w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
              <label className="text-xs text-gray-500">Valid for (days)
                <input type="number" min={1} max={365} value={codeDays} onChange={(e) => setCodeDays(e.target.value)} autoComplete="off" className="mt-0.5 block w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm" /></label>
              <button type="button" onClick={() => act({ action: 'create_code', seats: Number(codeSeats), validDays: Number(codeDays) }, 'Code created — copy it now, it is not shown again.')}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">Create code</button>
            </div>
            {newCode && <p className="mt-2 rounded bg-gray-900 px-3 py-2 font-mono text-sm text-white" data-testid="new-code">{newCode}</p>}
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-gray-500"><tr><th className="py-1">Code</th><th>Seats</th><th>Status</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {detail.codes.map((c) => (
                  <tr key={c.id} className="border-t border-gray-100">
                    <td className="py-1.5 font-mono">PD-…-{c.codeHint}</td><td>{c.seats}</td>
                    <td>{c.status}{c.redeemedAt ? ` (${day(c.redeemedAt)})` : ''}</td><td>{day(c.expiresAt)}</td>
                    <td className="text-right">{c.status === 'active' && <button type="button" className="text-[#B00000] hover:underline" onClick={() => void act({ action: 'revoke_code', codeId: c.id }, 'Code revoked.')}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-gray-900">History</h3>
            <ul className="mt-2 space-y-1 text-xs text-gray-600">
              {detail.events.length === 0 && <li className="text-gray-400">Nothing yet.</li>}
              {detail.events.map((e) => (
                <li key={e.id}><span className="text-gray-400">{day(e.createdAt)}</span> · <b>{e.event.replace(/_/g, ' ')}</b>{e.email ? ` · ${e.email}` : ''}
                  {typeof e.detail.email === 'string' ? ` · ${e.detail.email}` : ''}{e.actorUserId ? ' · by admin' : ''}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
