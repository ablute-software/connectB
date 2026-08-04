'use client';
// The "about {org.name}" page (nav label set in shell.tsx; the route stays
// /settings). Separadores: Company, Import history, Needs review,
// Automations, Team. Plans & billing is NOT here — it went back to being its
// own top-level nav item (src/app/plans/page.tsx) — this page is company
// config + data ingestion + team, not billing. Needs review moved in from
// the former /queue (which is back to being just Outbox — see
// src/app/outbox/page.tsx). The active separador lives in ?tab=
// (useTabParam), never component state alone.
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Card, Tabs } from '@/components/ui';
import { useTabParam } from '@/lib/use-tab';
import { authEnabled, browserClient } from '@/lib/supabase';
import { ORG_ROLES, ROLE_LABELS, can, canAssignRole, canActOnMember, type OrgRole } from '@/lib/permissions';
import { AutomationsPanel } from '@/components/AutomationsPanel';
import { PermissionsMatrixCard } from '@/components/PermissionsMatrixCard';
import { ImportPanel } from '@/components/settings/ImportPanel';
import { NeedsReviewPanel } from '@/components/queue/NeedsReviewPanel';
import { CompanyPanel } from '@/components/company/CompanyPanel';
import { calcCompanyCompleteness } from '@/lib/companyCompleteness';
import { APP_URL } from '@/lib/brand';
import { PageTour } from '@/components/onboarding/PageTour';
import { PageGuideButton } from '@/components/onboarding/PageGuideButton';
import { VisibilityToggle } from '@/components/VisibilityToggle';

type Invitation = { id: string; email: string; role: string; status: string; created_at: string; expires_at: string };
type Member = { userId: string; email: string; role: OrgRole; isSelf: boolean };

function needsReviewBadge(db: ReturnType<typeof useStore>['db']) {
  return db.interactions.filter((i) => i.needs_review).length;
}

type PinState = { hasPin: boolean; required: boolean; lockedUntil: string | null };

