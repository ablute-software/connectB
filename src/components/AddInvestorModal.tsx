'use client';
// Suggest an investor to the catalog — the one piece of the retired Packs
// page (browse/unlock curated packs) that's kept, moved here as a popup off
// Pipeline's "+ Add investor" button instead of a full-page navigation.
// Same form, same submitInvestor action, same behaviour (instant private
// pipeline entry + queued for team review before joining the shared
// catalog) — only the presentation changed.
import { useState } from 'react';
import { useStore } from '@/lib/store';
import type { EntityType } from '@/lib/types';

const TYPES: EntityType[] = ['vc', 'corporate_vc', 'family_office', 'angel_fund', 'angel_network', 'public_body', 'accelerator'];

export function AddInvestorModal({ onClose }: { onClose: () => void }) {
  const { submitInvestor } = useStore();
  const [form, setForm] = useState({ name: '', type: 'vc' as EntityType, hq_city: '', hq_country: '', sectors: '', website: '', notes: '' });
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">Suggest an investor to the catalog</h2>
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {submitted ? (
          <div className="mt-3 text-sm text-green-700">
            Submitted — thank you. Our team verifies existence and factuality before it joins the global catalog.
            A private copy was already added to <b>your</b> pipeline.
          </div>
        ) : (
          <>
            <p className="mb-3 mt-2 text-xs text-gray-500">
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
            <div className="mt-3 flex items-center gap-2">
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
                className="rounded-xl bg-[#0E7490] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                Submit for review
              </button>
              <button onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
