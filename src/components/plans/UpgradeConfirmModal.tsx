'use client';
// "Here's what you gain" step before checkout/request — promote, not just
// charge. Modal convention (backdrop + stopPropagation card) matches
// AddInvestorModal.tsx, the existing pattern elsewhere in the app.
//
// Prompt (Sherlock Deal Stripe -> InvoiceXpress, 04/11/2026, decided by
// Nuno): when this is the real-checkout path (collectFiscalDetails), the
// modal also fetches and lets the founder edit the NIF/billing address that
// will end up on the fiscal invoice InvoiceXpress issues once the payment
// clears. A blank NIF is allowed, but only after the founder explicitly
// acknowledges — "Consumidor Final" otherwise — never silently.
//
// The investor side uses the same step through `catalogEntityId`: the details
// are then the firm's, not the org's (see /api/billing/fiscal-details). Portalled
// because the investor workspace's own ancestors are not ours to rely on (the
// project's rule for every full-viewport overlay).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlanCardData } from './types';
import { newItemsSince } from './types';

interface FiscalDetails {
  name: string;
  fiscalId: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
}

export function UpgradeConfirmModal({
  fromPlan,
  toPlan,
  onConfirm,
  onCancel,
  busy,
  confirmLabel,
  collectFiscalDetails,
  catalogEntityId,
}: {
  fromPlan: PlanCardData | undefined;
  toPlan: PlanCardData;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  confirmLabel: string;
  /** True on the real-checkout path only — the manual-request flow has no
   *  invoice to put a NIF on. */
  collectFiscalDetails?: boolean;
  /** Investor checkout: whose fiscal details these are. Absent = the caller's org. */
  catalogEntityId?: string;
}) {
  const gained = [...newItemsSince(toPlan, fromPlan)];

  const [fiscal, setFiscal] = useState<FiscalDetails | null>(null);
  const [loadingFiscal, setLoadingFiscal] = useState(!!collectFiscalDetails);
  const [skipNif, setSkipNif] = useState(false);
  const [savingFiscal, setSavingFiscal] = useState(false);
  const [fiscalErr, setFiscalErr] = useState('');

  useEffect(() => {
    if (!collectFiscalDetails) return;
    setLoadingFiscal(true);
    const query = catalogEntityId ? `?catalog_entity_id=${encodeURIComponent(catalogEntityId)}` : '';
    fetch(`/api/billing/fiscal-details${query}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((body) => {
        if (body.ok) {
          setFiscal(body.details as FiscalDetails);
          setSkipNif(!body.details?.fiscalId);
        } else {
          setFiscal({ name: '', fiscalId: null, address: null, postalCode: null, city: null, country: 'PT' });
        }
      })
      .catch(() => setFiscal({ name: '', fiscalId: null, address: null, postalCode: null, city: null, country: 'PT' }))
      .finally(() => setLoadingFiscal(false));
    // Only on first open of this instance — the modal is remounted (key on
    // the chosen tier changing, via its own conditional render) each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField<K extends keyof FiscalDetails>(key: K, value: FiscalDetails[K]) {
    setFiscal((f) => (f ? { ...f, [key]: value } : f));
    if (key === 'fiscalId' && value) { setSkipNif(false); setFiscalErr(''); }
  }

  const missingNif = collectFiscalDetails && fiscal && !fiscal.fiscalId;
  const canConfirm = !collectFiscalDetails || !missingNif || skipNif;

  async function handleConfirm() {
    if (!collectFiscalDetails) { onConfirm(); return; }
    if (missingNif && !skipNif) { setFiscalErr('Enter the tax number, or confirm you want to continue without it.'); return; }
    setSavingFiscal(true);
    setFiscalErr('');
    try {
      const res = await fetch('/api/billing/fiscal-details', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(catalogEntityId ? { catalogEntityId } : {}),
          fiscalId: fiscal?.fiscalId ?? '',
          address: fiscal?.address ?? '',
          postalCode: fiscal?.postalCode ?? '',
          city: fiscal?.city ?? '',
          country: fiscal?.country ?? 'PT',
        }),
      });
      const body = await res.json();
      if (!body.ok) { setFiscalErr(body.error ?? 'Could not save the billing details.'); return; }
      onConfirm();
    } catch {
      setFiscalErr('Could not save the billing details.');
    } finally {
      setSavingFiscal(false);
    }
  }

  const working = !!busy || savingFiscal;

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-800">Switch to {toPlan.name}?</h2>
          <button onClick={onCancel} className="text-sm text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <p className="mt-1 text-xs text-gray-500">{toPlan.priceLabel}{toPlan.priceSubLabel ? ` · ${toPlan.priceSubLabel}` : ''}</p>

        {gained.length > 0 ? (
          <>
            <p className="mt-4 text-xs font-semibold text-gray-700">
              By switching to {toPlan.name}, you gain:
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-gray-600">
              {gained.map((b) => (
                <li key={b} className="flex items-start gap-1.5">
                  <span className="text-[#0E7490]">✓</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 text-xs text-gray-500">
            This plan has the same features as your current one, at a different price/billing period.
          </p>
        )}

        {collectFiscalDetails && (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold text-gray-700">Billing/invoice details</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Used to issue your fiscal invoice. Pre-filled from your {catalogEntityId ? 'firm' : 'organisation'} — edit if needed.
            </p>
            {loadingFiscal ? (
              <p className="mt-2 text-xs text-gray-400">Loading…</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                <input value={fiscal?.fiscalId ?? ''} onChange={(e) => setField('fiscalId', e.target.value)}
                  placeholder="NIF / Tax number" maxLength={30}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                <input value={fiscal?.address ?? ''} onChange={(e) => setField('address', e.target.value)}
                  placeholder="Billing address" maxLength={200}
                  className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                <div className="flex gap-1.5">
                  <input value={fiscal?.postalCode ?? ''} onChange={(e) => setField('postalCode', e.target.value)}
                    placeholder="Postal code" maxLength={30}
                    className="w-1/3 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                  <input value={fiscal?.city ?? ''} onChange={(e) => setField('city', e.target.value)}
                    placeholder="City" maxLength={100}
                    className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
                </div>
                {missingNif && (
                  <label className="mt-1 flex items-start gap-1.5 text-[11px] text-amber-800">
                    <input type="checkbox" checked={skipNif} onChange={(e) => setSkipNif(e.target.checked)} className="mt-0.5" />
                    <span>No NIF — I understand the invoice will be issued to &quot;Consumidor Final&quot;, without a tax number.</span>
                  </label>
                )}
                {fiscalErr && <p className="text-[11px] text-[#B00000]">{fiscalErr}</p>}
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={working}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={working || loadingFiscal || !canConfirm}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
            {working ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
