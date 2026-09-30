'use client';
// Prompt 746 Phase 1 — the investor's own Portfolio tab. Replaces the
// unused About > Import sub-tab (about-tabs/ImportTab.tsx, removed):
// that wrote to investor_declared_investments, which had 0 rows in
// production and no real reader — a form nobody used, promising a match
// benefit ("Helps Sherlock match you with better-fit startups") it never
// delivered. This panel makes no such promise; its own copy below says
// only what Phase 1 actually does.
//
// Phase 1 scope, deliberately: data only. "Invite to Sherlock Deal" is
// visibly present but disabled ("Coming soon") on every row — Phase 2 is
// what wires an actual invite, magic-link association, and verified
// linking (linked_org_id/link_status, reserved on the table already).
// Nothing on this page ever calls an invite/email endpoint.
import { useEffect, useState } from 'react';
import { Card, Tabs, type TabItem } from '@/components/ui';
import { EmptyState } from '@/components/workspace-shell/EmptyState';
import { SectorPicker, type SectorValue } from '@/components/company/SectorPicker';
import { useTabParam } from '@/lib/use-tab';
import { formatTicketEur } from '@/lib/ticket-range';
import {
  autoMapColumns, buildPortfolioImportPlan, parsePortfolioCsvRows, parsePortfolioXlsxRows, portfolioImportTemplateCsv,
  PORTFOLIO_IMPORT_FIELDS, type ColumnMapping, type PortfolioImportField, type PortfolioImportPlan,
} from '@/lib/portfolio-import';

type PortfolioStatus = 'current' | 'past';

interface PortfolioCompany {
  id: string; status: PortfolioStatus; company_name: string; website: string | null; domain: string | null;
  country: string | null; stage_at_entry: string | null; sectors: string[]; ticket_eur: number | null;
  instrument: string | null; invested_at: string | null; exit_at: string | null; exit_type: string | null;
  contact_name: string | null; contact_email: string | null; source: 'manual' | 'import'; created_at: string;
}

const STAGE_LABELS: Record<string, string> = {
  pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B',
  series_c_plus: 'Series C+', later: 'Later', other: 'Other',
};
const INSTRUMENT_LABELS: Record<string, string> = {
  equity: 'Equity', safe: 'SAFE', convertible_note: 'Convertible note', other: 'Other',
};
const EXIT_TYPE_LABELS: Record<string, string> = {
  acquisition: 'Acquisition', ipo: 'IPO', write_off: 'Write-off', other: 'Other',
};

const VIEW_TABS: TabItem[] = [{ key: 'current', label: 'Current' }, { key: 'past', label: 'Past' }];

