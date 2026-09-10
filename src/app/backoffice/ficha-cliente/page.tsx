'use client';
// Prompt 877 — Backoffice "Data": Ficha do cliente. One list spanning both
// customer concepts this schema has (kind: 'org' | 'investor_entity' — the
// same discriminator ViewerEntryName.tsx already uses), reading
// /api/backoffice/ficha-cliente (this session's own new route).
//
// Nuno's one hard behavioral rule: with NO filters active, overdue accounts
// sort to the top and render in red (text-[#B00000]); the moment any filter
// is applied, sort reverts to normal. "Filters" here means the table's own
// name/date/category/payment filters — switching the Active/Arquivo tab is a
// different axis (which population you're looking at, not how it's ordered)
// and does not by itself turn the special sort off.
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Tabs } from '@/components/ui';
import { sortRows, sortIndicator } from '@/lib/table-sort';
import { useTableUrlState } from '@/lib/use-table-url-state';
import { PAGE_SIZES, pageCount, rangeLabel, toggleSort as urlToggleSort, type ColumnSortType } from '@/lib/queue-table-state';
import { CUSTOMER_FILTER_LABEL, matchesCustomerFilter, type CustomerFilter } from '@/lib/customer-filter';

interface CustomerRow {
  kind: 'org' | 'investor_entity';
  id: string;
  name: string;
  category: 'Startup' | 'VC';
  signupDate: string | null;
  plan: string;
  nextPaymentDueAt: string | null;
  lastPaymentAt: string | null;
  lastPaymentStatus: 'paid' | 'failed' | 'none' | null;
  paymentBucket: 'paid' | 'unpaid' | 'promo';
  isOverdue: boolean;
  isArchived: boolean;
}

type SortKey = 'name' | 'category' | 'signupDate' | 'plan' | 'nextPaymentDueAt' | 'paymentBucket';

const COLUMNS: { key: SortKey; label: string; type: ColumnSortType }[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'signupDate', label: 'Signup date', type: 'date' },
  { key: 'plan', label: 'Contracted plan', type: 'text' },
  { key: 'nextPaymentDueAt', label: 'Next payment', type: 'date' },
  { key: 'paymentBucket', label: 'Payment', type: 'text' },
];

const PAYMENT_STYLE: Record<CustomerRow['paymentBucket'], string> = {
  paid: 'bg-green-50 text-green-700', unpaid: 'bg-amber-50 text-amber-700', promo: 'bg-[#0E7490]/10 text-[#0E7490]',
};

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

