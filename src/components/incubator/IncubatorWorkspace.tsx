'use client';
// Prompt I-01 §C.3 — the incubator workspace: Portfolio, Team, Settings
// (English since I-01b §C).
// The other tabs of v4 §4 arrive with their own prompts; no dead entries here.
// A separate shell (like InvestorWorkspaceShell), not the founder Shell: the
// two audiences share no navigation. Everything reads /api/incubator/**,
// which starts from requireIncubatorMember() — the incubator reads only its
// own tables plus incubator_portfolio() (level-0 fields).
import { CallsWorkspace } from '@/components/calls/CallsWorkspace';
import { useCallsAccess } from '@/components/calls/useCallsAccess';
import { useCallback, useEffect, useState } from 'react';
import { WorkspaceSidebar } from '@/components/workspace-shell/WorkspaceSidebar';
import { LogoutButton } from '@/components/workspace-shell/LogoutButton';
import type { WorkspaceNavItem } from '@/components/workspace-shell/types';
import { Card } from '@/components/ui';
import { BRAND_NAME } from '@/lib/brand';
import { HatSwitcher } from './HatSwitcher';
import {
  ALSO_INVESTS_NOTICE, INCUBATOR_KINDS, INCUBATOR_MEMBER_INVITE_STORAGE_KEY, incubatorMemberInvitePath, INVITE_STATUS_LABEL, RELATIONSHIP_STATUS_LABEL,
  incubatorCanSetStatus, incubatorKindLabel, sharingLevelName,
  type InviteStatus, type RelationshipStatus,
} from '@/lib/incubators';
import { DEMO_INCUBATOR, DEMO_PORTFOLIO, DEMO_TEAM } from '@/lib/incubator-demo';

type Tab = 'portfolio' | 'calls' | 'team' | 'settings';

