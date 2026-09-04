'use client';
// Promo Codes & Offers — back-office. Create a code (type, discount %,
// affected plans with a live "price the user will pay" preview, redemption
// window, benefit duration, redemption limit), list active/inactive codes
// with a live adherent count, expand a code to see who redeemed it (org,
// join date, until when), deactivate, or delete (soft, with a confirm step).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '@/components/ui';
import { PLANS, planPriceLabel } from '@/lib/plans';
import { PROMO_ELIGIBLE_PLANS, discountedPriceEur, generatePromoCode, normalizeDiscountForKind, type PromoKind } from '@/lib/promo';
import type { PlanTier } from '@/lib/types';

type Promo = {
  id: string; code: string; label: string | null; kind: PromoKind; discount_pct: number;
  applicable_plans: PlanTier[]; redeemable_until: string | null; benefit_duration_months: number | null;
  max_redemptions: number | null; active: boolean; created_at: string; redemption_count: number;
  // Prompt 161 §A — absent on an unmigrated environment (0167 not applied
  // yet); every reader treats missing/undefined as false.
  is_pioneer?: boolean;
};
type Redemption = {
  id: string; org_id: string; org_name: string; redeemed_at: string;
  benefit_ends_at: string | null; benefit_active: boolean;
};

const ELIGIBLE_PLAN_ROWS = PLANS.filter((p) => PROMO_ELIGIBLE_PLANS.includes(p.tier));

