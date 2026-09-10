'use client';
// Prompt 877 — Ficha do cliente detail page. See the sibling API route's own
// header for the two flagged scope decisions (876's attachments/email-lock
// fields not yet available on this branch; VC-portfolio cross-reference not
// buildable at all).
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface Invoice {
  id: string; stripe_invoice_id: string; amount_due_cents: number; amount_paid_cents: number;
  currency: string; status: string; due_date: string | null; paid_at: string | null;
  hosted_invoice_url: string | null; created_at: string;
}
interface Redemption {
  code: string | null; label: string | null; discountPct: number | null;
  redeemedAt: string; benefitEndsAt: string | null;
  outreachTarget: { name: string; category: string; status: string } | null;
}
interface Customer {
  kind: 'org' | 'investor_entity'; id: string; name: string; signupDate: string | null;
  plan: string; description: string | null; nextPaymentDueAt: string | null;
  lastPaymentStatus: string | null; invoices: Invoice[];
  redemptions?: Redemption[];
  portfolioNotBuildableReason?: string;
}

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}
function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

export default function FichaClienteDetailPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/backoffice/ficha-cliente/${kind}/${id}`).then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load.'); return; }
      setCustomer(body.customer);
    }).catch(() => setErr('Could not load.'));
  }, [kind, id]);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!customer) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/backoffice/ficha-cliente" className="text-xs text-[#0E7490] hover:underline">← Ficha do cliente</Link>
      </div>
      <h1 className="text-lg font-semibold text-gray-900">{customer.name}</h1>

      <Card title="Overview">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-[11px] uppercase text-gray-400">Category</dt><dd>{customer.kind === 'org' ? 'Startup' : 'VC'}</dd></div>
          <div><dt className="text-[11px] uppercase text-gray-400">Signup date</dt><dd>{fmt(customer.signupDate)}</dd></div>
          <div><dt className="text-[11px] uppercase text-gray-400">Contracted plan</dt><dd>{customer.plan}</dd></div>
          <div><dt className="text-[11px] uppercase text-gray-400">Next payment</dt><dd>{fmt(customer.nextPaymentDueAt)}</dd></div>
          <div><dt className="text-[11px] uppercase text-gray-400">Last payment status</dt><dd>{customer.lastPaymentStatus ?? '—'}</dd></div>
        </dl>
        {customer.description && (
          <p className="mt-3 whitespace-pre-wrap border-t border-gray-100 pt-3 text-sm text-gray-600">{customer.description}</p>
        )}
      </Card>

      <Card title={`Invoices (${customer.invoices.length})`}>
        {customer.invoices.length === 0 ? (
          <p className="text-sm text-gray-400">No invoices yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3">Date</th><th className="pr-3">Status</th><th className="pr-3">Due</th>
                <th className="pr-3">Paid</th><th className="pr-3">Amount</th><th>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {customer.invoices.map((inv) => (
                <tr key={inv.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3 whitespace-nowrap">{fmt(inv.created_at)}</td>
                  <td className="pr-3">{inv.status}</td>
                  <td className="pr-3 whitespace-nowrap">{fmt(inv.due_date)}</td>
                  <td className="pr-3 whitespace-nowrap">{fmt(inv.paid_at)}</td>
                  <td className="pr-3 whitespace-nowrap">{money(inv.amount_paid_cents || inv.amount_due_cents, inv.currency)}</td>
                  <td>
                    {inv.hosted_invoice_url
                      ? <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="text-[#0E7490] hover:underline">Open</a>
                      : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {customer.kind === 'org' && (
        <Card title="Promo code">
          {!customer.redemptions || customer.redemptions.length === 0 ? (
            <p className="text-sm text-gray-400">No promo code redeemed.</p>
          ) : (
            <ul className="space-y-3">
              {customer.redemptions.map((r, i) => (
                <li key={i} className="rounded-lg border border-gray-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.code ?? '—'}</span>
                    {r.label && <span className="text-xs text-gray-500">{r.label}</span>}
                    {r.discountPct != null && <span className="rounded-full bg-[#0E7490]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0E7490]">{r.discountPct}% off</span>}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Redeemed {fmt(r.redeemedAt)}{r.benefitEndsAt && ` · benefit until ${fmt(r.benefitEndsAt)}`}
                  </p>
                  {r.outreachTarget && (
                    <p className="mt-1 text-xs text-gray-500">
                      Outreach target: <b>{r.outreachTarget.name}</b> ({r.outreachTarget.category}) · {r.outreachTarget.status}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {customer.kind === 'investor_entity' && customer.portfolioNotBuildableReason && (
        <Card title="Portfolio-company promo codes">
          <p className="text-sm text-gray-400">Not buildable — {customer.portfolioNotBuildableReason}</p>
        </Card>
      )}
    </div>
  );
}
