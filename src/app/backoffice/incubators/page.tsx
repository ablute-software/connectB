'use client';
// Prompt I-01 §C.1 — Backoffice › Incubadoras: list (name, kind, country,
// members, active relationships, is_test), create/edit (all A.1 fields; the
// D3 link picked from the catalog, "só para o aviso ao founder"), add
// owner/manager by e-mail, remove a member, close (reason; ends every live
// relationship with ended_by='platform'). Platform admins only.
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { INCUBATOR_KINDS, incubatorKindLabel } from '@/lib/incubators';

interface Member { id: string; role: 'owner' | 'manager'; status: 'invited' | 'active'; full_name: string | null; email: string | null }
interface Incubator {
  id: string; name: string; slug: string; kind: string; legal_name: string | null; vat_id: string | null; website: string | null;
  country: string | null; city: string | null; logo_url: string | null; description: string | null;
  related_catalog_entity_id: string | null; is_test: boolean; is_internal: boolean; closed_at: string | null; closed_reason: string | null;
  members: Member[]; active_relationships: number;
}

const EMPTY = {
  name: '', kind: 'other', legal_name: '', vat_id: '', website: '', country: 'PT', city: '', logo_url: '', description: '',
  related_catalog_entity_id: '', is_test: false, is_internal: false,
};
type Form = typeof EMPTY;

const inputCls = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm';
const btn = 'rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50';
const ghost = 'rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-50';

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false, error: 'Invalid response.' }));
}

