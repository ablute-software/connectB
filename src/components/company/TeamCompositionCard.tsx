'use client';
// Prompt 613 §E — "para este negócio devemos ter mercado/comercial/relações
// públicas + técnico nisto + financeiro + etc, e sugere os atributos que
// faltam."
//
// Functions, not a head count. The card this stands beside used to say "only
// 0 named person(s)" to a founder with three founders on file; counting was
// never the useful question, and it was not even being counted from the right
// table.
//
// Every absent function offers BOTH exits (§E.4): give it to someone already
// here, or say it is a hire. That second button is what turns a list of holes
// into a plan — and a founder who has said "hiring: finance" has said
// something an investor can respect, where silence says nothing.
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui';

type State = 'covered' | 'thin' | 'absent' | 'hiring';

interface Role {
  key: string;
  label: string;
  why: string;
  state: State;
  owners: { id: string; name: string; title: string | null; commitment: 'full_time' | 'part_time' | null }[];
  note: string;
}
interface Payload {
  available: boolean;
  roles: Role[];
  summary: string | null;
  people?: { id: string; fullName: string; title: string | null }[];
}

const STATE_STYLE: Record<State, string> = {
  covered: 'bg-emerald-50 text-emerald-800',
  thin: 'bg-amber-50 text-amber-800',
  absent: 'bg-gray-100 text-gray-600',
  hiring: 'bg-cyan-50 text-cyan-800',
};
const STATE_LABEL: Record<State, string> = {
  covered: 'Covered', thin: 'Thin', absent: 'No owner', hiring: 'Hiring',
};

export function TeamCompositionCard({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/company/team-composition', { cache: 'no-store' })
      .then((r) => r.json())
      .then((body) => { if (body.ok) setData(body); })
      .catch(() => setData({ available: false, roles: [], summary: null }));
  }, []);
  useEffect(load, [load]);

  async function set(roleKey: string, patch: { personId?: string; hiring?: boolean; clear?: boolean }) {
    setBusyRole(roleKey); setErr('');
    const res = await fetch('/api/company/team-composition', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roleKey, ...patch }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Could not save.' }));
    setBusyRole(null);
    if (!res.ok) { setErr(res.error ?? 'Could not save.'); return; }
    load();
  }

  if (!data) return <Card title="What this team needs covered"><p className="text-sm text-gray-400">Loading…</p></Card>;
  if (!data.available) return null;

  return (
    <Card title="What this team needs covered">
      <p className="mb-3 text-xs text-gray-500">
        The functions this business needs, from your sector and stage — not a fixed list. A marketplace and a
        hardware company do not need the same things.
      </p>
      {data.summary && <p className="mb-3 text-sm text-gray-700">{data.summary}</p>}
      {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}

      <ul className="space-y-2">
        {data.roles.map((r) => (
          <li key={r.key} className="rounded-lg border border-gray-100 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATE_STYLE[r.state]}`}>{STATE_LABEL[r.state]}</span>
              <span className="text-sm font-medium text-gray-900">{r.label}</span>
              {r.owners.map((o) => (
                <span key={o.id} className="text-xs text-gray-500">
                  {o.name}{o.title ? ` · ${o.title}` : ''}{o.commitment === 'part_time' ? ' · part-time' : ''}
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs text-gray-500">{r.note}</p>

            {canEdit && (r.state === 'absent' || r.state === 'hiring') && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Exit one: it is already someone's job and the title did not say so. */}
                <select disabled={busyRole === r.key} defaultValue=""
                  onChange={(e) => { if (e.target.value) set(r.key, { personId: e.target.value }); }}
                  className="rounded border border-gray-300 px-2 py-1 text-xs">
                  <option value="">Assign to someone…</option>
                  {(data.people ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.fullName}{p.title ? ` — ${p.title}` : ''}</option>
                  ))}
                </select>
                {/* Exit two: nobody, and that is a decision rather than a hole. */}
                {r.state === 'hiring' ? (
                  <button disabled={busyRole === r.key} onClick={() => set(r.key, { clear: true })}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                    Not hiring after all
                  </button>
                ) : (
                  <button disabled={busyRole === r.key} onClick={() => set(r.key, { hiring: true })}
                    className="rounded-lg border border-[#0E7490] px-2 py-1 text-xs font-medium text-[#0E7490] hover:bg-cyan-50 disabled:opacity-40">
                    Mark as a hire
                  </button>
                )}
              </div>
            )}

            {canEdit && r.owners.length > 0 && (
              <button disabled={busyRole === r.key} onClick={() => set(r.key, { clear: true })}
                className="mt-1 text-[11px] text-gray-400 hover:text-gray-600 hover:underline disabled:opacity-40">
                Clear this assignment
              </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
