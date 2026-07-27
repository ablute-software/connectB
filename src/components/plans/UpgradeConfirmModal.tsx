'use client';
// "Here's what you gain" step before checkout/request — promote, not just
// charge. Modal convention (backdrop + stopPropagation card) matches
// AddInvestorModal.tsx, the existing pattern elsewhere in the app.
import type { PlanCardData } from './types';
import { newBulletsSince } from './types';

export function UpgradeConfirmModal({
  fromPlan,
  toPlan,
  onConfirm,
  onCancel,
  busy,
  confirmLabel,
}: {
  fromPlan: PlanCardData | undefined;
  toPlan: PlanCardData;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  confirmLabel: string;
}) {
  const gained = [...newBulletsSince(toPlan, fromPlan)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
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

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0c637b] disabled:opacity-40">
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
