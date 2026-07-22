'use client';
// Packs — curated investor packs, unlockable (free during development)
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Card, fmtEur } from '@/components/ui';
import type { EntityType } from '@/lib/types';

const TYPES: EntityType[] = ['vc', 'corporate_vc', 'family_office', 'angel_fund', 'angel_network', 'public_body', 'accelerator'];

export default function PacksPage() {
  const { db, unlockPack, submitInvestor } = useStore();
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ name: '', type: 'vc' as EntityType, hq_city: '', hq_country: '', sectors: '', website: '', notes: '' });
  const [submitted, setSubmitted] = useState(false);

  const deliveredIds = new Set(db.unlocks.flatMap((u) => u.delivered_catalog_ids));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold">Investor packs</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Curated, team-verified investor lists. Unlocking a pack adds its investors to your pipeline with thesis notes
          and check ranges — never duplicated if you already have them. <span className="font-medium text-[#0E7490]">Free during the beta.</span>
        </p>
      </div>

      {msg && <div className="rounded-xl border border-cyan-100 bg-[#E8F4F8] px-4 py-2.5 text-sm text-cyan-900">{msg}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        {db.packs.map((p) => {
          const unlocked = db.unlocks.some((u) => u.pack_id === p.id);
          const items = p.catalog_ids.map((cid) => db.catalog.find((c) => c.id === cid)).filter(Boolean);
          return (
            <div key={p.id} className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <h2 className="text-base font-semibold">{p.name}</h2>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-300 line-through">{fmtEur(p.price_eur)}</div>
                  <div className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">free in beta</div>
                </div>
              </div>
              <p className="mt-1 text-sm text-gray-500">{p.description}</p>
              <ul className="mt-3 flex-1 space-y-2">
                {items.map((c) => (
                  <li key={c!.id} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                    <span className="font-medium">{c!.name}</span>
                    <span className="text-xs text-gray-400">{c!.hq_city}, {c!.hq_country}</span>
                    <span className="ml-auto flex gap-1">
                      {c!.sectors.slice(0, 2).map((s) => (
                        <span key={s} className="rounded-full bg-white px-2 py-0.5 text-[10px] text-gray-500 border border-gray-200">{s}</span>
                      ))}
                    </span>
                    {deliveredIds.has(c!.id) && <span className="text-[10px] font-semibold text-green-700">in pipeline ✓</span>}
                  </li>
                ))}
              </ul>
              <button
                disabled={unlocked}
                onClick={() => { const n = unlockPack(p.id); setMsg(`Pack unlocked — ${n} investor(s) added to your pipeline.`); }}
                className="mt-4 rounded-xl bg-[#0E7490] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c637b] disabled:bg-gray-100 disabled:text-gray-400">
                {unlocked ? 'Unlocked ✓' : 'Unlock pack'}
              </button>
            </div>
          );
        })}
      </div>

      <Card title="Suggest an investor to the catalog">
        {submitted ? (
          <div className="text-sm text-green-700">
            Submitted — thank you. Our team verifies existence and factuality before it joins the global catalog.
            A private copy was already added to <b>your</b> pipeline.
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500">
              Added instantly to your own pipeline; queued for team verification before entering the shared catalog.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input placeholder="Name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EntityType })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
                {TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
              <input placeholder="Website" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <input placeholder="City" value={form.hq_city} onChange={(e) => setForm({ ...form, hq_city: e.target.value })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <input placeholder="Country (e.g. PT)" value={form.hq_country} onChange={(e) => setForm({ ...form, hq_country: e.target.value })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
              <input placeholder="Sectors (comma-separated)" value={form.sectors} onChange={(e) => setForm({ ...form, sectors: e.target.value })}
                className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <textarea placeholder="Notes for the review team (how do you know them, source of the info…)"
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
              className="mt-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <button disabled={!form.name}
              onClick={() => {
                submitInvestor({
                  name: form.name, type: form.type, hq_city: form.hq_city || undefined,
                  hq_country: form.hq_country || undefined, website: form.website || undefined,
                  sectors: form.sectors.split(',').map((s) => s.trim()).filter(Boolean),
                  notes: form.notes || undefined,
                });
                setSubmitted(true);
              }}
              className="mt-3 rounded-xl bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
              Submit for review
            </button>
          </>
        )}
      </Card>
    </div>
  );
}
