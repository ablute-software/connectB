'use client';
// IRM_SPEC §1a — authored contributions ("Add info", made real). Writes go
// straight to the org's own contributions row (RLS-scoped) and are shown
// back immediately; §1b's back-office verification reads the same table
// across every org. Demo mode has no real backend, so it falls back to the
// old placeholder acknowledgment.
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

export function ContributionBox({ subjectType, subjectId, orgId }: {
  subjectType: 'entity' | 'person'; subjectId: string; orgId: string;
}) {
  const [items, setItems] = useState<Contribution[]>([]);
  const [open, setOpen] = useState(false);
  const [field, setField] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

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
              <span className="font-medium">{c.field}:</span> {String(c.value)}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[c.status]}`}>{c.status}</span>
              {c.note && <span className="ml-1 text-gray-400">— {c.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
