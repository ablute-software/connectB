'use client';
// Prompt 854 §B — Marketing / "Startups / Ecosystems": an editable outreach
// table (name, category, offer, promo code, status, comment) that issues
// its own promo codes through the SAME registry Promo Codes & Offers
// already manages (one registry, two ways in — §B.4's whole point).
//
// Editing is in place: each field commits on blur (selects: on change) via
// a PATCH, optimistic in the UI, reverting with an inline error on failure.
// §B.6 — once a row's promo_code_id is set, its offer fields (type,
// discount, plans, redeemable-until, benefit months, max redemptions)
// become read-only: Stripe coupons are immutable, so editing them after the
// code exists would silently desync what the back-office shows from what
// Stripe actually charges. The PATCH route enforces the same lock
// server-side (409) — this is a courtesy, not the only gate.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PLANS, planLabelForSlug } from '@/lib/plans';
import { PROMO_ELIGIBLE_PLANS, discountedPriceEur, normalizeDiscountForKind, type PromoKind } from '@/lib/promo';
import type { PlanTier } from '@/lib/types';

type OutreachCategory = 'startup' | 'accelerator' | 'incubator' | 'program' | 'vc';
type OutreachStatus = 'to_contact' | 'contacted' | 'replied' | 'no_reply' | 'declined';

interface Redeemer { orgId: string; orgName: string }
interface Target {
  id: string;
  name: string;
  category: OutreachCategory;
  kind: PromoKind;
  discount_pct: number;
  applicable_plans: PlanTier[];
  redeemable_until: string | null;
  benefit_duration_months: number | null;
  max_redemptions: number | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  promo_code_id: string | null;
  promo_code: string | null;
  status: OutreachStatus;
  contacted_on: string | null;
  notes: string | null;
  created_at: string;
  redeemed: Redeemer[];
}

const CATEGORY_LABEL: Record<OutreachCategory, string> = {
  startup: 'Startup', accelerator: 'Accelerator', incubator: 'Incubator', program: 'Program', vc: 'VC',
};
const STATUS_LABEL: Record<OutreachStatus, string> = {
  to_contact: 'To contact', contacted: 'Contacted', replied: 'Replied', no_reply: 'No reply', declined: 'Declined',
};
const ELIGIBLE_PLAN_ROWS = PLANS.filter((p) => PROMO_ELIGIBLE_PLANS.includes(p.tier));

function fmtDate(iso: string | null) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

// ---------- the mirror scrollbar (§B.3) ----------
// Rendered as tbody's own first row (colSpan across every column) so, in
// NORMAL flow, it already sits directly under the header — no positioning
// trick needed for that part. `sticky top: <thead height>` then keeps it
// pinned there through a vertical scroll too, right below the equally
// sticky thead (top: 0). Its scrollLeft is wired both ways to the real
// table's own horizontal scroll, guarded against the obvious feedback loop.
function MirrorScrollRow({
  columnCount, theadHeight, tableWidth, mirrorRef, onScroll,
}: {
  columnCount: number; theadHeight: number; tableWidth: number;
  mirrorRef: React.RefObject<HTMLDivElement>; onScroll: () => void;
}) {
  return (
    <tr>
      <td colSpan={columnCount} className="sticky z-10 bg-white p-0" style={{ top: theadHeight }}>
        <div ref={mirrorRef} onScroll={onScroll} className="overflow-x-auto border-b border-gray-100">
          <div style={{ width: tableWidth, height: 6 }} />
        </div>
      </td>
    </tr>
  );
}

