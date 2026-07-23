'use client';
// IRM_SPEC §1a — authored contributions ("Add info", made real). Writes go
// straight to the org's own contributions row (RLS-scoped) and are shown
// back immediately; §1b's back-office verification reads the same table
// across every org. Demo mode has no real backend, so it falls back to the
// old placeholder acknowledgment.
//
// Batch 2 item 4 — conflict-display cleanup. Import-conflict rows (from
// src/app/api/import/structured/commit and .../import/md/commit — their
// notes literally say "existing: X vs imported: Y") used to render that raw
// note text directly on this founder page: backend jargon, a leaked §9b
// reference, and it repeated what the field above already shows. They now
// collapse to a small "por verificar" pill; clicking it opens a compact
// compare popover instead. Detection is a plain substring check on the note
// (both generators' notes contain "conflict") — a client-side display
// heuristic only, not a data contract, so it's fine that it's not bulletproof.
import { useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { AddInfoButton, PrivateBadge } from '@/components/ui';

type ContributionStatus = 'submitted' | 'verified' | 'rejected';
type Contribution = { id: string; field: string; value: unknown; note: string | null; status: ContributionStatus; created_at: string };

const STATUS_STYLE: Record<ContributionStatus, string> = {
  submitted: 'bg-amber-100 text-amber-800',
  verified: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

function isConflictRow(c: Contribution): boolean {
  return c.status === 'submitted' && !!c.note && /conflict/i.test(c.note);
}

export function ContributionBox({ subjectType, subjectId, orgId, subject, onApplyValue }: {
  subjectType: 'entity' | 'person'; subjectId: string; orgId: string;
  // The current entity/person record (for "valor atual" in the conflict
  // popover) and a callback that writes an accepted imported value onto it
  // (via the caller's updateEntity/updatePerson store action) — both
  // optional so existing callers that don't pass them still work exactly
  // as before, just without conflict-resolution capability.
  subject?: Record<string, unknown>;
  onApplyValue?: (field: string, value: unknown) => void;
}) {
  const [items, setItems] = useState<Contribution[]>([]);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflictPopover, setConflictPopover] = useState<Contribution | null>(null);
  const [resolving, setResolving] = useState(false);

  function refresh() {
    browserClient().from('contributions').select('id, field, value, note, status, created_at')
      .eq('subject_type', subjectType).eq('subject_id', subjectId).eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setItems((data as Contribution[] | null) ?? []));
  }

  useEffect(() => {
    if (!authEnabled) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId, orgId]);

  async function submit() {
    setBusy(true);
    try {
      await browserClient().from('contributions').insert({
        subject_type: subjectType, subject_id: subjectId, org_id: orgId,
        field, value, note: note || null,
      });
      setField(''); setValue(''); setNote(''); setOpen(false);
      refresh();
    } finally { setBusy(false); }
  }

  async function resolveConflict(decision: 'keep_existing' | 'use_imported') {
    if (!conflictPopover) return;
    setResolving(true);
    try {
      const res = await fetch('/api/contributions/resolve', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contributionId: conflictPopover.id, decision }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error ?? 'Could not resolve.');
      if (decision === 'use_imported') onApplyValue?.(conflictPopover.field, conflictPopover.value);
      setConflictPopover(null);
      refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setResolving(false);
    }
  }

  if (!authEnabled) return <AddInfoButton />;

  return (
    <div>
      <div className="flex items-center gap-2">
        <PrivateBadge />
        {!open && <button onClick={() => setOpen(true)} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50">+ Add info</button>}
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
          <input value={field} onChange={(e) => setField(e.target.value)} placeholder="Field (e.g. co-investor, portfolio highlight)"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional — how do you know this?)"
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs" />
          <div className="flex gap-2">
            <button disabled={busy || !field || !value} onClick={submit}
              className="rounded bg-[#0E7490] px-2 py-1 text-xs font-medium text-white disabled:opacity-40">Submit</button>
            <button onClick={() => setOpen(false)} className="rounded border border-gray-300 px-2 py-1 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div className="mt-2 space-y-1">
          {items.map((c) => (
            <div key={c.id} className="text-xs text-gray-600">
              <span className="font-medium">{c.field}:</span>{' '}
              {isConflictRow(c) ? (
                <button onClick={() => setConflictPopover(c)}
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-200">
                  por verificar
                </button>
              ) : (
                <>
                  {String(c.value)}
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {conflictPopover && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
          <div className="font-semibold text-amber-900">{conflictPopover.field}</div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <div><div className="text-gray-500">Valor atual</div><div className="font-medium">{String(subject?.[conflictPopover.field] ?? '—')}</div></div>
            <div><div className="text-gray-500">Valor importado</div><div className="font-medium">{String(conflictPopover.value)}</div></div>
          </div>
          <div className="mt-2 flex gap-2">
            <button disabled={resolving} onClick={() => resolveConflict('keep_existing')}
              className="rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-40">Manter</button>
            <button disabled={resolving || !onApplyValue} onClick={() => resolveConflict('use_imported')}
              className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">Usar importado</button>
            <button onClick={() => setConflictPopover(null)} className="ml-auto rounded border border-gray-300 bg-white px-2 py-1 text-gray-500 hover:bg-gray-100">Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