export function PortfolioPanel() {
  const [view, setView] = useTabParam('current', 'view');
  const [linked, setLinked] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<PortfolioCompany[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);

  function load() {
    fetch('/api/portal/investor-profile/portfolio').then((r) => r.json()).then((d) => {
      setLinked(!!d.linked);
      setCompanies(d.linked ? d.companies : []);
    }).catch(() => { setLinked(false); setCompanies([]); });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const status: PortfolioStatus = view === 'past' ? 'past' : 'current';
  const rows = (companies ?? []).filter((c) => c.status === status);

  async function remove(id: string) {
    await fetch(`/api/portal/investor-profile/portfolio?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  }

  if (linked === false) {
    return (
      <EmptyState
        message="Link your firm first."
        hint="Open About your firm in the sidebar, then come back here — Portfolio needs to know which firm these companies belong to."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-gray-600">
          Your portfolio, in one place. You&apos;ll be able to invite your portfolio companies to Sherlock Deal.
        </p>
      </Card>

      <Tabs items={VIEW_TABS} active={view} onChange={setView} />

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setShowAddForm((v) => !v); setShowImport(false); }}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
          {showAddForm ? 'Cancel' : 'Add manually'}
        </button>
        <button onClick={() => { setShowImport((v) => !v); setShowAddForm(false); }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          {showImport ? 'Cancel' : 'Import CSV/Excel'}
        </button>
      </div>

      {showAddForm && (
        <AddManuallyForm status={status} onAdded={() => { setShowAddForm(false); load(); }} />
      )}
      {showImport && (
        <ImportFlow existing={companies ?? []} onImported={() => { setShowImport(false); load(); }} />
      )}

      {companies === null ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-gray-400">Nothing here yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-gray-100 text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Geography</th>
                <th className="px-3 py-2 font-medium">Stage at entry</th>
                <th className="px-3 py-2 font-medium">Sectors</th>
                <th className="px-3 py-2 font-medium">Ticket</th>
                <th className="px-3 py-2 font-medium">Instrument</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                {status === 'past' && <th className="px-3 py-2 font-medium">Exit</th>}
                <th className="px-3 py-2 font-medium" />
                <th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {c.website
                      ? <a href={c.website} target="_blank" rel="noreferrer" className="hover:underline">{c.company_name}</a>
                      : c.company_name}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{c.country ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.stage_at_entry ? STAGE_LABELS[c.stage_at_entry] ?? c.stage_at_entry : '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.sectors.length ? c.sectors.join(', ') : '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.ticket_eur != null ? formatTicketEur(c.ticket_eur) : '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.instrument ? INSTRUMENT_LABELS[c.instrument] ?? c.instrument : '—'}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {c.contact_name || c.contact_email
                      ? <>{c.contact_name}{c.contact_name && c.contact_email ? ' · ' : ''}{c.contact_email}</>
                      : '—'}
                  </td>
                  {status === 'past' && (
                    <td className="px-3 py-2 text-gray-600">
                      {c.exit_type ? EXIT_TYPE_LABELS[c.exit_type] ?? c.exit_type : '—'}
                      {c.exit_at ? ` (${c.exit_at.slice(0, 10)})` : ''}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    {/* Phase 2 wires this up for real — see this file's own
                        header. Visibly present rather than absent, per
                        Nuno's own instruction, so this reads as a boundary
                        rather than a bug. */}
                    <button disabled title="Coming soon"
                      className="cursor-not-allowed whitespace-nowrap rounded-full border border-gray-200 px-2.5 py-1 text-[11px] text-gray-400">
                      Invite to Sherlock Deal <span className="text-gray-300">(Coming soon)</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(c.id)} className="text-gray-400 hover:text-[#B00000]">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddManuallyForm({ status, onAdded }: { status: PortfolioStatus; onAdded: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('');
  const [stageAtEntry, setStageAtEntry] = useState('');
  const [sectorValue, setSectorValue] = useState<SectorValue>({ sectors: [], other: null });
  const [ticketEur, setTicketEur] = useState('');
  const [instrument, setInstrument] = useState('');
  const [investedAt, setInvestedAt] = useState('');
  const [exitAt, setExitAt] = useState('');
  const [exitType, setExitType] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!companyName.trim()) { setErr('Company name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/portfolio', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status, companyName: companyName.trim(), website: website.trim() || undefined,
          country: country.trim() || undefined, stageAtEntry: stageAtEntry || undefined,
          sectors: sectorValue.sectors, ticketEur: ticketEur.trim() || undefined,
          instrument: instrument || undefined, investedAt: investedAt || undefined,
          exitAt: status === 'past' ? (exitAt || undefined) : undefined,
          exitType: status === 'past' ? (exitType || undefined) : undefined,
          contactName: contactName.trim() || undefined, contactEmail: contactEmail.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      onAdded();
    } catch {
      setErr('Network error — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <Card title={`Add a ${status === 'past' ? 'past' : 'current'} portfolio company`}>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Prompt 553 — autoComplete="off" throughout this form: every field
            here is data ABOUT A PORTFOLIO COMPANY, never the signed-in
            investor's own personal/contact data, so none of it qualifies
            for the "genuinely the user's own" exception that rule carves
            out. Same reasoning SectorPicker.tsx's own header gives for its
            search box. */}
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name *"
          autoComplete="off" name="portfolio-company-name" data-1p-ignore data-lpignore="true"
          className="col-span-2 rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website"
          autoComplete="off" name="portfolio-company-website" data-1p-ignore data-lpignore="true"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country"
          autoComplete="off" name="portfolio-company-country" data-1p-ignore data-lpignore="true"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <select value={stageAtEntry} onChange={(e) => setStageAtEntry(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5">
          <option value="">Stage at entry</option>
          {Object.entries(STAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5">
          <option value="">Instrument</option>
          {Object.entries(INSTRUMENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="text" inputMode="decimal" value={ticketEur} onChange={(e) => setTicketEur(e.target.value)}
          placeholder="Ticket, e.g. 350k or €1.2M" autoComplete="off" name="portfolio-ticket-eur"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
          Invested
          <input type="date" value={investedAt} onChange={(e) => setInvestedAt(e.target.value)} autoComplete="off"
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5" />
        </label>
        {status === 'past' && (
          <>
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              Exit
              <input type="date" value={exitAt} onChange={(e) => setExitAt(e.target.value)} autoComplete="off"
                className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5" />
            </label>
            <select value={exitType} onChange={(e) => setExitType(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5">
              <option value="">Exit type</option>
              {Object.entries(EXIT_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </>
        )}
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact name"
          autoComplete="off" name="portfolio-contact-name" data-1p-ignore data-lpignore="true"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Contact email"
          autoComplete="off" name="portfolio-contact-email" data-1p-ignore data-lpignore="true"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
      </div>
      <div className="mt-2">
        <SectorPicker value={sectorValue} onChange={setSectorValue} allowOther={false} />
      </div>
      {err && <p className="mt-1.5 text-[11px] text-[#B00000]">{err}</p>}
      <button onClick={submit} disabled={busy}
        className="mt-3 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
        {busy ? 'Adding…' : 'Add company'}
      </button>
    </Card>
  );
}

function ImportFlow({ existing, onImported }: { existing: PortfolioCompany[]; onImported: () => void }) {
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [plan, setPlan] = useState<PortfolioImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<{ created: number; skippedDuplicate: number; skippedInvalid: number } | null>(null);

  function downloadTemplate() {
    const blob = new Blob([portfolioImportTemplateCsv()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'portfolio-import-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Preview is computed ENTIRELY client-side — no round trip. The
  // duplicate-detection half needs "what does this firm already have", and
  // the parent panel already fetched that (the same list the table below
  // renders), so a server call here would just be re-fetching data this
  // component was already handed. Nothing is written until commit(), which
  // IS a server call — that one re-validates and re-checks duplicates
  // server-side rather than trusting this preview (see the commit route's
  // own header), so a stale `existing` snapshot here can never cause a bad
  // write, only a preview that's briefly out of date.
  function computePlan(rows: string[][], m: ColumnMapping) {
    const existingForDedupe = existing.map((c) => ({ companyName: c.company_name, domain: c.domain }));
    setPlan(buildPortfolioImportPlan(rows, existingForDedupe, m));
  }

  async function onFile(file: File) {
    setErr(''); setResult(null); setPlan(null); setFileRows(null);
    setFileName(file.name);
    try {
      let rows: string[][];
      if (/\.xlsx?$/i.test(file.name)) {
        rows = parsePortfolioXlsxRows(await file.arrayBuffer());
      } else {
        rows = parsePortfolioCsvRows(await file.text());
      }
      if (rows.length === 0) { setErr('The file looked empty.'); return; }
      const autoMapping = autoMapColumns(rows[0]);
      setFileRows(rows);
      setMapping(autoMapping);
      computePlan(rows, autoMapping);
    } catch (e) {
      setErr((e as Error).message || 'Could not read that file.');
    }
  }

  function changeMapping(field: PortfolioImportField, idx: number | null) {
    if (!fileRows) return;
    const next = { ...mapping };
    if (idx === null) delete next[field]; else next[field] = idx;
    setMapping(next);
    computePlan(fileRows, next);
  }

  function toggleInclude(row: number) {
    if (!plan) return;
    setPlan({ ...plan, items: plan.items.map((it) => (it.row === row ? { ...it, include: !it.include } : it)) });
  }

  async function commit() {
    if (!plan) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/portal/investor-profile/portfolio/import/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: plan.items }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setErr(body.error ?? 'Import failed.'); return; }
      setResult(body);
      onImported();
    } catch {
      setErr('Network error — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <Card title="Import CSV/Excel">
      <p className="text-xs text-gray-500">
        Download the template, fill it in, then upload it here. Nothing is saved until you review the
        preview below and click Import — and importing never sends anything to anyone.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={downloadTemplate} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          Download template
        </button>
        <input type="file" accept=".csv,.xlsx,.xls"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          className="text-xs" />
      </div>
      {fileName && <p className="mt-1 text-[11px] text-gray-400">{fileName}</p>}
      {err && <p className="mt-1.5 text-[11px] text-[#B00000]">{err}</p>}

      {fileRows && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-gray-700">Column mapping</h4>
          <p className="text-[11px] text-gray-400">Detected automatically — fix anything that looks wrong before importing.</p>
          <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PORTFOLIO_IMPORT_FIELDS.map((field) => (
              <label key={field} className="text-[11px] text-gray-500">
                {field}
                <select value={mapping[field] ?? ''}
                  onChange={(e) => changeMapping(field, e.target.value === '' ? null : Number(e.target.value))}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                  <option value="">— none —</option>
                  {fileRows[0].map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {plan && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold text-gray-700">
            Preview ({plan.items.filter((it) => it.include).length}/{plan.items.length} rows will be imported)
          </h4>
          <ul className="mt-1 max-h-72 space-y-1 overflow-y-auto text-xs">
            {plan.items.map((it) => (
              <li key={it.row}
                className={`rounded-lg border px-2.5 py-1.5 ${it.errors.length ? 'border-red-100 bg-red-50/50' : it.duplicate ? 'border-amber-100 bg-amber-50/50' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={it.include} disabled={it.data === null || it.errors.length > 0}
                    onChange={() => toggleInclude(it.row)} />
                  <span className="font-medium">Row {it.row}</span>
                  <span className="text-gray-600">{it.data?.companyName ?? '(no company name)'}</span>
                  {it.duplicate && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                      duplicate ({it.duplicate.reason}, {it.duplicate.against === 'existing' ? 'already in your portfolio' : 'repeated in this file'})
                    </span>
                  )}
                </div>
                {it.errors.length > 0 && (
                  <ul className="ml-6 mt-0.5 list-disc text-[11px] text-[#B00000]">
                    {it.errors.map((e, i) => <li key={i}>{e.field ? `${e.field}: ` : ''}{e.message}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <button onClick={commit} disabled={busy || plan.items.every((it) => !it.include)}
            className="mt-2 rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? 'Importing…' : `Import ${plan.items.filter((it) => it.include).length} compan${plan.items.filter((it) => it.include).length === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      )}

      {result && (
        <p className="mt-2 text-xs text-green-700">
          Imported {result.created}. Skipped {result.skippedDuplicate} duplicate{result.skippedDuplicate === 1 ? '' : 's'} and{' '}
          {result.skippedInvalid} invalid row{result.skippedInvalid === 1 ? '' : 's'}.
        </p>
      )}
    </Card>
  );
}
