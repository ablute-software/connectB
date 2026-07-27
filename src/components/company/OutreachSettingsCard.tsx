'use client';
// Company tab redesign — Outreach settings: the operational bits (sender,
// daily/weekly caps) that used to live in the Organisation card, now split
// out from identity per the redesign. Deliberately last and plainer —
// configuration, not who-the-company-is.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';

export function OutreachSettingsCard({ canEdit }: { canEdit: boolean }) {
  const { db, updateOrg } = useStore();
  const org = db.org;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ sender_email: '', daily_cap: '', weekly_cap: '' });

  function startEdit() {
    setDraft({ sender_email: org.sender_email ?? '', daily_cap: String(org.daily_cap), weekly_cap: String(org.weekly_cap) });
    setEditing(true);
  }
  function save() {
    updateOrg({
      sender_email: draft.sender_email.trim() || undefined,
      daily_cap: Number(draft.daily_cap) || org.daily_cap,
      weekly_cap: Number(draft.weekly_cap) || org.weekly_cap,
    });
    setEditing(false);
  }

  return (
    <Card title="Outreach settings" right={canEdit && !editing ? <button onClick={startEdit} className="text-xs text-cyan-700 hover:underline">Edit</button> : undefined}>
      {editing ? (
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-gray-500">Sender email</span>
            <input type="email" value={draft.sender_email} onChange={(e) => setDraft({ ...draft, sender_email: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-gray-500">Daily cap</span>
            <input type="number" value={draft.daily_cap} onChange={(e) => setDraft({ ...draft, daily_cap: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-xs">
            <span className="text-gray-500">Weekly cap</span>
            <input type="number" value={draft.weekly_cap} onChange={(e) => setDraft({ ...draft, weekly_cap: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
          <div className="col-span-3 flex gap-2">
            <button onClick={save} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-medium text-white">Save</button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div><dt className="text-xs text-gray-500">Sender</dt><dd>{org.sender_email ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Daily cap</dt><dd>{org.daily_cap} outbounds</dd></div>
          <div><dt className="text-xs text-gray-500">Weekly cap</dt><dd>{org.weekly_cap} outbounds</dd></div>
        </dl>
      )}
      <p className="mt-2 text-xs text-gray-400">Caps are strategic, not technical — a €1.3M seed closes on 15–40 conversations.{!canEdit && ' Only owners and admins can edit.'}</p>
    </Card>
  );
}
