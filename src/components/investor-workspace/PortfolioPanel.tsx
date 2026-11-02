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
//
// Prompt 753 — the Nuno review that followed: (1) the import can misread a
// PT-formatted file in silence, fixed in portfolio-import.ts, surfaced here
// as a per-row warning the investor can inspect and fix cell-by-cell before
// committing; (2) nothing could be corrected after import without deleting
// the row and retyping it — this file now has an Edit form (PATCH) next to
// Remove, and Remove asks once before it actually deletes anything.
//
// Prompt AL759 — the panel also owns search/filter/sort state (in the URL),
// the row selection and the move flow; the table, the search box and the
// import preview are components of their own (PortfolioTable, PortfolioSearch,
// ImportPreview), with the rules in portfolio-table.ts / portfolio-import.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card, Tabs, type TabItem } from '@/components/ui';
import { EmptyState } from '@/components/workspace-shell/EmptyState';
import { SectorPicker, type SectorValue } from '@/components/company/SectorPicker';
import {
  buildPortfolioImportPlan, detectDuplicates, detectHeaderAndMapping, parsePortfolioCsvRows, parsePortfolioFields,
  parsePortfolioXlsxRows, pickImportTargetStatus, portfolioImportTemplateCsv, portfolioTemplateFilename, acceptedValuesHelp,
  stripEmptyRowsAndColumns, effectiveMappingForDestination, droppedExitNotice, mappingSummary, shouldCollapseMapping,
  visibleMappingFields, setIncludeForClass, errorRowsCsv,
  type ColumnMapping, type PortfolioImportField, type PortfolioImportPlan, type PortfolioImportPlanItem,
} from '@/lib/portfolio-import';
import {
  EMPTY_QUERY, EXIT_TYPE_LABELS, INSTRUMENT_LABELS, STAGE_LABELS, arrangeCompanies, chunkIds, clampPage, hasQuery,
  listAfter, moveButtonLabel, moveConfirmation, moveTarget, nextSort, noMatchText, pageSelection, pageSlice,
  parseListParams, parsePageParam, pruneSelection, selectAllPrompt, summarizeMoveResults, toggleOne, togglePageSelection,
  viewAfter, writeListParams,
  type MoveBatchResult, type PortfolioCompany, type PortfolioListState, type PortfolioSortKey, type PortfolioTab,
  type PortfolioViewState, type TaggedFilter,
} from '@/lib/portfolio-table';
import { PortfolioTable } from './PortfolioTable';
import { PortfolioSearch } from './PortfolioSearch';
import { ImportPreview } from './ImportPreview';

type PortfolioStatus = PortfolioTab;

const VIEW_TABS: TabItem[] = [{ key: 'current', label: 'Current' }, { key: 'past', label: 'Past' }];

// Prompt AL758 §B — the tab AND the page live in the URL (?view=past&page=2),
// so a shared link opens the same view. Prompt AL759 adds the search text,
// the tagged filter and the sort (?q= ?f= ?sort= ?dir=). useTabParam only
// knows one param and would need several router.replace calls (a race) to
// change tab, page and search together; this writes everything in one go.
// Defaults (Current, page 1, no search, no sort) stay out of the URL.
function usePortfolioUrl(): {
  tab: PortfolioTab; page: number; list: PortfolioListState; go: (view: PortfolioViewState, list: PortfolioListState) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const spString = sp.toString();
  const tab: PortfolioTab = sp.get('view') === 'past' ? 'past' : 'current';
  const page = parsePageParam(sp.get('page'));
  const list = useMemo(() => parseListParams(new URLSearchParams(spString), tab), [spString, tab]);
  const go = useCallback((view: PortfolioViewState, nextList: PortfolioListState) => {
    const params = new URLSearchParams(spString);
    if (view.tab === 'current') params.delete('view'); else params.set('view', view.tab);
    if (view.page <= 1) params.delete('page'); else params.set('page', String(view.page));
    writeListParams(params, nextList);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, spString]);
  return { tab, page, list, go };
}

interface MoveResult { text: string; to: PortfolioTab; failed: boolean }