function RosterCard({ myRole, orgId }: { myRole: OrgRole | null; orgId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  // Prompt 118 §3.5 / tail verification — owner-managed Vault Data Room
  // codes. Strictly myRole === 'owner', not the broader canActOnMember
  // hierarchy above — vault_pin_set_for_user/vault_pin_clear_for_user/
  // vault_pin_list all check role = 'owner' literally, so an admin seeing
  // controls here that then 403 server-side would be a worse experience
  // than not showing them at all.
  const [pinAvailable, setPinAvailable] = useState(false);
  const [pinState, setPinState] = useState<Record<string, PinState> | null>(null);
  const [pinInputs, setPinInputs] = useState<Record<string, string>>({});
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [pinErr, setPinErr] = useState('');

  function refreshPins() {
    if (myRole !== 'owner') return;
    fetch('/api/me').then((r) => r.json()).then((me) => {
      if (!me?.capabilities?.vaultPinOwnerManaged) return;
      setPinAvailable(true);
      fetch(`/api/vault-pin?orgId=${orgId}`).then((r) => r.json()).then((body) => {
        if (!body.ok) return;
        const byId: Record<string, PinState> = {};
        for (const m of body.members) byId[m.userId] = { hasPin: m.hasPin, required: m.required, lockedUntil: m.lockedUntil };
        setPinState(byId);
      });
    });
  }
  useEffect(refreshPins, [myRole, orgId]);

  async function setPin(userId: string) {
    const pin = pinInputs[userId] ?? '';
    if (!/^\d{4}$/.test(pin)) { setPinErr('Enter exactly 4 digits.'); return; }
    setPinErr(''); setPinBusy(userId);
    const res = await fetch('/api/vault-pin/set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, userId, pin }),
    });
    const body = await res.json();
    setPinBusy(null);
    if (!body.ok) { setPinErr(body.error); return; }
    setPinInputs((s) => ({ ...s, [userId]: '' }));
    refreshPins();
  }

  async function clearPin(userId: string) {
    setPinErr(''); setPinBusy(userId);
    const res = await fetch('/api/vault-pin/clear', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, userId }),
    });
    const body = await res.json();
    setPinBusy(null);
    if (!body.ok) { setPinErr(body.error); return; }
    refreshPins();
  }

  function refresh() {
    fetch('/api/team/members').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setMembers(body.members);
    });
  }
  useEffect(refresh, []);

  async function changeRole(userId: string, role: OrgRole) {
    setBusy(userId);
    const res = await fetch(`/api/team/members/${userId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
    });
    const body = await res.json();
    setBusy(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }

  async function remove(userId: string) {
    setBusy(userId);
    const res = await fetch(`/api/team/members/${userId}`, { method: 'DELETE' });
    const body = await res.json();
    setBusy(null);
    if (body.ok === false) { setErr(body.error); return; }
    refresh();
  }

  if (err) return <Card title="People"><p className="text-sm text-[#B00000]">{err}</p></Card>;
  if (!members) return <Card title="People"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <Card title={`People (${members.length})`}>
      {pinAvailable && pinErr && <p className="mb-2 text-xs text-[#B00000]">{pinErr}</p>}
      <ul className="space-y-1.5 text-sm">
        {members.map((m) => {
          const actable = myRole && !m.isSelf && canActOnMember(myRole, m.role);
          const pin = pinState?.[m.userId];
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{m.email}</span>
              {m.isSelf && <span className="text-xs text-gray-400">(you)</span>}
              {actable ? (
                <select value={m.role} disabled={busy === m.userId} onChange={(e) => changeRole(m.userId, e.target.value as OrgRole)}
                  className="rounded border border-gray-200 px-1.5 py-0.5 text-xs">
                  {ORG_ROLES.filter((r) => canAssignRole(myRole!, r) || r === m.role).map((r) => (
                    <option key={r} value={r} disabled={!canAssignRole(myRole!, r)}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-gray-400">{ROLE_LABELS[m.role]}</span>
              )}
              {actable && (
                <button disabled={busy === m.userId} onClick={() => remove(m.userId)}
                  className="text-xs text-gray-400 hover:text-[#B00000] hover:underline">Remove</button>
              )}
              {/* Prompt 118 §3.5 — Vault Data Room code, owner-managed. Only
                  renders once migration 0118 is applied (pinAvailable) and
                  only for the owner (RosterCard's own myRole check above). */}
              {pinAvailable && myRole === 'owner' && (
                <span className="ml-auto flex items-center gap-1.5">
                  {pin?.hasPin ? (
                    <>
                      <span className="text-xs text-emerald-700" title={pin.lockedUntil && new Date(pin.lockedUntil) > new Date() ? `Locked until ${new Date(pin.lockedUntil).toLocaleTimeString()}` : undefined}>
                        Vault code set{pin.lockedUntil && new Date(pin.lockedUntil) > new Date() ? ' (locked)' : ''}
                      </span>
                      <button disabled={pinBusy === m.userId} onClick={() => clearPin(m.userId)}
                        className="text-xs text-gray-400 hover:text-[#B00000] hover:underline">Clear</button>
                    </>
                  ) : (
                    <>
                      <input value={pinInputs[m.userId] ?? ''} inputMode="numeric" placeholder="0000"
                        onChange={(e) => setPinInputs((s) => ({ ...s, [m.userId]: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                        className="w-14 rounded border border-gray-200 px-1.5 py-0.5 text-center text-xs" />
                      <button disabled={pinBusy === m.userId || (pinInputs[m.userId] ?? '').length !== 4}
                        onClick={() => setPin(m.userId)}
                        className="text-xs text-[#0E7490] hover:underline disabled:text-gray-300">Set code</button>
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TeamCard({ orgId }: { orgId: string }) {
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [link, setLink] = useState('');
  const [emailed, setEmailed] = useState(false);
  const [err, setErr] = useState('');

  function refresh() {
    browserClient().from('org_invitations').select('*').eq('org_id', orgId)
      .order('created_at', { ascending: false }).then(({ data }) => setInvitations((data as Invitation[]) ?? []));
  }

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setOrgRole(me.orgRole ?? null));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function sendInvite() {
    setErr(''); setLink(''); setEmailed(false);
    const res = await fetch('/api/invite/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, email, role }),
    });
    const body = await res.json();
    if (body.ok === false) { setErr(body.error); return; }
    setLink(`${APP_URL}/invite/${body.token}`);
    setEmail('');
    refresh();
    // Best-effort: sends a real email if RESEND_API_KEY is configured; the
    // copyable link above always works regardless, so a failure here is silent.
    try {
      const emailRes = await fetch('/api/invite/send-email', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: body.token }),
      });
      const emailBody = await emailRes.json();
      if (emailBody.sent) setEmailed(true);
    } catch { /* keep the copyable link path — nothing to show the user */ }
  }

  async function revoke(id: string) {
    await browserClient().from('org_invitations').update({ status: 'revoked' }).eq('id', id);
    refresh();
  }

  const canInvite = can(orgRole, 'invite_members');
  const assignableRoles = orgRole ? ORG_ROLES.filter((r) => canAssignRole(orgRole, r)) : [];

  return (
    <div className="space-y-5">
      <RosterCard myRole={orgRole} orgId={orgId} />
      <Card title="Invite teammates">
        {canInvite ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="teammate@company.com"
              className="min-w-[220px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
            <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button disabled={!email} onClick={sendInvite}
              className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
              Create invite
            </button>
          </div>
        ) : (
          <p className="mb-3 text-xs text-gray-400">Only owners/admins can invite teammates.</p>
        )}
        {err && <p className="mb-2 text-xs text-[#B00000]">{err}</p>}
        {link && (
          <div className="mb-4 rounded-lg border border-cyan-200 bg-[#E8F4F8] px-3 py-2 text-xs text-cyan-900">
            {emailed
              ? 'Invite email sent. Link also below in case it lands in spam:'
              : 'Invite link — copy and send by hand (email sending isn’t available yet):'}
            <div className="mt-1 break-all font-mono">{link}</div>
          </div>
        )}
        {invitations.length === 0 ? <p className="text-sm text-gray-400">No invitations yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  i.status === 'pending' ? 'bg-amber-50 text-amber-700'
                    : i.status === 'accepted' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {i.status}
                </span>
                <span className="font-medium">{i.email}</span>
                <span className="text-xs text-gray-400">{i.role}</span>
                {canInvite && i.status === 'pending' && (
                  <button onClick={() => revoke(i.id)} className="ml-auto text-xs text-gray-400 hover:text-[#B00000] hover:underline">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const GMAIL_MESSAGE: Record<string, string> = {
  connected: 'Gmail connected.',
  not_configured: 'Gmail connection is coming soon.',
  denied: 'Gmail connection was cancelled.',
  error: 'Something went wrong connecting Gmail — try again.',
};

function GmailConnectionCard() {
  const sp = useSearchParams();
  const flash = sp.get('gmail');
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean; email?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  function refresh() {
    fetch('/api/oauth/google/status').then((r) => r.json()).then(setStatus);
  }
  useEffect(refresh, []);

  async function disconnect() {
    setBusy(true);
    await fetch('/api/oauth/google/disconnect', { method: 'POST' });
    setBusy(false);
    refresh();
  }

  return (
    <Card title="Email — send from your own mailbox">
      <p className="mb-2 text-xs text-gray-500">
        Connect Gmail so composer emails send from your own address (reply-to intact) instead of just being logged
        after you send them by hand. LinkedIn has no send API by design (ToS) — the composer offers copy-assist there instead.
      </p>
      {flash && <p className="mb-2 text-xs text-cyan-800">{GMAIL_MESSAGE[flash] ?? ''}</p>}
      {!status ? <p className="text-sm text-gray-400">Loading…</p> : !status.configured ? (
        <p className="text-xs text-gray-400">Gmail connection is coming soon.</p>
      ) : status.connected ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">Connected</span>
          <span>{status.email}</span>
          <button disabled={busy} onClick={disconnect} className="ml-auto text-xs text-gray-400 hover:text-[#B00000] hover:underline disabled:opacity-40">Disconnect</button>
        </div>
      ) : (
        <a href="/api/oauth/google/start" className="inline-block rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0c637b]">
          Connect Gmail
        </a>
      )}
    </Card>
  );
}

function TeamPanel() {
  const { db } = useStore();
  return (
    <div className="max-w-3xl space-y-4">
      {authEnabled ? (
        <>
          <TeamCard orgId={db.org.id} />
          <PermissionsMatrixCard />
          <Suspense fallback={null}><GmailConnectionCard /></Suspense>
        </>
      ) : (
        <Card title="Team"><p className="text-sm text-gray-400">Not available in this workspace yet.</p></Card>
      )}
    </div>
  );
}

function SettingsInner() {
  const [tab, setTab] = useTabParam('company');
  const [importSubtab, setImportSubtab] = useTabParam('history', 'subtab');
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const { db } = useStore();
  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => setOrgRole(me.orgRole ?? null)).catch(() => {});
  }, []);

  // Profile Strength (v0.3) — same calc CompanyPanel's own bar uses. Only
  // ever reaches 100 once migration 0037 is applied (the new fields don't
  // exist before that), so this naturally stays dark pre-migration with no
  // extra gating needed.
  const companyComplete = calcCompanyCompleteness(db.org, db.companyPeople).pct === 100;
  const reviewBadge = needsReviewBadge(db);

  const tabs = [
    { key: 'company', label: 'Company', glow: companyComplete, glowTitle: 'Profile 100% complete' },
    // Needs review lives INSIDE this tab now (see importSubtab below) — its
    // pending count still surfaces here so it isn't lost a level down.
    { key: 'import-history', label: 'Import history', badge: reviewBadge },
    { key: 'automations', label: 'Automations' },
    // "App access" — who can log into this workspace (roster/invites/
    // permissions). Distinct from Company's own Team card (who the startup
    // is) — renamed so the two stop reading as duplicates.
    { key: 'team', label: 'App access' },
  ];

  // Old bookmarks/links to ?tab=needs-review (its former top-level slot)
  // must keep working — read as "Import history" tab, "Needs review" subtab,
  // without needing a redirect or ever 404ing.
  const effectiveTab = tab === 'needs-review' ? 'import-history' : tab;
  const effectiveSubtab = tab === 'needs-review' ? 'needs-review' : importSubtab;

  const importSubtabs = [
    { key: 'history', label: 'History' },
    { key: 'needs-review', label: 'Needs review', badge: reviewBadge },
  ];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-bold">About {db.org.name || 'your company'}</h1>
        <PageGuideButton pageKey="guide_settings" />
      </div>
      <VisibilityToggle kind="startup" />
      <Tabs items={tabs} active={effectiveTab} onChange={setTab} />
      {/* Anchors (data-tour-id) live inside CompanyPanel, on the default "company" tab only. */}
      {effectiveTab !== 'automations' && effectiveTab !== 'import-history' && effectiveTab !== 'team' && (
        <PageTour pageKey="guide_settings" />
      )}
      {effectiveTab === 'automations' && (
        <Card title="Automations">
          <AutomationsPanel orgRole={authEnabled ? orgRole : undefined} />
        </Card>
      )}
      {effectiveTab === 'import-history' && (
        <div>
          <Tabs items={importSubtabs} active={effectiveSubtab} onChange={setImportSubtab} />
          {effectiveSubtab === 'needs-review' ? <NeedsReviewPanel /> : <ImportPanel />}
        </div>
      )}
      {effectiveTab === 'team' && <TeamPanel />}
      {effectiveTab !== 'automations' && effectiveTab !== 'import-history' && effectiveTab !== 'team' && <CompanyPanel />}
    </div>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsInner /></Suspense>;
}