interface MeResponse {
  ok: boolean; demo?: boolean; error?: string;
  member?: { id: string; role: 'owner' | 'manager'; email: string | null };
  incubator?: {
    id: string; name: string; slug: string; kind: string; website: string | null; country: string | null; city: string | null;
    logo_url: string | null; description: string | null; is_test: boolean; alsoInvests: boolean;
  };
}
interface PortfolioRow {
  relationship_id: string; org_id: string; startup_name: string; sector: string | null; stage: string | null;
  cohort_id: string | null; cohort_name: string | null; status: RelationshipStatus; sharing_level: number;
  manager_member_id: string | null; manager_name: string | null; started_at: string; has_live_access: boolean;
}
interface InviteRow {
  id: string; email: string; startup_name: string | null; sector: string | null; website: string | null; cohort_id: string | null;
  status: InviteStatus; sent_at: string | null; last_sent_at: string | null; send_count: number; token_expires_at: string; created_at: string;
}
interface Cohort { id: string; name: string; starts_on: string | null; ends_on: string | null; archived_at: string | null }
interface TeamRow {
  member_id: string; user_id: string | null; email: string | null; full_name: string | null; title: string | null;
  role: 'owner' | 'manager'; status: 'invited' | 'active'; accepted_at: string | null; created_at: string;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function postJson(url: string, body?: unknown, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json().catch(() => ({ ok: false, error: 'Invalid server response.' }));
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:border-[#0E7490] focus:outline-none';
const btnPrimary = 'rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f75] disabled:opacity-50';
const btnGhost = 'rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-[#0E7490] disabled:opacity-50';

// ---------------------------------------------------------------------------
function InviteForm({ cohorts, demo, onDone }: { cohorts: Cohort[]; demo: boolean; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [startupName, setStartupName] = useState('');
  const [sector, setSector] = useState('');
  const [website, setWebsite] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    setBusy(true); setMsg('');
    try {
      const r = await postJson('/api/incubator/invites', { email, startupName, sector, website, cohortId: cohortId || null });
      if (!r.ok) { setMsg(r.error ?? 'Could not create the invite.'); return; }
      setMsg(r.emailSent ? 'Invite sent.' : `Invite created, but the email did not go out${r.emailError ? ` (${r.emailError})` : ''}. You can resend it from the list below.`);
      setEmail(''); setStartupName(''); setSector(''); setWebsite('');
      onDone();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 grid gap-2 rounded-xl border border-gray-100 bg-gray-50/60 p-3 sm:grid-cols-2" data-testid="invite-form">
      <label className="text-xs text-gray-600">Founder email *<input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" /></label>
      <label className="text-xs text-gray-600">Startup name<input className={inputCls} value={startupName} onChange={(e) => setStartupName(e.target.value)} autoComplete="off" /></label>
      <label className="text-xs text-gray-600">Sector<input className={inputCls} value={sector} onChange={(e) => setSector(e.target.value)} autoComplete="off" /></label>
      <label className="text-xs text-gray-600">Website<input className={inputCls} value={website} onChange={(e) => setWebsite(e.target.value)} autoComplete="off" /></label>
      <label className="text-xs text-gray-600">Cohort
        <select className={inputCls} value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
          <option value="">No cohort</option>
          {cohorts.filter((c) => !c.archived_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-gray-600">Voucher
        {/* I-01: no promo code belongs to an incubator yet — never list the
            global ones here. The protocols arrive in I-02. */}
        <select className={inputCls} disabled value="">
          <option value="">no vouchers available — protocols arrive in I-02</option>
        </select>
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button className={btnPrimary} disabled={busy || demo || !email.trim()} onClick={submit}>{busy ? 'Sending…' : 'Send invite'}</button>
        {demo && <span className="text-xs text-amber-700">Demo mode — nothing is sent.</span>}
        {msg && <span className="text-xs text-gray-600">{msg}</span>}
      </div>
    </div>
  );
}

function PortfolioPanel({ demo }: { demo: boolean }) {
  const [data, setData] = useState<{ relationships: PortfolioRow[]; invites: InviteRow[]; cohorts: Cohort[] } | null>(null);
  const [err, setErr] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (demo) { setData(DEMO_PORTFOLIO as never); return; }
    fetch('/api/incubator/portfolio').then((r) => r.json()).then((d) => {
      if (!d.ok) { setErr(d.error ?? 'Could not load the portfolio.'); return; }
      setData(d);
    }).catch(() => setErr('Could not load the portfolio.'));
  }, [demo]);
  useEffect(load, [load]);

  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key); setErr('');
    try {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? 'Could not complete that.');
      load();
    } finally { setBusy(null); }
  }

  function endRelationship(row: PortfolioRow) {
    const reason = window.prompt(`End the relationship with ${row.startup_name}? A reason is required — the founder will see it.`);
    if (reason === null) return;
    if (!reason.trim()) { setErr('Give a reason — the founder will see it.'); return; }
    act(`end-${row.relationship_id}`, () => postJson(`/api/incubator/relationships/${row.relationship_id}/end`, { reason }));
  }

  const rows = data?.relationships ?? [];
  const cohortName = (id: string | null) => data?.cohorts.find((c) => c.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <Card title="Portfolio" right={<button className={btnPrimary} onClick={() => setShowInvite((v) => !v)} data-testid="invite-startup-button">Invite startup</button>}>
        {showInvite && <InviteForm cohorts={data?.cohorts ?? []} demo={demo} onDone={load} />}
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
        {!data ? <p className="mt-3 text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-gray-200 p-6 text-center">
            <p className="text-sm text-gray-600">No startups linked yet.</p>
            <p className="mt-1 text-xs text-gray-400">Each startup joins when its founder accepts the invite.</p>
            <button className={`${btnPrimary} mt-3`} onClick={() => setShowInvite(true)}>Invite startup</button>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="portfolio-table">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-2 pr-3">Startup</th><th className="pr-3">Sector</th><th className="pr-3">Stage</th><th className="pr-3">Cohort</th>
                  <th className="pr-3">Status</th><th className="pr-3">Sharing</th><th className="pr-3">Manager</th><th className="pr-3">Since</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.relationship_id} className="border-b border-gray-50 align-top">
                    <td className="py-2 pr-3 font-medium text-gray-900">{r.startup_name}</td>
                    <td className="pr-3 text-gray-600">{r.sector ?? '—'}</td>
                    <td className="pr-3 text-gray-600">{r.stage ?? '—'}</td>
                    <td className="pr-3 text-gray-600">{r.cohort_name ?? '—'}</td>
                    <td className="pr-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === 'active' ? 'bg-emerald-50 text-emerald-700' : r.status === 'graduated' ? 'bg-cyan-50 text-cyan-700' : 'bg-amber-50 text-amber-700'}`}>{RELATIONSHIP_STATUS_LABEL[r.status]}</span></td>
                    <td className="pr-3 text-gray-600">{r.has_live_access ? sharingLevelName(r.sharing_level) : 'No access (paused)'}</td>
                    <td className="pr-3 text-gray-600">{r.manager_name ?? '—'}</td>
                    <td className="pr-3 text-gray-600">{fmtDate(r.started_at)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right">
                      {incubatorCanSetStatus(r.status, 'paused') && <button className={btnGhost} disabled={demo || !!busy} onClick={() => act(`p-${r.relationship_id}`, () => postJson(`/api/incubator/relationships/${r.relationship_id}/status`, { status: 'paused' }))}>Pause</button>}
                      {incubatorCanSetStatus(r.status, 'active') && <button className={btnGhost} disabled={demo || !!busy} onClick={() => act(`a-${r.relationship_id}`, () => postJson(`/api/incubator/relationships/${r.relationship_id}/status`, { status: 'active' }))}>Resume</button>}
                      {incubatorCanSetStatus(r.status, 'graduated') && <button className={`${btnGhost} ml-1`} disabled={demo || !!busy} onClick={() => act(`g-${r.relationship_id}`, () => postJson(`/api/incubator/relationships/${r.relationship_id}/status`, { status: 'graduated' }))}>Graduate</button>}
                      <button className={`${btnGhost} ml-1 text-red-700`} disabled={demo || !!busy} onClick={() => endRelationship(r)}>End</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Pending invites">
        {(data?.invites ?? []).length === 0 ? <p className="text-sm text-gray-400">No pending invites.</p> : (
          <ul className="divide-y divide-gray-50" data-testid="pending-invites">
            {(data?.invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium text-gray-900">{i.startup_name ?? i.email}</span>
                <span className="text-xs text-gray-500">{i.email}</span>
                <span className="text-xs text-gray-400">{cohortName(i.cohort_id)}</span>
                <span className="text-xs text-gray-400">Sent {fmtDate(i.last_sent_at ?? i.sent_at)}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{INVITE_STATUS_LABEL[i.status]}</span>
                <span className="ml-auto flex gap-1">
                  <button className={btnGhost} disabled={demo || !!busy} onClick={() => act(`r-${i.id}`, () => postJson(`/api/incubator/invites/${i.id}/resend`))}>Resend</button>
                  <button className={`${btnGhost} text-red-700`} disabled={demo || !!busy} onClick={() => act(`v-${i.id}`, () => postJson(`/api/incubator/invites/${i.id}/revoke`))}>Revoke</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TeamPanel({ demo, isOwner }: { demo: boolean; isOwner: boolean }) {
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (demo) { setRows(DEMO_TEAM as TeamRow[]); setMyId('demo-member-owner'); return; }
    fetch('/api/incubator/team').then((r) => r.json()).then((d) => {
      if (d.ok) { setRows(d.members); setMyId(d.myMemberId); } else setMsg(d.error ?? 'Could not load the team.');
    });
  }, [demo]);
  useEffect(load, [load]);

  async function add() {
    setBusy(true); setMsg('');
    try {
      const r = await postJson('/api/incubator/team', { email, fullName: name, role: 'manager' });
      if (!r.ok) { setMsg(r.error ?? 'Could not send the invite.'); return; }
      setMsg(r.emailSent ? 'Invite sent.' : 'Invite created, but the email did not go out.');
      setEmail(''); setName(''); load();
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm('Remove this member? They lose access to the workspace.')) return;
    const r = await fetch(`/api/incubator/team/${id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) setMsg(r.error ?? 'Could not remove.');
    load();
  }

  return (
    <Card title="Team">
      {!rows ? <p className="text-sm text-gray-400">Loading…</p> : (
        <table className="w-full text-left text-sm" data-testid="team-table">
          <thead><tr className="border-b border-gray-100 text-[11px] uppercase tracking-wide text-gray-400"><th className="py-2 pr-3">Name</th><th className="pr-3">Email</th><th className="pr-3">Role</th><th className="pr-3">Status</th><th /></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.member_id} className="border-b border-gray-50">
                <td className="py-2 pr-3 text-gray-900">{m.full_name ?? '—'}</td>
                <td className="pr-3 text-gray-600">{m.email ?? '—'}</td>
                <td className="pr-3 text-gray-600">{m.role === 'owner' ? 'Owner' : 'Manager'}</td>
                <td className="pr-3 text-gray-600">{m.status === 'active' ? 'Active' : 'Invited'}</td>
                <td className="py-1.5 text-right">{isOwner && m.member_id !== myId && <button className={`${btnGhost} text-red-700`} disabled={demo} onClick={() => remove(m.member_id)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isOwner && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Email<input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" /></label>
          <label className="text-xs text-gray-600">Name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          <button className={btnPrimary} disabled={demo || busy || !email.trim()} onClick={add}>Add manager</button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-gray-600">{msg}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function SettingsPanel({ me, demo, onSaved }: { me: MeResponse; demo: boolean; onSaved: () => void }) {
  const inc = me.incubator!;
  const isOwner = me.member?.role === 'owner';
  const [form, setForm] = useState({ name: inc.name, kind: inc.kind, website: inc.website ?? '', city: inc.city ?? '', logo_url: inc.logo_url ?? '', description: inc.description ?? '' });
  const [msg, setMsg] = useState('');
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortName, setCohortName] = useState('');

  const loadCohorts = useCallback(() => {
    if (demo) { setCohorts(DEMO_PORTFOLIO.cohorts); return; }
    fetch('/api/incubator/portfolio').then((r) => r.json()).then((d) => { if (d.ok) setCohorts(d.cohorts); });
  }, [demo]);
  useEffect(loadCohorts, [loadCohorts]);

  async function save() {
    setMsg('');
    const r = await postJson('/api/incubator/profile', form, 'PATCH');
    setMsg(r.ok ? 'Saved.' : r.error ?? 'Could not save.');
    if (r.ok) onSaved();
  }
  async function addCohort() {
    const r = await postJson('/api/incubator/cohorts', { name: cohortName });
    if (!r.ok) { setMsg(r.error ?? 'Could not create the cohort.'); return; }
    setCohortName(''); loadCohorts();
  }
  async function archiveCohort(id: string, archived: boolean) {
    await postJson(`/api/incubator/cohorts/${id}`, { archived }, 'PATCH');
    loadCohorts();
  }

  const field = (key: keyof typeof form, label: string) => (
    <label className="text-xs text-gray-600">{label}
      <input className={inputCls} value={form[key]} disabled={!isOwner || demo} onChange={(e) => setForm({ ...form, [key]: e.target.value })} autoComplete="off" />
    </label>
  );

  return (
    <div className="space-y-4">
      <Card title="Organisation profile">
        <div className="grid gap-2 sm:grid-cols-2">
          {field('name', 'Name')}
          <label className="text-xs text-gray-600">Type
            <select className={inputCls} value={form.kind} disabled={!isOwner || demo} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {INCUBATOR_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          {field('website', 'Website')}
          {field('city', 'City')}
          {field('logo_url', 'Logo (URL)')}
          <label className="text-xs text-gray-600 sm:col-span-2">Description
            <textarea className={inputCls} rows={3} value={form.description} disabled={!isOwner || demo} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </div>
        {isOwner ? (
          <div className="mt-3 flex items-center gap-3"><button className={btnPrimary} disabled={demo} onClick={save}>Save</button>{msg && <span className="text-xs text-gray-600">{msg}</span>}</div>
        ) : <p className="mt-2 text-xs text-gray-400">Only the owner edits the profile.</p>}
      </Card>

      <Card title="Related investor organisation">
        {inc.alsoInvests ? (
          <p className="text-sm text-gray-700">This house has an investor organisation on Sherlock. Founders see this notice when they accept: <em>“{ALSO_INVESTS_NOTICE}”</em></p>
        ) : <p className="text-sm text-gray-500">No investor organisation linked.</p>}
        <p className="mt-2 text-xs text-gray-400">The link exists only for the founder notice; the platform never joins data across the two sides. Only the back-office changes it.</p>
      </Card>

      <Card title="Cohorts">
        <ul className="divide-y divide-gray-50 text-sm">
          {cohorts.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-1.5">
              <span className={c.archived_at ? 'text-gray-400 line-through' : 'text-gray-900'}>{c.name}</span>
              <span className="text-xs text-gray-400">{c.starts_on ? fmtDate(c.starts_on) : ''}{c.ends_on ? ` → ${fmtDate(c.ends_on)}` : ''}</span>
              <button className={`${btnGhost} ml-auto`} disabled={demo} onClick={() => archiveCohort(c.id, !c.archived_at)}>{c.archived_at ? 'Restore' : 'Archive'}</button>
            </li>
          ))}
          {cohorts.length === 0 && <li className="py-1.5 text-gray-400">No cohorts yet.</li>}
        </ul>
        <div className="mt-3 flex items-end gap-2">
          <label className="text-xs text-gray-600">New cohort<input className={inputCls} value={cohortName} onChange={(e) => setCohortName(e.target.value)} placeholder="Cohort 2026-A" autoComplete="off" /></label>
          <button className={btnPrimary} disabled={demo || !cohortName.trim()} onClick={addCohort}>Create</button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function IncubatorWorkspace() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tab, setTab] = useState<Tab>('portfolio');
  // Prompt 905 — the Calls tab, behind CALLS_MODE: the server answers 404 and the tab never shows when it is off.
  const callsEnabled = useCallsAccess('incubator');

  const loadMe = useCallback(() => {
    fetch('/api/incubator/me').then((r) => r.json()).then((d: MeResponse) => {
      setMe(d.demo ? { ok: true, demo: true, ...DEMO_INCUBATOR } : d);
    }).catch(() => setMe({ ok: false, error: 'network' }));
  }, []);
  useEffect(loadMe, [loadMe]);

  // A team invite accepted after a login detour: the token waited in this
  // browser, never in the login URL.
  useEffect(() => {
    if (!me || me.ok) return;
    try {
      const pending = window.localStorage.getItem(INCUBATOR_MEMBER_INVITE_STORAGE_KEY);
      if (pending) window.location.replace(incubatorMemberInvitePath(pending));
    } catch { /* ignore */ }
  }, [me]);

  if (!me) return <div className="p-8 text-sm text-gray-400">Loading…</div>;
  if (!me.ok || !me.incubator) {
    return (
      <div className="mx-auto mt-24 max-w-md rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-bold text-gray-900">No Ecosystem workspace access</h1>
        <p className="mt-2 text-sm text-gray-600">This account is not an active member of any ecosystem organisation. If you received an invite, open the link in the email while signed in to this account.</p>
      </div>
    );
  }
  const demo = !!me.demo;
  const items: WorkspaceNavItem[] = ([
    { key: 'portfolio', label: 'Portfolio', icon: '▦' },
    ...(callsEnabled ? [{ key: 'calls', label: 'Calls', icon: '◇' } as const] : []),
    { key: 'team', label: 'Team', icon: '◉' },
    { key: 'settings', label: 'Settings', icon: '⚙' },
  ] as const).map((n) => ({ ...n, active: tab === n.key, onSelect: () => setTab(n.key) }));

  return (
    <div className="flex min-h-screen bg-[#F7F9FA] text-[#1A1A1A]">
      <WorkspaceSidebar
        brandName={BRAND_NAME}
        subtitle={me.incubator.name}
        items={items}
        afterItems={<HatSwitcher current="incubator" />}
        footer={
          <>
            <div className="truncate text-[11px] text-gray-400">{me.member?.email ?? (demo ? 'demo mode' : '')}</div>
            <LogoutButton className="mt-2 w-full" />
          </>
        }
      />
      <main className="flex-1 p-4 md:ml-60 md:p-8" data-testid="incubator-workspace">
        <div className="mb-4 flex gap-2 md:hidden">
          {items.map((n) => (
            <button key={n.key} onClick={n.onSelect} className={`rounded-lg px-3 py-1.5 text-sm ${n.active ? 'bg-[#0E7490] text-white' : 'border border-gray-200 bg-white text-gray-700'}`}>{n.label}</button>
          ))}
        </div>
        <div className="mb-5">
          <h1 className="text-lg font-bold text-gray-900">{me.incubator.name}</h1>
          <p className="text-xs text-gray-500">{incubatorKindLabel(me.incubator.kind)}{me.incubator.city ? ` · ${me.incubator.city}` : ''}{demo ? ' · demo mode' : ''}</p>
        </div>
        {tab === 'portfolio' && <PortfolioPanel demo={demo} />}
        {tab === 'calls' && callsEnabled && <CallsWorkspace kind="incubator" />}
        {tab === 'team' && <TeamPanel demo={demo} isOwner={me.member?.role === 'owner'} />}
        {tab === 'settings' && <SettingsPanel me={me} demo={demo} onSaved={loadMe} />}
      </main>
    </div>
  );
}