export function PortfolioPanel() {
  const { tab: status, page: urlPage, list, go } = usePortfolioUrl();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [companies, setCompanies] = useState<PortfolioCompany[] | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmMove, setConfirmMove] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveResult, setMoveResult] = useState<MoveResult | null>(null);

  function load() {
    fetch('/api/portal/investor-profile/portfolio').then((r) => r.json()).then((d) => {
      setLinked(!!d.linked);
      setCompanies(d.linked ? d.companies : []);
    }).catch(() => { setLinked(false); setCompanies([]); });
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tabRows = useMemo(() => (companies ?? []).filter((c) => c.status === status), [companies, status]);
  // Filter, then order the WHOLE set (the investor's own column sort wins;
  // otherwise relevance when searching; otherwise newest first), and only
  // then slice a page.
  const arranged = useMemo(() => arrangeCompanies(tabRows, list.query, list.sort), [tabRows, list]);
  const page = clampPage(urlPage, arranged.length);
  const here: PortfolioViewState = { tab: status, page };
  const goTo = (view: PortfolioViewState, nextList: PortfolioListState) => go(view, nextList);
  // The URL is the source of truth, but it updates asynchronously: two quick
  // clicks on a header would both read the OLD sort and both answer "ascending"
  // instead of ascending then descending. So handlers read the last state the
  // investor asked for (listRef), which the URL then catches up with.
  const listRef = useRef(list);
  useEffect(() => { listRef.current = list; }, [list]);
  /** Any change to the text, the tagged filter or the sort starts again at page 1. */
  const changeList = (nextList: PortfolioListState) => { listRef.current = nextList; go({ tab: status, page: 1 }, nextList); };

  // A page that no longer exists (the last row of page 3 was removed, or a
  // stale link says page=9) is corrected in the URL too, not only on screen.
  useEffect(() => {
    if (companies !== null && page !== urlPage) go({ tab: status, page }, list);
  }, [companies, page, urlPage, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- selection (Prompt AL759 §C): only ever rows the investor can see -----
  const arrangedIds = useMemo(() => arranged.map((c) => c.id), [arranged]);
  const effectiveSelected = useMemo(() => pruneSelection(selected, arrangedIds), [selected, arrangedIds]);
  const pageIds = useMemo(() => pageSlice(arranged, page).map((c) => c.id), [arranged, page]);
  const prompt = selectAllPrompt(effectiveSelected, pageIds, arrangedIds);
  const selectedRows = tabRows.filter((c) => effectiveSelected.has(c.id));

  // Changing tab, search, filter or sort clears the selection — a row the
  // investor can no longer see is never moved. (Paging does not: "Select all
  // N matching" deliberately spans pages.)
  const listKey = JSON.stringify([status, list.query, list.sort]);
  useEffect(() => { setSelected(new Set()); setConfirmMove(null); }, [listKey]);

  const moveTo = moveTarget(status);

  async function doMove() {
    setConfirmMove(null);
    setMoving(true);
    const results: MoveBatchResult[] = [];
    // 500 ids is the route's ceiling; more than that goes in sequential
    // batches, each atomic on its own, and the result line adds them up.
    for (const batch of chunkIds([...effectiveSelected])) {
      try {
        const res = await fetch('/api/portal/investor-profile/portfolio/move', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: batch, to: moveTo }),
        });
        const body = await res.json().catch(() => ({}));
        results.push(body.ok ? { ok: true, moved: body.moved ?? 0, clearedExitData: body.clearedExitData ?? 0 } : { ok: false });
      } catch { results.push({ ok: false }); }
    }
    const summary = summarizeMoveResults(results, moveTo);
    setMoveResult({ text: summary.text, to: moveTo, failed: summary.failedBatches > 0 });
    setSelected(new Set());
    setMoving(false);
    // The list reloads and the investor stays where they were (the page is
    // re-clamped against the new total by the effect above) — no F5.
    load();
  }

  function requestMove() {
    const confirmation = moveConfirmation(selectedRows, moveTo);
    if (confirmation.needed) setConfirmMove(confirmation.text); else void doMove();
  }

  async function remove(id: string) {
    setRemoveBusy(true);
    try {
      await fetch(`/api/portal/investor-profile/portfolio?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      setConfirmRemoveId(null);
      load();
    } finally { setRemoveBusy(false); }
  }

  if (linked === false) {
    return (
      <EmptyState
        message="Link your firm first."
        hint="Open About your firm in the sidebar, then come back here — Portfolio needs to know which firm these companies belong to."
      />
    );
  }

  const editingCompany = editingId ? (companies ?? []).find((c) => c.id === editingId) ?? null : null;
  const noMatch = hasQuery(list.query) && arranged.length === 0 && tabRows.length > 0
    ? { text: noMatchText(list.query), onClear: () => changeList({ query: EMPTY_QUERY, sort: listRef.current.sort }) }
    : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-gray-600">
          Your portfolio, in one place. You&apos;ll be able to invite your portfolio companies to Sherlock Deal.
        </p>
      </Card>

      <Tabs items={VIEW_TABS} active={status}
        onChange={(key) => goTo(viewAfter(here, { type: 'switch-tab', tab: key === 'past' ? 'past' : 'current' }), listAfter(list, 'switch-tab'))} />

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { setShowAddForm((v) => !v); setShowImport(false); setEditingId(null); }}
          className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white">
          {showAddForm ? 'Cancel' : 'Add manually'}
        </button>
        <button onClick={() => { setShowImport((v) => !v); setShowAddForm(false); setEditingId(null); }}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          {showImport ? 'Cancel' : 'Import CSV/Excel'}
        </button>
      </div>

      {showAddForm && (
        <PortfolioCompanyForm
          status={status}
          // Prompt AL758 §B — the list reloads and the investor lands on
          // page 1 (newest first), where the new row is, so it is visible
          // without F5 and never on a page that no longer exists. A search
          // or sort that could hide the new row is cleared (Prompt AL759).
          onSaved={() => { setShowAddForm(false); load(); goTo(viewAfter(here, { type: 'added' }), listAfter(list, 'added')); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}
      {showImport && (
        <ImportFlow
          existing={companies ?? []}
          activeStatus={status}
          // Prompt AL757 §C — "o painel não fecha em silêncio": importing
          // used to call setShowImport(false) here, which hid ImportFlow —
          // and the result banner inside it — before the investor could
          // ever read it. The import section now stays open; the investor
          // closes it themselves (the same Cancel/toggle button that opened
          // it) once they're done reading the result.
          // Prompt AL758 — rows landed in `landedIn`: reload and show them.
          onImported={(landedIn) => { load(); if (landedIn) goTo(viewAfter(here, { type: 'imported', landedIn }), listAfter(list, 'imported')); }}
        />
      )}
      {editingCompany && (
        <PortfolioCompanyForm
          status={editingCompany.status}
          initial={editingCompany}
          onSaved={() => { setEditingId(null); load(); goTo(viewAfter(here, { type: 'edited' }), listAfter(list, 'edited')); }}
          onCancel={() => setEditingId(null)}
        />
      )}

      {moveResult && (
        <div role="status" data-testid="move-result"
          className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs ${moveResult.failed ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
          <span>{moveResult.text}</span>
          {moveResult.to !== status && (
            <button onClick={() => { setMoveResult(null); goTo({ tab: moveResult.to, page: 1 }, listAfter(list, 'switch-tab')); }}
              className="font-medium underline">
              Open {moveResult.to === 'past' ? 'Past' : 'Current'}
            </button>
          )}
          <button onClick={() => setMoveResult(null)} className="ml-auto text-gray-500 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Prompt AL759 — ONE slot above the table: the search box, or — only
          while rows are selected — the action bar in its place. No permanent
          button takes space when nothing is selected. */}
      {effectiveSelected.size > 0 ? (
        <div className="space-y-1.5" data-testid="selection-bar">
          <div role="region" aria-label="Selection actions"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[#0E7490]/30 bg-[#0E7490]/5 px-3 py-1.5 text-xs">
            <span className="font-medium text-gray-700">{effectiveSelected.size} selected</span>
            <button onClick={requestMove} disabled={moving || confirmMove !== null}
              className="rounded-lg bg-[#0E7490] px-2.5 py-1 font-medium text-white disabled:opacity-40">
              {moving ? 'Moving…' : moveButtonLabel(status, effectiveSelected.size)}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-gray-500 hover:underline">Clear</button>
          </div>
          {prompt?.kind === 'select-all' && (
            <p className="text-[11px] text-gray-500">
              {prompt.onPage} selected on this page ·{' '}
              <button onClick={() => setSelected(new Set(arrangedIds))} className="font-medium text-[#0E7490] hover:underline">
                Select all {prompt.total} matching
              </button>
            </p>
          )}
          {prompt?.kind === 'all-selected' && (
            <p className="text-[11px] text-gray-500">
              All {prompt.total} selected ·{' '}
              <button onClick={() => setSelected(new Set())} className="font-medium text-[#0E7490] hover:underline">Clear</button>
            </p>
          )}
          {confirmMove && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {confirmMove}
              <span className="ml-2 inline-flex gap-2">
                <button onClick={() => void doMove()} className="font-semibold text-amber-900 hover:underline">Move</button>
                <button onClick={() => setConfirmMove(null)} className="text-amber-700 hover:underline">Cancel</button>
              </span>
            </div>
          )}
        </div>
      ) : (
        <PortfolioSearch
          rows={tabRows}
          query={list.query}
          onSubmitText={(q) => changeList({ query: { ...listRef.current.query, q }, sort: listRef.current.sort })}
          onChooseFilter={(filter: TaggedFilter) => changeList({ query: { ...listRef.current.query, filter }, sort: listRef.current.sort })}
          onClearFilter={() => changeList({ query: { ...listRef.current.query, filter: null }, sort: listRef.current.sort })}
        />
      )}

      <PortfolioTable
        tab={status}
        companies={arranged}
        page={page}
        totalInTab={hasQuery(list.query) ? tabRows.length : undefined}
        loading={companies === null}
        confirmRemoveId={confirmRemoveId}
        removeBusy={removeBusy}
        selection={{
          selectedIds: effectiveSelected,
          pageSelection: pageSelection(effectiveSelected, pageIds),
          onTogglePage: () => setSelected(togglePageSelection(effectiveSelected, pageIds)),
          onToggleOne: (id) => setSelected(toggleOne(effectiveSelected, id)),
        }}
        sort={list.sort}
        onSort={(key: PortfolioSortKey) => changeList({ query: listRef.current.query, sort: nextSort(listRef.current.sort, key) })}
        highlight={list.query.q}
        noMatch={noMatch}
        onPageChange={(p) => go({ tab: status, page: p }, list)}
        onEdit={(id) => { setEditingId(id); setShowAddForm(false); setShowImport(false); }}
        onAskRemove={setConfirmRemoveId}
        onConfirmRemove={(id) => void remove(id)}
        onCancelRemove={() => setConfirmRemoveId(null)}
      />
    </div>
  );
}

function PortfolioCompanyForm({ status: initialStatus, initial, onSaved, onCancel }: {
  status: PortfolioStatus;
  initial?: PortfolioCompany;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [formStatus, setFormStatus] = useState<PortfolioStatus>(initial?.status ?? initialStatus);
  const [companyName, setCompanyName] = useState(initial?.company_name ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [stageAtEntry, setStageAtEntry] = useState(initial?.stage_at_entry ?? '');
  const [sectorValue, setSectorValue] = useState<SectorValue>({ sectors: initial?.sectors ?? [], other: null });
  const [ticketEur, setTicketEur] = useState(initial?.ticket_eur != null ? String(initial.ticket_eur) : '');
  const [instrument, setInstrument] = useState(initial?.instrument ?? '');
  const [investedAt, setInvestedAt] = useState(initial?.invested_at?.slice(0, 10) ?? '');
  const [exitAt, setExitAt] = useState(initial?.exit_at?.slice(0, 10) ?? '');
  const [exitType, setExitType] = useState(initial?.exit_type ?? '');
  const [contactName, setContactName] = useState(initial?.contact_name ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contact_phone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Prompt 753 §F — "ao passar para Current, exit_at e exit_type são
  // limpos, com aviso antes de gravar". Only relevant when editing an
  // EXISTING past company that actually had exit data — a fresh "Add
  // manually" row never hits this (nothing to lose yet).
  const [confirmClearExit, setConfirmClearExit] = useState(false);

  function buildPayload() {
    return {
      status: formStatus, companyName: companyName.trim(), website: website.trim() || undefined,
      country: country.trim() || undefined, stageAtEntry: stageAtEntry || undefined,
      sectors: sectorValue.sectors, ticketEur: ticketEur.trim() || undefined,
      instrument: instrument || undefined, investedAt: investedAt || undefined,
      exitAt: formStatus === 'past' ? (exitAt || undefined) : undefined,
      exitType: formStatus === 'past' ? (exitType || undefined) : undefined,
      contactName: contactName.trim() || undefined, contactEmail: contactEmail.trim() || undefined,
      contactPhone: contactPhone.trim() || undefined,
    };
  }

  async function doSave() {
    if (!companyName.trim()) { setErr('Company name is required.'); return; }
    setBusy(true); setErr('');
    try {
      const url = initial
        ? `/api/portal/investor-profile/portfolio?id=${encodeURIComponent(initial.id)}`
        : '/api/portal/investor-profile/portfolio';
      const res = await fetch(url, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setErr(body.error ?? 'Could not save.'); return; }
      onSaved();
    } catch {
      setErr('Network error — please try again.');
    } finally { setBusy(false); }
  }

  function submit() {
    // Editing a Past company down to Current while it still has exit_at/
    // exit_type on file would silently drop them — ask once, explicitly,
    // before that happens. A fresh row, or one that was never Past, has
    // nothing to lose and skips straight to saving.
    const wasPastWithExitData = initial?.status === 'past' && (initial.exit_at || initial.exit_type);
    if (formStatus === 'current' && wasPastWithExitData && !confirmClearExit) {
      setConfirmClearExit(true);
      return;
    }
    void doSave();
  }

  return (
    <Card title={initial ? `Edit ${initial.company_name}` : `Add a ${initialStatus === 'past' ? 'past' : 'current'} portfolio company`}>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Prompt 553 — autoComplete="off" throughout this form: every field
            here is data ABOUT A PORTFOLIO COMPANY, never the signed-in
            investor's own personal/contact data, so none of it qualifies
            for the "genuinely the user's own" exception that rule carves
            out. Same reasoning SectorPicker.tsx's own header gives for its
            search box. */}
        {initial && (
          <select value={formStatus} onChange={(e) => { setFormStatus(e.target.value as PortfolioStatus); setConfirmClearExit(false); }}
            className="col-span-2 rounded-lg border border-gray-300 px-2.5 py-1.5">
            <option value="current">Current</option>
            <option value="past">Past</option>
          </select>
        )}
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
        {/* Prompt AL758 §D — same order as the table's columns: Ticket,
            Instrument (investment type), Invested on, then (Past) Exit
            date and Exit type, then Contact. Both tabs have Instrument
            and Invested on. */}
        <input type="text" inputMode="decimal" value={ticketEur} onChange={(e) => setTicketEur(e.target.value)}
          placeholder="Ticket, e.g. 350k or €1.2M" autoComplete="off" name="portfolio-ticket-eur"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
        <select value={instrument} onChange={(e) => setInstrument(e.target.value)} className="rounded-lg border border-gray-300 px-2.5 py-1.5">
          <option value="">Instrument (investment type)</option>
          {Object.entries(INSTRUMENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
          Invested on
          <input type="date" value={investedAt} onChange={(e) => setInvestedAt(e.target.value)} autoComplete="off"
            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5" />
        </label>
        {formStatus === 'past' && (
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
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="Contact phone"
          autoComplete="off" name="portfolio-contact-phone" data-1p-ignore data-lpignore="true"
          className="rounded-lg border border-gray-300 px-2.5 py-1.5" />
      </div>
      <div className="mt-2">
        <SectorPicker value={sectorValue} onChange={setSectorValue} allowOther={false} />
      </div>
      {err && <p className="mt-1.5 text-[11px] text-[#B00000]">{err}</p>}
      {confirmClearExit && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
          Switching to Current will clear the exit date/type on file for this company.
          <div className="mt-1.5 flex gap-2">
            <button onClick={() => void doSave()} disabled={busy} className="font-semibold text-amber-900 hover:underline disabled:opacity-40">
              {busy ? 'Saving…' : 'Yes, clear and save'}
            </button>
            <button onClick={() => setConfirmClearExit(false)} className="text-amber-700 hover:underline">Cancel</button>
          </div>
        </div>
      )}
      {!confirmClearExit && (
        <div className="mt-3 flex gap-2">
          <button onClick={submit} disabled={busy}
            className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
            {busy ? 'Saving…' : initial ? 'Save changes' : 'Add company'}
          </button>
          {initial && (
            <button onClick={onCancel} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ImportResult { created: number; skipped: { row: number; reason: string }[] }

function ImportFlow({ existing, activeStatus, onImported }: {
  existing: PortfolioCompany[];
  activeStatus: PortfolioStatus;
  onImported: (targetStatus?: PortfolioStatus) => void;
}) {
  const [fileRows, setFileRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [headerRow, setHeaderRow] = useState<string[]>([]);
  // The line number of the header in the ORIGINAL file — what "Download rows
  // with errors" needs to copy the header back out.
  const [headerRowNumber, setHeaderRowNumber] = useState(1);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [guessedFields, setGuessedFields] = useState<Set<PortfolioImportField>>(new Set());
  // Prompt AL759 §A — the mapping is collapsed to one summary line when there
  // is nothing to decide (company name found, nothing guessed); it opens by
  // itself when something failed or was guessed, or on "Review mapping".
  const [mappingOpen, setMappingOpen] = useState(false);
  // Prompt AL757 §D — "o separador ativo" is the starting default, but the
  // investor can override it for THIS import (e.g. importing a Past file
  // while sitting on the Current tab). Tracked separately from
  // `defaultStatus` itself: the Tabs control above this panel stays
  // visible and clickable while Import is open (confirmed live — nothing
  // hides it), so `activeStatus` can change out from under an already-
  // mounted ImportFlow. Follow it live — UNLESS the investor already made
  // their own choice in the selector below, which must never be silently
  // overwritten by an unrelated tab click.
  const [defaultStatus, setDefaultStatus] = useState<PortfolioStatus>(activeStatus);
  const [defaultStatusTouched, setDefaultStatusTouched] = useState(false);
  const [plan, setPlan] = useState<PortfolioImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [editingRow, setEditingRow] = useState<number | null>(null);

  function saveBlob(text: string, filename: string) {
    const blob = new Blob([text], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Prompt AL758 §C — the template is the active tab's own (Current has no
  // exit columns; Past adds exit_at and exit_type), not one file for both.
  function downloadTemplate() {
    saveBlob(portfolioImportTemplateCsv(activeStatus), portfolioTemplateFilename(activeStatus));
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
  //
  // Prompt AL759 §A — the plan is built from the EFFECTIVE mapping: importing
  // into Current with no status column leaves the file's exit columns out
  // (and the screen says so) rather than turning every row into an error.
  function computePlan(rows: string[][], m: ColumnMapping, defStatus: PortfolioStatus) {
    const existingForDedupe = existing.map((c) => ({ companyName: c.company_name, domain: c.domain }));
    const effective = effectiveMappingForDestination(m, defStatus).mapping;
    setPlan(buildPortfolioImportPlan(rows, existingForDedupe, effective, { defaultStatus: defStatus }));
  }

  async function onFile(file: File) {
    setErr(''); setResult(null); setPlan(null); setFileRows(null); setEditingRow(null);
    setFileName(file.name);
    try {
      let rows: string[][];
      if (/\.xlsx?$/i.test(file.name)) {
        rows = parsePortfolioXlsxRows(await file.arrayBuffer());
      } else {
        rows = parsePortfolioCsvRows(await file.text());
      }
      if (rows.length === 0) { setErr('The file looked empty.'); return; }
      // Prompt AL757 §A — blank rows/columns (a title row above the real
      // table, a spacer column to its left) stripped BEFORE the header is
      // even looked for; the header itself is found among the first 10
      // non-blank rows, not assumed to be row 0.
      const { rows: stripped, originalRowNumbers } = stripEmptyRowsAndColumns(rows);
      if (stripped.length === 0) { setErr('The file looked empty.'); return; }
      const detection = detectHeaderAndMapping(stripped);
      setFileRows(rows);
      setHeaderRow(stripped[detection.headerRowIndex] ?? []);
      setHeaderRowNumber(originalRowNumbers[detection.headerRowIndex] ?? 1);
      setMapping(detection.mapping);
      setGuessedFields(new Set(detection.guessedFields));
      setMappingOpen(!shouldCollapseMapping(detection.mapping, detection.guessedFields));
      computePlan(rows, detection.mapping, defaultStatus);
    } catch (e) {
      setErr((e as Error).message || 'Could not read that file.');
    }
  }

  function changeMapping(field: PortfolioImportField, idx: number | null) {
    if (!fileRows) return;
    const next = { ...mapping };
    if (idx === null) delete next[field]; else next[field] = idx;
    setMapping(next);
    // A manual pick is a conscious choice, not a guess anymore — even if it
    // happens to land back on the same column detection already guessed.
    setGuessedFields((prev) => { if (!prev.has(field)) return prev; const s = new Set(prev); s.delete(field); return s; });
    computePlan(fileRows, next, defaultStatus);
  }

  function changeDefaultStatus(s: PortfolioStatus) {
    setDefaultStatus(s);
    setDefaultStatusTouched(true);
    if (fileRows) computePlan(fileRows, mapping, s);
  }

  useEffect(() => {
    if (defaultStatusTouched) return;
    setDefaultStatus(activeStatus);
    if (fileRows) computePlan(fileRows, mapping, activeStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  const effective = effectiveMappingForDestination(mapping, defaultStatus);
  const summary = mappingSummary(headerRow, effective.mapping);
  const visibleFields = visibleMappingFields(mapping, defaultStatus);
  const exitNotice = droppedExitNotice(effective.droppedExitFields);

  function toggleInclude(row: number) {
    if (!plan) return;
    setPlan({ ...plan, items: plan.items.map((it) => (it.row === row ? { ...it, include: !it.include } : it)) });
  }

  // Prompt 753 §E — "revalidam-se ao editar": re-runs the SAME per-field
  // parser the initial file parse used (parsePortfolioFields), on the
  // edited raw text for just this one row, and replaces that row's
  // data/errors/warnings/raw in place. Duplicate status is recomputed too
  // (an edited company name/domain can newly collide, or newly stop
  // colliding, with another row).
  function saveRowEdit(rowNum: number, editedRaw: Partial<Record<PortfolioImportField, string>>) {
    if (!plan) return;
    // Mirrors parsePortfolioRows's own synthesis (Prompt AL757 §D) — a row
    // fixed up by hand must keep falling back to the SAME default status a
    // missing status column gives every other row, not silently revert to
    // parsePortfolioStatus's own hardcoded 'current'.
    const fieldsForParse = mapping.status == null ? { ...editedRaw, status: defaultStatus } : editedRaw;
    const { data, errors, warnings } = parsePortfolioFields(fieldsForParse);
    const existingForDedupe = existing.map((c) => ({ companyName: c.company_name, domain: c.domain }));
    const otherRows = plan.items
      .filter((it): it is PortfolioImportPlanItem & { data: NonNullable<PortfolioImportPlanItem['data']> } => it.row !== rowNum && it.data !== null)
      .map((it) => ({ companyName: it.data.companyName, domain: it.data.domain }));
    let duplicate: PortfolioImportPlanItem['duplicate'] = null;
    if (data) {
      // Re-run the same batch dedupe the initial plan used, scoped to just
      // this row against everyone else (existing DB rows + every other row
      // still in this file) — a one-row "batch" is all detectDuplicates needs.
      const dup = detectDuplicates([{ row: 1, companyName: data.companyName, domain: data.domain }], [...existingForDedupe, ...otherRows]);
      duplicate = dup.get(1) ?? null;
    }
    setPlan({
      ...plan,
      // Prompt AL757 §E — a warning no longer excludes a row from `include`
      // by default (see buildPortfolioImportPlan's own comment); only an
      // error or a duplicate still does.
      items: plan.items.map((it) => (it.row === rowNum
        ? { ...it, data, errors, warnings, raw: editedRaw, duplicate, include: data !== null && errors.length === 0 && duplicate === null }
        : it)),
    });
    setEditingRow(null);
  }

  function importAnyway(rowNum: number) {
    if (!plan) return;
    setPlan({ ...plan, items: plan.items.map((it) => (it.row === rowNum ? { ...it, include: true } : it)) });
  }

  // Prompt AL757 §F — "um clique para aceitar" a sector suggestion:
  // rewrites just the sectors cell's raw text, swapping the unmatched
  // token for the suggested canonical name, then re-validates through the
  // exact same path a manual row edit would (saveRowEdit) — never a
  // separate "just trust the suggestion" shortcut.
  function acceptSectorSuggestion(rowNum: number, token: string, canonical: string) {
    const it = plan?.items.find((i) => i.row === rowNum);
    if (!it) return;
    const currentRaw = it.raw.sectors ?? '';
    const re = new RegExp(`(^|[|;,/])(\\s*)${escapeRegExp(token)}(\\s*)(?=[|;,/]|$)`, 'i');
    const updated = currentRaw.replace(re, (_m, sep: string, before: string, after: string) => `${sep}${before}${canonical}${after}`);
    saveRowEdit(rowNum, { ...it.raw, sectors: updated });
  }

  function downloadErrors() {
    if (!plan || !fileRows) return;
    saveBlob(errorRowsCsv({ fileRows, headerRowNumber, items: plan.items }), 'portfolio-rows-with-errors.csv');
  }

  async function commit() {
    if (!plan) return;
    setBusy(true); setErr('');
    try {
      const targetStatus = pickImportTargetStatus(plan.items);

      const res = await fetch('/api/portal/investor-profile/portfolio/import/commit', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: plan.items }),
      });
      const body = await res.json().catch(() => ({}));
      if (!body.ok) { setErr(body.error ?? 'Import failed.'); return; }
      setResult(body);
      // Prompt AL757 §D/§C — "o separador muda para onde as linhas
      // ficaram" — only when something actually landed somewhere; a 0
      // import has no "where" to switch to.
      onImported(body.created > 0 ? targetStatus : undefined);
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
          {activeStatus === 'past' ? 'Download Past template' : 'Download Current template'}
        </button>
        <input type="file" accept=".csv,.xlsx,.xls"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
          className="text-xs" />
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        {acceptedValuesHelp(activeStatus).map((h, i) => (
          <span key={h.label}>{i > 0 && ' · '}Accepted {h.label.toLowerCase()} values: {h.values}</span>
        ))}
      </p>
      {fileName && <p className="mt-1 text-[11px] text-gray-400">{fileName}</p>}
      {err && <p className="mt-1.5 text-[11px] text-[#B00000]">{err}</p>}

      {fileRows && (
        <div className="mt-3" data-testid="mapping-section">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold text-gray-700">Column mapping</h4>
            {!mappingOpen && (
              <>
                <span className="text-[11px] text-gray-500" data-testid="mapping-summary">{summary.text}</span>
                <button onClick={() => setMappingOpen(true)} className="text-[11px] text-[#0E7490] hover:underline">Review mapping</button>
              </>
            )}
            {mappingOpen && (
              <button onClick={() => setMappingOpen(false)} className="text-[11px] text-[#0E7490] hover:underline">Hide mapping</button>
            )}
          </div>
          {mappingOpen && (
            <>
              <p className="text-[11px] text-gray-400">Detected automatically — fix anything that looks wrong before importing.</p>
              <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {visibleFields.map((field) => (
                  <label key={field} className="text-[11px] text-gray-500">
                    {field}
                    {guessedFields.has(field) && <span className="ml-1 text-amber-600">(guessed from the values)</span>}
                    <select value={mapping[field] ?? ''}
                      onChange={(e) => changeMapping(field, e.target.value === '' ? null : Number(e.target.value))}
                      className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                      <option value="">— none —</option>
                      {headerRow.map((h, i) => <option key={i} value={i}>{h || `column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {summary.notImported.length > 0 && (
                <p className="mt-1.5 text-[11px] text-gray-500">
                  Not imported: {summary.notImported.join(', ')} (no matching field — pick one above if one of these should be mapped).
                </p>
              )}
            </>
          )}
          {/* Nothing is ignored in silence: exit columns found in a file that
              is going into Current are named here, in or out of the mapping. */}
          {exitNotice && <p className="mt-1.5 text-[11px] text-amber-700" data-testid="exit-notice">{exitNotice}</p>}
          {mapping.status == null && (
            <label className="mt-2 block text-[11px] text-gray-500">
              This file has no status column. Rows without a status go to:{' '}
              <select value={defaultStatus} onChange={(e) => changeDefaultStatus(e.target.value as PortfolioStatus)}
                className="rounded border border-gray-300 px-1.5 py-1 text-[11px]">
                <option value="current">Current</option>
                <option value="past">Past</option>
              </select>
            </label>
          )}
        </div>
      )}

      {plan && (
        <ImportPreview
          items={plan.items}
          destination={pickImportTargetStatus(plan.items)}
          editingRow={editingRow}
          busy={busy}
          onImport={commit}
          onToggleInclude={toggleInclude}
          onImportAnyway={importAnyway}
          onEditRow={setEditingRow}
          onSaveRowEdit={saveRowEdit}
          onAcceptSuggestion={acceptSectorSuggestion}
          onBulk={(cls, include) => setPlan({ ...plan, items: setIncludeForClass(plan.items, cls, include) })}
          onDownloadErrors={downloadErrors}
        />
      )}

      {result && <ImportResultBanner result={result} onDismiss={() => setResult(null)} />}
    </Card>
  );
}