function FichaClienteTable() {
  const [customers, setCustomers] = useState<CustomerRow[] | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'active' | 'archive'>('active');

  useEffect(() => {
    fetch('/api/backoffice/ficha-cliente').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load.'); return; }
      setCustomers(body.customers);
    }).catch(() => setErr('Could not load.'));
  }, []);

  const [tableState, setTableState] = useTableUrlState({ sortableKeys: COLUMNS.map((c) => c.key) });
  const q = tableState.filters.q ?? '';
  const category = tableState.filters.category ?? '';
  const payment = (tableState.filters.payment as CustomerFilter | undefined) ?? 'all';
  const signupFrom = tableState.filters.signupFrom ?? '';
  const signupTo = tableState.filters.signupTo ?? '';
  const lastPaymentFrom = tableState.filters.lastPaymentFrom ?? '';
  const lastPaymentTo = tableState.filters.lastPaymentTo ?? '';

  const hasActiveFilters = !!(q || category || payment !== 'all' || signupFrom || signupTo || lastPaymentFrom || lastPaymentTo);
  // Nuno's rule: sem filtros, os incumpridores vão para o topo, salientados a
  // vermelho. The moment a filter narrows the list, that's gone — the
  // reader asked for something specific, not a triage view.
  const showOverdueFirst = !hasActiveFilters && tableState.sort === null;

  const sortKey = (tableState.sort as SortKey | null) ?? 'name';
  const sortDir = tableState.sort ? tableState.dir : 'asc';

  function toggleSort(key: SortKey, type: ColumnSortType) {
    const { dir } = urlToggleSort(tableState, key, type);
    setTableState({ sort: key, dir });
  }

  function setFilter(key: string, value: string) {
    setTableState({ filters: { ...tableState.filters, [key]: value } });
  }

  const filteredSorted = useMemo(() => {
    let list = (customers ?? []).filter((c) => c.isArchived === (tab === 'archive'));
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
    if (category) list = list.filter((c) => c.category === category);
    list = list.filter((c) => matchesCustomerFilter(payment, { paymentBucket: c.paymentBucket }));
    if (signupFrom) list = list.filter((c) => c.signupDate && c.signupDate.slice(0, 10) >= signupFrom);
    if (signupTo) list = list.filter((c) => c.signupDate && c.signupDate.slice(0, 10) <= signupTo);
    if (lastPaymentFrom) list = list.filter((c) => c.lastPaymentAt && c.lastPaymentAt.slice(0, 10) >= lastPaymentFrom);
    if (lastPaymentTo) list = list.filter((c) => c.lastPaymentAt && c.lastPaymentAt.slice(0, 10) <= lastPaymentTo);

    if (showOverdueFirst) {
      const overdue = list.filter((c) => c.isOverdue);
      const rest = sortRows(list.filter((c) => !c.isOverdue), 'name', 'asc');
      return [...sortRows(overdue, 'name', 'asc'), ...rest];
    }
    return sortRows(list, sortKey, sortDir);
  }, [customers, tab, q, category, payment, signupFrom, signupTo, lastPaymentFrom, lastPaymentTo, showOverdueFirst, sortKey, sortDir]);

  const total = filteredSorted.length;
  const totalPages = pageCount(total, tableState.pageSize);
  const page = Math.min(tableState.page, totalPages);
  const rows = useMemo(
    () => filteredSorted.slice((page - 1) * tableState.pageSize, page * tableState.pageSize),
    [filteredSorted, page, tableState.pageSize],
  );

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!customers) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <Tabs items={[{ key: 'active', label: 'Active' }, { key: 'archive', label: 'Arquivo' }]} active={tab} onChange={(k) => setTab(k as 'active' | 'archive')} />
      <Card title={`Customers (${rangeLabel({ ...tableState, page }, total)})`}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Name
            <input value={q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Search…"
              className="w-44 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Category
            <select value={category} onChange={(e) => setFilter('category', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              <option value="Startup">Startup</option>
              <option value="VC">VC</option>
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Payment
            <select value={payment} onChange={(e) => setFilter('payment', e.target.value === 'all' ? '' : e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              {(Object.keys(CUSTOMER_FILTER_LABEL) as CustomerFilter[]).map((f) => (
                <option key={f} value={f}>{CUSTOMER_FILTER_LABEL[f]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Signup from
            <input type="date" value={signupFrom} onChange={(e) => setFilter('signupFrom', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Signup to
            <input type="date" value={signupTo} onChange={(e) => setFilter('signupTo', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Last payment from
            <input type="date" value={lastPaymentFrom} onChange={(e) => setFilter('lastPaymentFrom', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-gray-500">
            Last payment to
            <input type="date" value={lastPaymentTo} onChange={(e) => setFilter('lastPaymentTo', e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              {COLUMNS.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key, c.type)}
                  className="cursor-pointer whitespace-nowrap py-1.5 pr-3 hover:text-gray-700">
                  {c.label} {sortIndicator(sortKey === c.key, sortDir)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={`${c.kind}:${c.id}`} className={`border-t border-gray-50 ${showOverdueFirst && c.isOverdue ? 'text-[#B00000]' : ''}`}>
                <td className="py-2 pr-3 font-medium">
                  <Link href={`/backoffice/ficha-cliente/${c.kind}/${c.id}`} className="text-[#0E7490] hover:underline">
                    {c.name}
                  </Link>
                  {showOverdueFirst && c.isOverdue && <span className="ml-1.5 text-[10px] font-semibold">overdue</span>}
                </td>
                <td className="pr-3">{c.category}</td>
                <td className="pr-3 whitespace-nowrap">{fmt(c.signupDate)}</td>
                <td className="pr-3">{c.plan}</td>
                <td className="pr-3 whitespace-nowrap">{fmt(c.nextPaymentDueAt)}</td>
                <td className="pr-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PAYMENT_STYLE[c.paymentBucket]}`}>
                    {CUSTOMER_FILTER_LABEL[c.paymentBucket]}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="py-6 text-center text-gray-400">No customers match.</td></tr>
            )}
          </tbody>
        </table>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <select value={tableState.pageSize} onChange={(e) => setTableState({ pageSize: Number(e.target.value) as (typeof PAGE_SIZES)[number], page: 1 })}
            className="rounded border border-gray-300 px-1.5 py-1">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}/page</option>)}
          </select>
          <button disabled={page <= 1} onClick={() => setTableState({ page: page - 1 })} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Prev</button>
          <span>{page} / {totalPages || 1}</span>
          <button disabled={page >= totalPages} onClick={() => setTableState({ page: page + 1 })} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </Card>
    </div>
  );
}

export default function FichaClientePage() {
  return (
    <Suspense fallback={<p className="text-sm text-gray-400">Loading…</p>}>
      <FichaClienteTable />
    </Suspense>
  );
}