function CatalogPicker({ value, onChange }: { value: string; onChange: (id: string, name?: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/backoffice/incubators/catalog-search?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => setResults(d.results ?? []));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="text-xs text-gray-600 sm:col-span-2">
      Investor organisation of the same house (D3) — <em>only for the founder notice</em>
      <div className="mt-1 flex gap-2">
        <input className={inputCls} placeholder="Search the catalog…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {value && <button className={ghost} onClick={() => onChange('')}>Clear link</button>}
      </div>
      {value && <div className="mt-1 text-[11px] text-gray-500">Linked to {value}</div>}
      {results.length > 0 && (
        <ul className="mt-1 rounded-lg border border-gray-100 bg-white">
          {results.map((r) => (
            <li key={r.id}><button className="w-full px-2 py-1 text-left text-sm hover:bg-gray-50" onClick={() => { onChange(r.id, r.name); setQ(''); setResults([]); }}>{r.name}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IncubatorForm({ initial, submitLabel, onSubmit }: { initial: Form; submitLabel: string; onSubmit: (f: Form) => Promise<string | null> }) {
  const [f, setF] = useState<Form>(initial);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const txt = (k: keyof Form, label: string) => (
    <label className="text-xs text-gray-600">{label}<input className={inputCls} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete="off" /></label>
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="incubator-form">
      {txt('name', 'Name *')}
      <label className="text-xs text-gray-600">Type
        <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {INCUBATOR_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </label>
      {txt('legal_name', 'Legal name')}
      {txt('vat_id', 'VAT number (NIF)')}
      {txt('website', 'Website')}
      {txt('country', 'Country')}
      {txt('city', 'City')}
      {txt('logo_url', 'Logo (URL)')}
      <label className="text-xs text-gray-600 sm:col-span-2">Description<textarea className={inputCls} rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <CatalogPicker value={f.related_catalog_entity_id} onChange={(id) => setF({ ...f, related_catalog_entity_id: id })} />
      <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={f.is_test} onChange={(e) => setF({ ...f, is_test: e.target.checked })} /> is_test (verification fixture)</label>
      <label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={f.is_internal} onChange={(e) => setF({ ...f, is_internal: e.target.checked })} /> is_internal</label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className={btn} disabled={busy || !f.name.trim()} onClick={async () => { setBusy(true); setMsg(''); const e = await onSubmit(f); setMsg(e ?? 'Saved.'); setBusy(false); }}>{submitLabel}</button>
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

function IncubatorRow({ inc, onChanged }: { inc: Incubator; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'owner' | 'manager'>('owner');
  const [msg, setMsg] = useState('');

  async function addMember() {
    const r = await send(`/api/backoffice/incubators/${inc.id}/members`, 'POST', { email, role });
    setMsg(r.ok ? (r.emailSent ? 'Invite sent.' : `Member created; the email did not go out${r.emailError ? ` (${r.emailError})` : ''}.`) : r.error ?? 'Error.');
    if (r.ok) { setEmail(''); onChanged(); }
  }
  async function removeMember(id: string) {
    if (!window.confirm('Remove this member?')) return;
    const r = await send(`/api/backoffice/incubators/${inc.id}/members/${id}`, 'DELETE');
    if (!r.ok) setMsg(r.error ?? 'Error.');
    onChanged();
  }
  async function close() {
    const reason = window.prompt(`Close ${inc.name}? Every live relationship ends (ended_by = platform). Reason:`);
    if (!reason?.trim()) return;
    const r = await send(`/api/backoffice/incubators/${inc.id}/close`, 'POST', { reason });
    setMsg(r.ok ? `Closed; ${r.relationshipsEnded} relationship(s) ended.` : r.error ?? 'Error.');
    onChanged();
  }

  const initial: Form = {
    name: inc.name, kind: inc.kind, legal_name: inc.legal_name ?? '', vat_id: inc.vat_id ?? '', website: inc.website ?? '',
    country: inc.country ?? '', city: inc.city ?? '', logo_url: inc.logo_url ?? '', description: inc.description ?? '',
    related_catalog_entity_id: inc.related_catalog_entity_id ?? '', is_test: inc.is_test, is_internal: inc.is_internal,
  };

  return (
    <>
      <tr className="border-b border-gray-50 align-top">
        <td className="py-2 pr-3 font-medium text-gray-900">{inc.name}{inc.closed_at && <span className="ml-2 rounded bg-gray-100 px-1.5 text-[10px] text-gray-500">closed</span>}</td>
        <td className="pr-3 text-gray-600">{incubatorKindLabel(inc.kind)}</td>
        <td className="pr-3 text-gray-600">{inc.country ?? '—'}</td>
        <td className="pr-3 text-gray-600">{inc.members.length}</td>
        <td className="pr-3 text-gray-600">{inc.active_relationships}</td>
        <td className="pr-3 text-gray-600">{inc.is_test ? 'yes' : '—'}</td>
        <td className="py-1.5 text-right"><button className={ghost} onClick={() => setOpen((v) => !v)}>{open ? 'Collapse' : 'Open'}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={7} className="bg-gray-50/60 p-4">
          <div className="space-y-4">
            <IncubatorForm initial={initial} submitLabel="Save changes" onSubmit={async (f) => {
              const r = await send(`/api/backoffice/incubators/${inc.id}`, 'PATCH', f); onChanged(); return r.ok ? null : r.error ?? 'Error.';
            }} />
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">Members</div>
              <ul className="text-sm">
                {inc.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-1">
                    <span className="text-gray-900">{m.full_name ?? m.email}</span><span className="text-xs text-gray-500">{m.email}</span>
                    <span className="text-xs text-gray-500">{m.role}</span><span className="text-xs text-gray-400">{m.status}</span>
                    <button className={`${ghost} ml-auto text-red-700`} onClick={() => removeMember(m.id)}>Remove</button>
                  </li>
                ))}
                {inc.members.length === 0 && <li className="text-gray-400">No members.</li>}
              </ul>
              {!inc.closed_at && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-gray-600">Email<input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></label>
                  <label className="text-xs text-gray-600">Role
                    <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'manager')}><option value="owner">owner</option><option value="manager">manager</option></select>
                  </label>
                  <button className={btn} disabled={!email.trim()} onClick={addMember}>Add and send invite</button>
                </div>
              )}
            </div>
            {!inc.closed_at ? <button className={`${ghost} text-red-700`} onClick={close}>Close incubator…</button>
              : <p className="text-xs text-gray-500">Closed: {inc.closed_reason}</p>}
            {msg && <p className="text-xs text-gray-600">{msg}</p>}
          </div>
        </td></tr>
      )}
    </>
  );
}

export default function BackofficeIncubatorsPage() {
  const [list, setList] = useState<Incubator[] | null>(null);
  const [err, setErr] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    fetch('/api/backoffice/incubators').then((r) => r.json()).then((d) => {
      if (d.ok) setList(d.incubators); else { setErr(d.error ?? 'Could not load.'); setList([]); }
    }).catch(() => { setErr('Could not load.'); setList([]); });
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Incubators</h1>
        <p className="text-sm text-gray-500">Incubation/acceleration organisations and their teams. An incubator is never a startup org, and its managers never get access_grants.</p>
      </div>
      {err && <p className="text-xs text-red-600">{err === 'not configured' ? 'Demo mode — the back-office needs a connected database.' : err}</p>}
      <Card title="New incubator" right={<button className={ghost} onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : 'Create'}</button>}>
        {creating && <IncubatorForm initial={EMPTY} submitLabel="Create incubator" onSubmit={async (f) => {
          const r = await send('/api/backoffice/incubators', 'POST', f);
          if (r.ok) { setCreating(false); load(); return null; }
          return r.error ?? 'Error.';
        }} />}
      </Card>
      <Card title="All incubators">
        {!list ? <p className="text-sm text-gray-400">Loading…</p> : list.length === 0 ? <p className="text-sm text-gray-400">No incubators yet.</p> : (
          <table className="w-full text-left text-sm" data-testid="incubators-table">
            <thead><tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-2 pr-3">Name</th><th className="pr-3">Type</th><th className="pr-3">Country</th><th className="pr-3">Members</th><th className="pr-3">Active relationships</th><th className="pr-3">is_test</th><th />
            </tr></thead>
            <tbody>{list.map((i) => <IncubatorRow key={i.id} inc={i} onChanged={load} />)}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