// Prompt 567 — the list printed applicable_plans straight, so a row read
// "garage, motherfunding" beside properly formatted labels like "Free trial"
// and "Redemption window closed". Those are the internal slugs of orgs.plan;
// the founder-facing names are "List of Suspects" and "It's the butler!", and
// PLANS already holds them — the creation form above this list has been
// showing them all along, which is what made the mismatch visible.
//
// Deliberately not planName(): planRow() resolves an unknown slug to PLANS[0],
// so a plan that is ever removed or renamed would silently be labelled
// "Elementary, my dear" — the free tier — instead of showing that something
// is off. Looking the row up here and falling back to the raw slug keeps the
// display honest, and still reads the single source of truth rather than
// introducing a second slug-to-name table.
function planLabelForSlug(slug: string): string {
  return PLANS.find((p) => p.tier === slug)?.name ?? slug;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function CreatePromoForm({ onCreated }: { onCreated: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<PromoKind>('percent_off');
  const [discountPct, setDiscountPct] = useState('50');
  const [plans, setPlans] = useState<PlanTier[]>([]);
  const [redeemableUntil, setRedeemableUntil] = useState('');
  const [durationMonths, setDurationMonths] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  // Prompt 161 §A.2 — campaign codes (public, accelerators, investor
  // portfolios) are always is_pioneer=true; a one-off discount to someone
  // stays false. Defaults to false — an admin has to deliberately opt a
  // code into the Pioneer campaign, not the other way round.
  const [isPioneer, setIsPioneer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effectivePct = normalizeDiscountForKind(kind, Number(discountPct) || 0);

  function togglePlan(tier: PlanTier) {
    setPlans((prev) => (prev.includes(tier) ? prev.filter((p) => p !== tier) : [...prev, tier]));
  }

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/backoffice/promo-codes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code, label, kind, discount_pct: effectivePct, applicable_plans: plans,
          redeemable_until: redeemableUntil ? new Date(redeemableUntil).toISOString() : null,
          benefit_duration_months: durationMonths || null,
          max_redemptions: maxRedemptions || null,
          is_pioneer: isPioneer,
        }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not create the promo.'); return; }
      setCode(''); setLabel(''); setPlans([]); setRedeemableUntil(''); setDurationMonths(''); setMaxRedemptions(''); setIsPioneer(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="New promo code">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-gray-500">Code</label>
          <div className="mt-1 flex gap-1.5">
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="LAUNCH50"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm uppercase" />
            <button type="button" onClick={() => setCode(generatePromoCode())}
              className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
              Generate
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Internal label (optional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Launch week promo"
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as PromoKind)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm">
            <option value="percent_off">Percentage discount</option>
            <option value="free_trial">Free trial (100% off)</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Discount %</label>
          <input type="number" min={1} max={100} value={kind === 'free_trial' ? 100 : discountPct}
            disabled={kind === 'free_trial'} onChange={(e) => setDiscountPct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
        </div>

        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">Plans affected — price the user will pay</label>
          <div className="mt-1.5 space-y-1.5">
            {ELIGIBLE_PLAN_ROWS.map((p) => {
              const checked = plans.includes(p.tier);
              const discounted = discountedPriceEur(p.monthlyEur, effectivePct);
              return (
                <label key={p.tier} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-sm ${checked ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200'}`}>
                  <span className="flex items-center gap-2">
                    <input type="checkbox" checked={checked} onChange={() => togglePlan(p.tier)} />
                    {p.name}
                    <span className="text-xs text-gray-400">({planPriceLabel(p, 'monthly')})</span>
                  </span>
                  {checked && (
                    <span className="text-xs font-semibold text-[#0E7490]">
                      → €{discounted}/month{effectivePct === 100 ? ' (free)' : ''}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500">Redeemable until (optional)</label>
          <input type="datetime-local" value={redeemableUntil} onChange={(e) => setRedeemableUntil(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
          <p className="mt-1 text-[11px] text-gray-400">Blank = no deadline to redeem (only the active switch gates it).</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Benefit lasts (months, optional)</label>
          <input type="number" min={1} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)}
            placeholder="e.g. 3" className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
          <p className="mt-1 text-[11px] text-gray-400">Blank = the discount never expires once redeemed.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Max redemptions (optional)</label>
          <input type="number" min={1} value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder="e.g. 100" className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
          <p className="mt-1 text-[11px] text-gray-400">Blank = unlimited.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm">
            <input type="checkbox" checked={isPioneer} onChange={(e) => setIsPioneer(e.target.checked)} />
            Pioneer campaign code
          </label>
          <p className="mt-1 text-[11px] text-gray-400">
            Whoever redeems this earns the permanent Pioneer badge once the trial ends (lifetime 20% discount, 3 referral codes) — check this only for public/accelerator/investor-portfolio campaign codes, not a one-off discount.
          </p>
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      <button onClick={submit} disabled={busy || !code.trim() || plans.length === 0}
        className="mt-3 rounded-lg bg-[#0E7490] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
        {busy ? 'Creating…' : 'Create promo code'}
      </button>
    </Card>
  );
}

function PromoRow({ promo, onChanged }: { promo: Promo; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [redemptions, setRedemptions] = useState<Redemption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');

  async function toggleExpand() {
    if (!expanded && !redemptions) {
      const res = await fetch(`/api/backoffice/promo-codes/${promo.id}`);
      const body = await res.json();
      if (body.ok) setRedemptions(body.redemptions);
    }
    setExpanded((v) => !v);
  }

  async function toggleActive() {
    setBusy(true);
    try {
      await fetch(`/api/backoffice/promo-codes/${promo.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !promo.active }),
      });
      onChanged();
    } finally { setBusy(false); }
  }

  async function confirmDelete() {
    if (deleteTyped !== 'DELETE') return;
    setBusy(true);
    try {
      await fetch(`/api/backoffice/promo-codes/${promo.id}`, { method: 'DELETE' });
      onChanged();
    } finally { setBusy(false); setConfirmingDelete(false); setDeleteTyped(''); }
  }

  const isExpired = promo.redeemable_until && new Date(promo.redeemable_until) < new Date();

  return (
    <div className="rounded-xl border border-gray-100 bg-white">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button onClick={toggleExpand} className="text-xs text-gray-400 hover:text-gray-700">{expanded ? '▾' : '▸'}</button>
        <span className="font-mono text-sm font-semibold text-gray-800">{promo.code}</span>
        {promo.label && <span className="text-xs text-gray-400">{promo.label}</span>}
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
          {promo.kind === 'free_trial' ? 'Free trial' : `${promo.discount_pct}% off`}
        </span>
        {promo.is_pioneer && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">🏅 Pioneer</span>}
        <span className="text-[11px] text-gray-400">{promo.applicable_plans.map(planLabelForSlug).join(', ')}</span>
        {promo.benefit_duration_months && <span className="text-[11px] text-gray-400">for {promo.benefit_duration_months}mo</span>}
        {!promo.active && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600">Inactive</span>}
        {isExpired && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Redemption window closed</span>}
        <span className="ml-auto text-xs font-semibold text-[#0E7490]">
          {promo.redemption_count}{promo.max_redemptions ? ` / ${promo.max_redemptions}` : ''} adherent{promo.redemption_count === 1 ? '' : 's'}
        </span>
        <button onClick={toggleActive} disabled={busy}
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">
          {promo.active ? 'Deactivate' : 'Activate'}
        </button>
        <button onClick={() => setConfirmingDelete(true)} className="rounded-lg border border-red-200 px-2.5 py-1 text-xs text-[#B00000] hover:bg-red-50">Delete</button>
      </div>

      {confirmingDelete && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { setConfirmingDelete(false); setDeleteTyped(''); }}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">Delete promo code {promo.code}?</h2>
            <p className="text-sm leading-relaxed text-gray-600">
              Once you confirm this deletion, <b>every user currently benefiting from this promo
              will immediately lose it</b> — not just future redemptions. This is different from
              Deactivate, which only stops new redemptions and leaves existing ones untouched
              until they naturally expire.
              {promo.redemption_count > 0 && (
                <> This will affect <b>{promo.redemption_count} adherent{promo.redemption_count === 1 ? '' : 's'}</b> right now.</>
              )}
              {' '}This action cannot be undone.
            </p>
            <p className="mt-3 text-xs font-medium text-gray-500">Type DELETE to confirm.</p>
            <input value={deleteTyped} onChange={(e) => setDeleteTyped(e.target.value)} placeholder="DELETE"
              className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm uppercase tracking-wide"
              autoFocus />
            <div className="mt-4 flex gap-2">
              <button onClick={confirmDelete} disabled={busy || deleteTyped !== 'DELETE'}
                className="rounded-lg bg-[#B00000] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#900000] disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button onClick={() => { setConfirmingDelete(false); setDeleteTyped(''); }}
                className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {expanded && (
        <div className="border-t border-gray-100 px-3 py-2.5">
          {!redemptions ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : redemptions.length === 0 ? (
            <p className="text-xs text-gray-400">No adherents yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <tr><th className="pb-1.5">Org</th><th className="pb-1.5">Joined</th><th className="pb-1.5">Benefit until</th><th className="pb-1.5">Status</th></tr>
              </thead>
              <tbody>
                {redemptions.map((r) => (
                  <tr key={r.id} className="border-t border-gray-50">
                    <td className="py-1.5 font-medium text-gray-700">{r.org_name}</td>
                    <td className="py-1.5 text-gray-500">{fmtDate(r.redeemed_at)}</td>
                    <td className="py-1.5 text-gray-500">{r.benefit_ends_at ? fmtDate(r.benefit_ends_at) : 'Permanent'}</td>
                    <td className="py-1.5">
                      {r.benefit_active
                        ? <span className="text-emerald-700">Active</span>
                        : <span className="text-gray-400">Ended</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function PromoCodesPage() {
  const [promos, setPromos] = useState<Promo[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/promo-codes').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load promo codes.'); return; }
      setPromos(body.promos);
    });
  }
  useEffect(refresh, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Promo Codes &amp; Offers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Temporary discounts a founder redeems on the Plans &amp; billing page.
        </p>
      </div>

      <CreatePromoForm onCreated={refresh} />

      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!promos ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : promos.length === 0 ? (
        <p className="text-sm text-gray-400">No promo codes yet.</p>
      ) : (
        <div className="space-y-2">
          {promos.map((p) => <PromoRow key={p.id} promo={p} onChanged={refresh} />)}
        </div>
      )}
    </div>
  );
}