// Prompt 855 §A.3 — three confirmation weights, proportionate to what is
// lost. No code issued: an inline "Delete? · yes / no" on the row, no
// modal. A code issued (never redeemed, or already redeemed): a dialog
// that names the code and states plainly that deleting the ROW never
// retires the CODE — that stays live on Promo codes & offers, exactly like
// /backoffice/promo-codes' own soft-delete dialog for the same reason,
// reused here rather than re-invented. Already redeemed adds the redeeming
// org names and the same typed-DELETE gate that page already uses for a
// destructive action on a live benefit.
function DeleteControl({ target, onDeleted }: { target: Target; onDeleted: (id: string) => void }) {
  const [mode, setMode] = useState<'idle' | 'inlineConfirm' | 'dialog'>('idle');
  const [deleteTyped, setDeleteTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const hasCode = !!target.promo_code_id;
  const redeemed = target.redeemed.length > 0;
  const needsTypedConfirm = hasCode && redeemed;

  function openConfirm() {
    setErr(''); setDeleteTyped('');
    setMode(hasCode ? 'dialog' : 'inlineConfirm');
  }

  async function doDelete() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/backoffice/outreach/${target.id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not delete.'); return; }
      onDeleted(target.id);
    } catch {
      setErr('Could not delete — check your connection.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'inlineConfirm') {
    return (
      <span className="flex flex-col whitespace-nowrap text-[10px]">
        <span className="flex items-center gap-1">
          Delete?
          <button disabled={busy} onClick={doDelete} className="font-semibold text-[#B00000] hover:underline">yes</button>
          /
          <button disabled={busy} onClick={() => setMode('idle')} className="text-gray-400 hover:underline">no</button>
        </span>
        {err && <span className="text-[#B00000]">{err}</span>}
      </span>
    );
  }

  return (
    <>
      <button onClick={openConfirm} aria-label="Delete row" title="Delete row"
        className="text-gray-300 hover:text-[#B00000]">×</button>
      {mode === 'dialog' && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setMode('idle')}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-2 text-lg font-semibold text-gray-900">Delete {target.name}?</h2>
            <p className="text-sm leading-relaxed text-gray-600">
              A promo code (<span className="font-mono font-semibold text-gray-800">{target.promo_code}</span>) was
              already issued for this row. Deleting the row never touches the code — it stays live on{' '}
              <a href="/backoffice/promo-codes" className="text-[#0E7490] hover:underline">Promo codes &amp; offers</a>,
              where it must be deactivated (or deleted) if the offer itself is being withdrawn.
              {redeemed && (
                <> It has already been redeemed by{' '}
                  <b>{target.redeemed.map((r) => r.orgName).join(', ')}</b> — deleting this row does not change
                  what they pay.
                </>
              )}
            </p>
            {needsTypedConfirm && (
              <>
                <p className="mt-3 text-xs font-medium text-gray-500">Type DELETE to confirm.</p>
                <input value={deleteTyped} onChange={(e) => setDeleteTyped(e.target.value)} placeholder="DELETE"
                  autoComplete="off" autoFocus
                  className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm uppercase tracking-wide" />
              </>
            )}
            {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={doDelete} disabled={busy || (needsTypedConfirm && deleteTyped !== 'DELETE')}
                className="rounded-lg bg-[#B00000] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#900000] disabled:cursor-not-allowed disabled:opacity-40">
                {busy ? 'Deleting…' : 'Delete row'}
              </button>
              <button onClick={() => setMode('idle')} className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<OutreachCategory>('startup');
  const [kind, setKind] = useState<PromoKind>('percent_off');
  const [discountPct, setDiscountPct] = useState('20');
  const [plans, setPlans] = useState<PlanTier[]>(ELIGIBLE_PLAN_ROWS.map((p) => p.tier));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const effectivePct = normalizeDiscountForKind(kind, Number(discountPct) || 0);

  function togglePlan(tier: PlanTier) {
    setPlans((prev) => (prev.includes(tier) ? prev.filter((p) => p !== tier) : [...prev, tier]));
  }

  async function submit() {
    setErr(''); setBusy(true);
    try {
      const res = await fetch('/api/backoffice/outreach', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, category, kind, discount_pct: effectivePct, applicable_plans: plans }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Could not add the target.'); return; }
      setName(''); setCategory('startup'); setKind('percent_off'); setDiscountPct('20');
      setPlans(ELIGIBLE_PLAN_ROWS.map((p) => p.tier));
      setOpen(false);
      onCreated();
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b]">
        + Add target
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-gray-500">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
            placeholder="e.g. Beta-i" className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value as OutreachCategory)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm">
            {(Object.keys(CATEGORY_LABEL) as OutreachCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
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
          <input type="number" min={1} max={100} value={kind === 'free_trial' ? 100 : discountPct} autoComplete="off"
            disabled={kind === 'free_trial'} onChange={(e) => setDiscountPct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="text-xs font-medium text-gray-500">Plans affected — price the target will pay</label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ELIGIBLE_PLAN_ROWS.map((p) => {
              const checked = plans.includes(p.tier);
              const discounted = discountedPriceEur(p.monthlyEur, effectivePct);
              return (
                <label key={p.tier} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${checked ? 'border-[#0E7490] bg-[#E8F4F8]' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={checked} onChange={() => togglePlan(p.tier)} />
                  {p.name} {checked && <span className="font-semibold text-[#0E7490]">→ €{discounted}/mo</span>}
                </label>
              );
            })}
          </div>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-[#B00000]">{err}</p>}
      <div className="mt-3 flex gap-1.5">
        <button onClick={submit} disabled={busy || !name.trim() || plans.length === 0}
          className="rounded-lg bg-[#0E7490] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
          {busy ? 'Adding…' : 'Add target'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
      </div>
    </div>
  );
}

export default function OutreachPage() {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [err, setErr] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState('');

  const [nameFilter, setNameFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [discountMin, setDiscountMin] = useState('');
  const [discountMax, setDiscountMax] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [theadHeight, setTheadHeight] = useState(32);
  const [tableWidth, setTableWidth] = useState(0);
  const syncingRef = useRef(false);

  function refresh() {
    fetch('/api/backoffice/outreach').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load the outreach table.'); return; }
      setTargets(body.targets);
    }).catch(() => setErr('Could not load the outreach table.'));
  }
  useEffect(refresh, []);

  // Keep the mirror bar's spacer as wide as the table, and the sticky
  // offset equal to the header's real height (never hardcoded).
  useEffect(() => {
    if (!tableRef.current) return;
    const table = tableRef.current;
    const observer = new ResizeObserver(() => {
      setTableWidth(table.scrollWidth);
      if (theadRef.current) setTheadHeight(theadRef.current.offsetHeight);
    });
    observer.observe(table);
    if (theadRef.current) observer.observe(theadRef.current);
    setTableWidth(table.scrollWidth);
    if (theadRef.current) setTheadHeight(theadRef.current.offsetHeight);
    return () => observer.disconnect();
  }, [targets]);

  function syncFromMain() {
    if (syncingRef.current || !scrollRef.current || !mirrorRef.current) return;
    syncingRef.current = true;
    if (mirrorRef.current.scrollLeft !== scrollRef.current.scrollLeft) mirrorRef.current.scrollLeft = scrollRef.current.scrollLeft;
    syncingRef.current = false;
  }
  function syncFromMirror() {
    if (syncingRef.current || !scrollRef.current || !mirrorRef.current) return;
    syncingRef.current = true;
    if (scrollRef.current.scrollLeft !== mirrorRef.current.scrollLeft) scrollRef.current.scrollLeft = mirrorRef.current.scrollLeft;
    syncingRef.current = false;
  }

  async function patchField(id: string, patch: Record<string, unknown>) {
    const prev = targets;
    setTargets((cur) => (cur ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)) as Target[]);
    setRowErr((e) => ({ ...e, [id]: '' }));
    setSavingId(id);
    try {
      const res = await fetch(`/api/backoffice/outreach/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!body.ok) {
        setTargets(prev);
        setRowErr((e) => ({ ...e, [id]: body.error ?? 'Could not save.' }));
        return;
      }
      setTargets((cur) => (cur ?? []).map((t) => (t.id === id ? { ...t, ...body.target } : t)) as Target[]);
    } catch {
      setTargets(prev);
      setRowErr((e) => ({ ...e, [id]: 'Could not save — check your connection.' }));
    } finally {
      setSavingId(null);
    }
  }

  // Prompt 855 §A.3 — drop it from local state rather than a full refetch;
  // the server-side soft delete is the source of truth, this is just the UI
  // catching up to what already happened.
  function handleDeleted(id: string) {
    setTargets((cur) => (cur ?? []).filter((t) => t.id !== id));
  }

  async function generateCode(target: Target) {
    setGeneratingId(target.id);
    try {
      const res = await fetch(`/api/backoffice/outreach/${target.id}/generate-code`, { method: 'POST' });
      const body = await res.json();
      if (!body.ok) { setRowErr((e) => ({ ...e, [target.id]: body.error ?? 'Could not generate a code.' })); return; }
      refresh();
    } finally { setGeneratingId(null); }
  }

  const filtered = useMemo(() => {
    if (!targets) return [];
    return targets.filter((t) => {
      if (nameFilter.trim() && !t.name.toLowerCase().includes(nameFilter.trim().toLowerCase())) return false;
      if (typeFilter && t.kind !== typeFilter) return false;
      if (categoryFilter && t.category !== categoryFilter) return false;
      if (planFilter && !t.applicable_plans.includes(planFilter as PlanTier)) return false;
      if (discountMin.trim() && t.discount_pct < Number(discountMin)) return false;
      if (discountMax.trim() && t.discount_pct > Number(discountMax)) return false;
      if (statusFilter && t.status !== statusFilter) return false;
      if (dateFrom && (!t.contacted_on || t.contacted_on < dateFrom)) return false;
      if (dateTo && (!t.contacted_on || t.contacted_on > dateTo)) return false;
      return true;
    });
  }, [targets, nameFilter, typeFilter, categoryFilter, planFilter, discountMin, discountMax, statusFilter, dateFrom, dateTo]);

  const anyFilterSet = !!(nameFilter.trim() || typeFilter || categoryFilter || planFilter || discountMin.trim() || discountMax.trim() || statusFilter || dateFrom || dateTo);
  function clearFilters() {
    setNameFilter(''); setTypeFilter(''); setCategoryFilter(''); setPlanFilter('');
    setDiscountMin(''); setDiscountMax(''); setStatusFilter(''); setDateFrom(''); setDateTo('');
  }

  // Prompt 855 §A.4 — +1 for the new leading delete column. The derived
  // Redeemed column is still the one NOT counted here (colSpan below adds
  // its own +1 for that, unchanged) — 17 rendered <th> cells in total.
  const COLUMN_COUNT = 16;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Startups / Ecosystems</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Outreach to startups, accelerators, incubators and programs — each row can issue its own promo code
            (Promo Codes &amp; Offers is the one registry both doors write to).
          </p>
        </div>
        <CreateForm onCreated={refresh} />
      </div>

      {err && <p className="text-sm text-[#B00000]">{err}</p>}

      {!targets ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          {/* Prompt 854 §B.3 — filter bar, sticky at the top of the PAGE
              itself, outside the table's own scroll container. */}
          <div className="sticky top-0 z-30 flex flex-wrap items-end gap-2 rounded-t-2xl border-b border-gray-100 bg-white p-3">
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Name
              <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} autoComplete="off"
                className="w-36 rounded border border-gray-300 px-2 py-1 text-xs" />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Type
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                <option value="">Any</option>
                <option value="percent_off">Percentage</option>
                <option value="free_trial">Free trial</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Category
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                <option value="">Any</option>
                {(Object.keys(CATEGORY_LABEL) as OutreachCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Plan
              <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                <option value="">Any</option>
                {ELIGIBLE_PLAN_ROWS.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Discount %
              <div className="flex gap-1">
                <input type="number" placeholder="min" value={discountMin} autoComplete="off" onChange={(e) => setDiscountMin(e.target.value)}
                  className="w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                <input type="number" placeholder="max" value={discountMax} autoComplete="off" onChange={(e) => setDiscountMax(e.target.value)}
                  className="w-14 rounded border border-gray-300 px-1.5 py-1 text-xs" />
              </div>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                <option value="">Any</option>
                {(Object.keys(STATUS_LABEL) as OutreachStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Date from
              <input type="date" value={dateFrom} autoComplete="off" onChange={(e) => setDateFrom(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs" />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
              Date to
              <input type="date" value={dateTo} autoComplete="off" onChange={(e) => setDateTo(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs" />
            </label>
            {anyFilterSet && <button onClick={clearFilters} className="text-xs text-gray-400 hover:underline">Clear filters</button>}
            <span className="ml-auto text-xs text-gray-400">showing {filtered.length} of {targets.length}</span>
          </div>

          {targets.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">No outreach targets yet.</p>
          ) : (
            <div ref={scrollRef} onScroll={syncFromMain} className="max-h-[70vh] overflow-auto">
              <table ref={tableRef} className="w-full min-w-[1900px] text-xs">
                <thead ref={theadRef} className="sticky top-0 z-20 bg-white">
                  <tr className="border-b border-gray-200 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-400">
                    <th className="w-6 px-1 py-2" aria-hidden />
                    <th className="px-2 py-2">Name</th>
                    <th className="px-2 py-2">Category</th>
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2">Discount %</th>
                    <th className="px-2 py-2">Plan</th>
                    <th className="px-2 py-2">Redeemable until</th>
                    <th className="px-2 py-2">Benefit (mo)</th>
                    <th className="px-2 py-2">Max redemptions</th>
                    <th className="px-2 py-2">Promo code</th>
                    <th className="px-2 py-2">Site</th>
                    <th className="px-2 py-2">Mail</th>
                    <th className="px-2 py-2">Phone</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2">Comment / reply</th>
                    <th className="px-2 py-2">Redeemed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  <MirrorScrollRow columnCount={COLUMN_COUNT + 1} theadHeight={theadHeight} tableWidth={tableWidth}
                    mirrorRef={mirrorRef} onScroll={syncFromMirror} />
                  {filtered.length === 0 && (
                    <tr><td colSpan={COLUMN_COUNT + 1} className="px-2 py-6 text-center text-gray-400">No rows match these filters.</td></tr>
                  )}
                  {filtered.map((t) => {
                    const locked = !!t.promo_code_id;
                    const saving = savingId === t.id;
                    const effectivePct = normalizeDiscountForKind(t.kind, t.discount_pct);
                    return (
                      <tr key={t.id} className="align-top">
                        <td className="w-6 px-1 py-1.5">
                          <DeleteControl target={t} onDeleted={handleDeleted} />
                        </td>
                        <td className="px-2 py-1.5">
                          {saving && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[#0E7490]" title="Saving…" />}
                          <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && patchField(t.id, { name: e.target.value.trim() })}
                            autoComplete="off" className="w-32 rounded border border-transparent px-1 py-0.5 hover:border-gray-200 focus:border-gray-300" />
                          {rowErr[t.id] && <p className="mt-0.5 text-[10px] text-[#B00000]">{rowErr[t.id]}</p>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={t.category} onChange={(e) => patchField(t.id, { category: e.target.value })}
                            className="rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
                            {(Object.keys(CATEGORY_LABEL) as OutreachCategory[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          {locked ? (
                            <span className="text-gray-500" title="Offer locked — the promo code is already issued.">{t.kind === 'free_trial' ? 'Free trial' : 'Percentage'}</span>
                          ) : (
                            <select value={t.kind} onChange={(e) => patchField(t.id, { kind: e.target.value })}
                              className="rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
                              <option value="percent_off">Percentage</option>
                              <option value="free_trial">Free trial</option>
                            </select>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {locked ? (
                            <span className="text-gray-500" title="Offer locked — the promo code is already issued.">{effectivePct}%</span>
                          ) : (
                            <input type="number" min={1} max={100} disabled={t.kind === 'free_trial'} autoComplete="off"
                              defaultValue={effectivePct}
                              onBlur={(e) => Number(e.target.value) !== effectivePct && patchField(t.id, { discount_pct: Number(e.target.value) })}
                              className="w-14 rounded border border-transparent px-1 py-0.5 hover:border-gray-200 disabled:text-gray-400" />
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {locked ? (
                            <span className="text-gray-500" title="Offer locked — the promo code is already issued.">{t.applicable_plans.map(planLabelForSlug).join(', ') || '—'}</span>
                          ) : (
                            <select multiple value={t.applicable_plans} size={ELIGIBLE_PLAN_ROWS.length}
                              onChange={(e) => patchField(t.id, { applicable_plans: [...e.target.selectedOptions].map((o) => o.value) })}
                              className="w-28 rounded border border-gray-200 px-1 py-0.5 text-[11px]">
                              {ELIGIBLE_PLAN_ROWS.map((p) => <option key={p.tier} value={p.tier}>{p.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" disabled={locked} defaultValue={fmtDate(t.redeemable_until)} autoComplete="off"
                            onBlur={(e) => patchField(t.id, { redeemable_until: e.target.value ? new Date(e.target.value).toISOString() : null })}
                            className="rounded border border-transparent px-1 py-0.5 hover:border-gray-200 disabled:text-gray-400" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min={1} disabled={locked} defaultValue={t.benefit_duration_months ?? ''} autoComplete="off"
                            onBlur={(e) => patchField(t.id, { benefit_duration_months: e.target.value ? Number(e.target.value) : null })}
                            placeholder="∞" className="w-14 rounded border border-transparent px-1 py-0.5 hover:border-gray-200 disabled:text-gray-400" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min={1} disabled={locked} defaultValue={t.max_redemptions ?? ''} autoComplete="off"
                            onBlur={(e) => patchField(t.id, { max_redemptions: e.target.value ? Number(e.target.value) : null })}
                            placeholder="∞" className="w-14 rounded border border-transparent px-1 py-0.5 hover:border-gray-200 disabled:text-gray-400" />
                        </td>
                        <td className="px-2 py-1.5">
                          {t.promo_code ? (
                            <span className="flex items-center gap-1">
                              <span className="font-mono font-semibold text-gray-800">{t.promo_code}</span>
                              <button onClick={() => { navigator.clipboard.writeText(t.promo_code!).catch(() => {}); setCopiedId(t.id); setTimeout(() => setCopiedId((c) => (c === t.id ? '' : c)), 1500); }}
                                className="rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50">
                                {copiedId === t.id ? 'Copied!' : 'Copy'}
                              </button>
                            </span>
                          ) : (
                            <button onClick={() => generateCode(t)} disabled={generatingId === t.id || t.applicable_plans.length === 0}
                              className="rounded-lg bg-[#0E7490] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
                              {generatingId === t.id ? 'Generating…' : 'Generate'}
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={t.website ?? ''} autoComplete="off"
                            onBlur={(e) => e.target.value !== (t.website ?? '') && patchField(t.id, { website: e.target.value || null })}
                            className="w-28 rounded border border-transparent px-1 py-0.5 hover:border-gray-200" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={t.email ?? ''} autoComplete="off"
                            onBlur={(e) => e.target.value !== (t.email ?? '') && patchField(t.id, { email: e.target.value || null })}
                            className="w-32 rounded border border-transparent px-1 py-0.5 hover:border-gray-200" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input defaultValue={t.phone ?? ''} autoComplete="off"
                            onBlur={(e) => e.target.value !== (t.phone ?? '') && patchField(t.id, { phone: e.target.value || null })}
                            className="w-24 rounded border border-transparent px-1 py-0.5 hover:border-gray-200" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={t.status} onChange={(e) => patchField(t.id, { status: e.target.value })}
                            className="rounded border border-transparent px-1 py-0.5 hover:border-gray-200">
                            {(Object.keys(STATUS_LABEL) as OutreachStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" defaultValue={fmtDate(t.contacted_on)} autoComplete="off"
                            onBlur={(e) => patchField(t.id, { contacted_on: e.target.value || null })}
                            className="rounded border border-transparent px-1 py-0.5 hover:border-gray-200" />
                        </td>
                        <td className="px-2 py-1.5">
                          <textarea defaultValue={t.notes ?? ''} rows={1}
                            onBlur={(e) => e.target.value !== (t.notes ?? '') && patchField(t.id, { notes: e.target.value || null })}
                            className="max-h-[54px] w-40 resize-none overflow-y-auto rounded border border-transparent px-1 py-0.5 hover:border-gray-200" />
                        </td>
                        <td className="px-2 py-1.5 text-gray-600">
                          {!t.promo_code_id ? '—' : (
                            <span title={t.redeemed.map((r) => r.orgName).join(', ')}>
                              {t.redeemed.length}{t.max_redemptions ? ` / ${t.max_redemptions}` : ''}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
