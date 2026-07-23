'use client';
// Batch 3 B — Organisation data, editable by owner+admin (server-enforced in
// /api/org/update). Read-only for manager/member and in demo mode. Replaces
// the old read-only <dl>. The BCC row is gone (batch 3 D — the in-app
// interaction log is the record; a BCC mailbox reads as surveillance).
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { can, type OrgRole } from '@/lib/permissions';

const STAGES = ['pre_seed', 'seed', 'series_a', 'later'] as const;

export function OrganisationCard() {
  const { db, updateOrg } = useStore();
  const org = db.org;
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!authEnabled) return;
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json()).then((me) => setOrgRole(me.orgRole ?? null)).catch(() => {});
  }, []);

  // In demo mode there's no server role; allow editing so the flow is
  // exercisable locally (writes stay in localStorage).
  const canEdit = !authEnabled || can(orgRole, 'manage_org_settings');

  function startEdit() {
    setDraft({
      name: org.name ?? '', sender_email: org.sender_email ?? '', website: org.website ?? '',
      sector: org.sector ?? '', stage: org.stage ?? '', country: org.country ?? '',
      one_liner: org.one_liner ?? '', round_target_eur: org.round_target_eur != null ? String(org.round_target_eur) : '',
      daily_cap: String(org.daily_cap), weekly_cap: String(org.weekly_cap),
    });
    setEditing(true); setSaved(false);
  }

  function save() {
    updateOrg({
      name: draft.name.trim() || org.name,
      sender_email: draft.sender_email.trim() || undefined,
      website: draft.website.trim() || undefined,
      sector: draft.sector.trim() || undefined,
      stage: (draft.stage || undefined) as typeof org.stage,
      country: draft.country.trim() || undefined,
      one_liner: draft.one_liner.trim() || undefined,
      round_target_eur: draft.round_target_eur ? Number(draft.round_target_eur) : undefined,
      daily_cap: Number(draft.daily_cap) || org.daily_cap,
      weekly_cap: Number(draft.weekly_cap) || org.weekly_cap,
    });
    setEditing(false); setSaved(true);
  }

  const field = (k: string, label: string, type = 'text') => (
    <label className="flex flex-col gap-0.5 text-xs">
      <span className="text-gray-500">{label}</span>
      <input type={type} value={draft[k] ?? ''} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
        className="rounded border border-gray-300 px-2 py-1 text-sm" />
    </label>
  );

  return (
    <Card title="Organisation" right={canEdit && !editing
      ? <button onClick={startEdit} className="text-xs text-cyan-700 hover:underline">Edit</button>
      : undefined}>
      {editing ? (
        <div className="grid grid-cols-2 gap-2">
          {field('name', 'Org name')}
          {field('sender_email', 'Sender email', 'email')}
          {field('website', 'Website')}
          {field('sector', 'Sector')}
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-gray-500">Stage</span>
            <select value={draft.stage ?? ''} onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
              className="rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="">—</option>
              {STAGES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
          {field('country', 'Country')}
          {field('round_target_eur', 'Round target (EUR)', 'number')}
          {field('daily_cap', 'Daily cap', 'number')}
          {field('weekly_cap', 'Weekly cap', 'number')}
          <label className="col-span-2 flex flex-col gap-0.5 text-xs">
            <span className="text-gray-500">One-liner</span>
            <input value={draft.one_liner ?? ''} onChange={(e) => setDraft({ ...draft, one_liner: e.target.value })}
              className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <div className="col-span-2 flex gap-2">
            <button onClick={save} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Save</button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-xs text-gray-500">Org</dt><dd>{org.name}</dd></div>
            <div><dt className="text-xs text-gray-500">Plan</dt><dd className="capitalize">{org.plan}</dd></div>
            <div><dt className="text-xs text-gray-500">Sender</dt><dd>{org.sender_email ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Website</dt><dd>{org.website ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Sector</dt><dd>{org.sector ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Stage</dt><dd>{org.stage?.replace('_', ' ') ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Country</dt><dd>{org.country ?? '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Round target</dt><dd>{org.round_target_eur != null ? `€${org.round_target_eur.toLocaleString()}` : '—'}</dd></div>
            <div><dt className="text-xs text-gray-500">Daily cap</dt><dd>{org.daily_cap} outbounds</dd></div>
            <div><dt className="text-xs text-gray-500">Weekly cap</dt><dd>{org.weekly_cap} outbounds</dd></div>
            {org.one_liner && <div className="col-span-2"><dt className="text-xs text-gray-500">One-liner</dt><dd>{org.one_liner}</dd></div>}
          </dl>
          {saved && <p className="mt-2 text-xs text-green-700">Saved.</p>}
          <p className="mt-2 text-xs text-gray-400">
            Caps are strategic, not technical — a €1.3M seed closes on 15–40 conversations.
            {!canEdit && ' Only owners and admins can edit organisation data.'}
          </p>
        </>
      )}
    </Card>
  );
}