// Prompt AL757 §C — "o painel não fecha em silêncio... mostra uma faixa
// persistente (fica até o utilizador a dispensar, ou 10s, o que for mais
// tempo)". Read literally: the investor can always dismiss it manually (no
// upper bound), but it never disappears BEFORE 10 seconds — so the dismiss
// control itself only appears once those 10 seconds have passed, rather
// than racing a timer against a click that might land a moment too early.
function ImportResultBanner({ result, onDismiss }: { result: ImportResult; onDismiss: () => void }) {
  const [canDismiss, setCanDismiss] = useState(false);
  useEffect(() => {
    setCanDismiss(false);
    const t = setTimeout(() => setCanDismiss(true), 10_000);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs">
      {result.created > 0 ? (
        <p className="text-green-700">
          Imported {result.created} compan{result.created === 1 ? 'y' : 'ies'}.
          {result.skipped.length > 0 && ` Skipped ${result.skipped.length} row${result.skipped.length === 1 ? '' : 's'}.`}
        </p>
      ) : (
        <p className="text-amber-700">Nothing was imported.</p>
      )}
      {result.skipped.length > 0 && (
        <ul className="ml-4 mt-1 list-disc text-[11px] text-gray-600">
          {result.skipped.map((s) => <li key={s.row}>Row {s.row}: {s.reason}</li>)}
        </ul>
      )}
      {canDismiss && (
        <button onClick={onDismiss} className="mt-1.5 text-[11px] font-medium text-gray-500 hover:underline">
          Dismiss
        </button>
      )}
    </div>
  );
}
