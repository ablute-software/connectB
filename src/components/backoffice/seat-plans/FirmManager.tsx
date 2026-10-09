'use client';
// Prompt 904 Adenda 1 (v2) — everything the back-office does on ONE firm, shared by sub-tab 1 ("Create plan",
// mode 'create') and the expanded row of sub-tab 2 ("Firms with a custom plan", mode 'expanded'):
//   plan  · who holds each seat · Add a person by email · requests waiting · codes bound to the firm.
// 'create' offers the creation form for a firm WITHOUT a plan and, for one that already has it, only a shortcut
// to sub-tab 2; 'expanded' edits the plan and can end it. The History lives in its own sub-tab now.
import { useEffect, useRef, useState } from 'react';
import { canDeleteSeatCode, createTabView, filterSeatCodes, seatCodeState } from '@/lib/seat-plans-view';
import { copyText, day, useFirmDetail, type Code, type Detail } from './shared';

export function FirmManager({ entityId, mode, onOpenInPlans, onEnded, onChanged }: {
  entityId: string;
  mode: 'create' | 'expanded';
  /** Sub-tab 1 only: open this firm in sub-tab 2. */
  onOpenInPlans?: (entityId: string) => void;
  /** Sub-tab 2 only: the plan was ended, go to "Ended plans". */
  onEnded?: () => void;
  onChanged?: () => void;
}) {
  const { detail, err, msg, newCode, act } = useFirmDetail(entityId, onChanged);

  const [seats, setSeats] = useState('10');
  const [planName, setPlanName] = useState('Private Detective');
  const [adminEmail, setAdminEmail] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [reassignTo, setReassignTo] = useState<Record<string, string>>({});
  const [codeSeats, setCodeSeats] = useState('10');
  const [codeDays, setCodeDays] = useState('30');
  const [showAllCodes, setShowAllCodes] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const codeRef = useRef<HTMLParagraphElement>(null);

  // The form starts from what the plan says. Re-read only when the plan itself changes (not on every reload).
  const planKey = detail?.plan ? `${detail.plan.seats}|${detail.plan.planName}|${detail.plan.adminEmail ?? ''}` : 'none';
  useEffect(() => {
    if (!detail) return;
    setSeats(String(detail.plan?.seats ?? detail.limit ?? 10));
    setPlanName(detail.plan?.planName ?? 'Private Detective');
    setAdminEmail(detail.plan?.adminEmail ?? '');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, detail?.entity.id]);
  useEffect(() => { setCopied(null); }, [newCode]);

  if (!detail) return <p className="p-3 text-xs text-gray-400">{err || 'Loading…'}</p>;
  const plan = detail.plan;
  const codes = filterSeatCodes(detail.codes, showAllCodes);
  const hiddenCodes = detail.codes.length - codes.length;

  return (
    <div className="space-y-4" data-testid={`firm-manager-${mode}`}>
      <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">{detail.entity.name}{detail.entity.is_test ? <span className="ml-2 rounded bg-gray-100 px-1 text-[10px] font-normal text-gray-500">test</span> : null}</h2>
          <span className="text-xs text-gray-600" data-testid="detail-counts">
            {plan ? `${plan.planName} · ` : 'No custom plan · '}{detail.used} of {detail.limit} in use · {detail.reserved} reserved · {detail.free} free
          </span>
        </div>

        {mode === 'create' && createTabView(!!plan) === 'shortcut' ? (
          <ExistingPlanShortcut onOpen={() => onOpenInPlans?.(entityId)} />
        ) : (
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
            <button type="button"
              onClick={() => act({ action: 'set_plan', seats: Number(seats), planName, adminEmail: adminEmail.trim() || null }, plan ? 'Plan updated.' : 'Plan assigned.')}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
              {plan ? 'Update plan' : 'Assign plan'}
            </button>
            {plan && mode === 'expanded' && (
              <button type="button"
                onClick={async () => {
                  if (!window.confirm(`End ${detail.entity.name}'s custom plan?\n\nThe firm goes back to its 1/2/5 tier and nobody is removed. The plan and who holds a seat right now are kept in "Ended plans".`)) return;
                  const r = await act({ action: 'end_plan' }, 'Plan ended.');
                  if (r?.ok) onEnded?.();
                }}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">End plan</button>
            )}
          </div>
        )}
        {err && <p role="alert" className="text-xs text-[#B00000]">{err}</p>}
        {msg && <p role="status" className="text-xs text-emerald-700">{msg}</p>}
      </div>

      <SeatHolders detail={detail} reassignTo={reassignTo} setReassignTo={setReassignTo} act={act} />

      {plan && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">Add a person by email</h3>
          <p className="mt-1 text-[11px] text-gray-500">
            If they already have an account they get a seat right now. If not, a seat is reserved for them. Either way they are told by email and on the platform.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" aria-label="Add a person by email"
              className="w-72 rounded-lg border border-gray-300 px-2 py-1 text-sm" />
            <button type="button" disabled={!addEmail.includes('@')}
              onClick={async () => {
                const email = addEmail.trim();
                const r = await act({ action: 'add_person', email }, (d) =>
                  `${d.outcome === 'added' ? `${email} now has a seat.` : `A seat is reserved for ${email} (no account yet).`} ${d.emailSent ? 'They were told by email.' : 'The email could not be sent, tell them yourself.'}`);
                if (r?.ok) setAddEmail('');
              }}
              className="rounded-lg border border-[#0E7490] px-3 py-1 text-sm font-medium text-[#0E7490] hover:bg-[#E8F4F8] disabled:opacity-40">Add person</button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="pending-claims">
        <h3 className="text-sm font-semibold text-gray-900">Requests waiting for approval</h3>
        <p className="mt-1 text-[11px] text-gray-500">
          People with this firm&apos;s email domain who claimed the profile. Same list the firm&apos;s own administrator sees; you can decide for them.
          Claims from other domains are reviewed in Investor claims.
        </p>
        {detail.pendingClaims.length === 0 ? <p className="mt-2 text-xs text-gray-400">Nobody is waiting.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-xs">
            {detail.pendingClaims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span><b className="text-gray-900">{c.email}</b> <span className="text-gray-400">asked {day(c.createdAt)}{c.requestedRole ? ` · as ${c.requestedRole}` : ''}</span></span>
                <span className="space-x-3">
                  <button type="button" className="font-medium text-[#0E7490] hover:underline" onClick={() => void act({ action: 'approve_claim', claimId: c.id }, `${c.email} approved and given a seat.`)}>Approve</button>
                  <button type="button" className="text-[#B00000] hover:underline"
                    onClick={() => { if (window.confirm(`Decline ${c.email}'s request? They will be told.`)) void act({ action: 'decline_claim', claimId: c.id }, `${c.email} declined.`); }}>Decline</button>
                </span>
              </li>
            ))}
          </ul>
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
          <button type="button" onClick={() => act({ action: 'create_code', seats: Number(codeSeats), validDays: Number(codeDays) }, 'Code created. Copy it now, it is not shown again.')}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">Create code</button>
        </div>
        {newCode && (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded bg-gray-900 px-3 py-2">
            <p ref={codeRef} className="select-all font-mono text-sm text-white" data-testid="new-code">{newCode}</p>
            <button type="button" data-testid="copy-code"
              onClick={async () => setCopied((await copyText(newCode, codeRef.current)) ? 'yes' : 'no')}
              className="rounded border border-white/60 px-2 py-0.5 text-xs font-semibold text-white hover:bg-white/10">Copy</button>
            {copied === 'yes' && <span role="status" className="text-xs text-emerald-300">Copied</span>}
            {copied === 'no' && <span role="status" className="text-xs text-amber-300">Could not copy: the code is selected, press Ctrl+C.</span>}
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={showAllCodes} onChange={(e) => setShowAllCodes(e.target.checked)} />
          Show used, revoked and expired{!showAllCodes && hiddenCodes > 0 ? ` (${hiddenCodes} hidden)` : ''}
        </label>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="text-gray-500"><tr><th className="py-1">Code</th><th>Seats</th><th>Status</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {codes.length === 0 && <tr><td colSpan={5} className="py-2 text-gray-400">{detail.codes.length === 0 ? 'No codes yet.' : 'No active codes.'}</td></tr>}
            {codes.map((c) => <CodeRow key={c.id} c={c} act={act} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Sub-tab 1 for a firm that already has an active plan: no creation form, just the way to its management. */
export function ExistingPlanShortcut({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-[#E8F4F8] px-3 py-2 text-sm text-gray-800" data-testid="already-has-plan">
      <span>This firm already has a custom plan</span>
      <button type="button" onClick={onOpen}
        className="rounded-lg border border-[#0E7490] bg-white px-3 py-1 text-xs font-semibold text-[#0E7490] hover:bg-[#E8F4F8]">
        Open in Firms with a custom plan
      </button>
    </div>
  );
}

type Act = (body: Record<string, unknown>, okMsg: string) => Promise<Record<string, unknown> | null>;

export function CodeRow({ c, act }: { c: Code; act: Act }) {
  const state = seatCodeState(c);
  return (
    <tr className="border-t border-gray-100" data-testid={`code-${c.codeHint}`}>
      <td className="py-1.5 font-mono">PD-…-{c.codeHint}</td><td>{c.seats}</td>
      <td>{state}</td><td>{day(c.expiresAt)}</td>
      <td className="space-x-3 whitespace-nowrap text-right">
        {state === 'used' && <span className="text-gray-500">Used on {day(c.redeemedAt)} by {c.redeemedByEmail ?? 'an account that no longer exists'}</span>}
        {state === 'active' && <button type="button" className="text-[#B00000] hover:underline" onClick={() => void act({ action: 'revoke_code', codeId: c.id }, 'Code revoked.')}>Revoke</button>}
        {canDeleteSeatCode(c) && (
          <button type="button" className="text-[#B00000] hover:underline"
            onClick={() => { if (window.confirm(`Delete code …${c.codeHint}? This cannot be undone. It stays in the firm's history that you deleted it.`)) void act({ action: 'delete_code', codeId: c.id }, 'Code deleted.'); }}>Delete</button>
        )}
      </td>
    </tr>
  );
}

function SeatHolders({ detail, reassignTo, setReassignTo, act }: {
  detail: Detail; reassignTo: Record<string, string>; setReassignTo: (f: (s: Record<string, string>) => Record<string, string>) => void; act: Act;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Who holds each seat</h3>
      <table className="mt-2 w-full text-left text-xs">
        <thead className="text-gray-500"><tr><th className="py-1">Person</th><th>Role</th><th>Since</th><th /></tr></thead>
        <tbody>
          {detail.members.length === 0 && detail.invites.length === 0 && <tr><td colSpan={4} className="py-2 text-gray-400">Nobody yet.</td></tr>}
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
    </div>
  );
}
