'use client';
// Prompt 274 — industrializes the existing Prompt 137 enrichment worker
// (supabase/functions/enrichment-worker/index.ts) into a runnable campaign:
// pick up to `cap` pending catalog_entities (highest-value first), enqueue
// + invoke the worker for each (Layer 1: team page -> check size/sectors/
// people; Layer 2: hook research per person the entity turned out to have),
// one at a time, and report what happened. This does NOT reimplement or
// bypass the worker's own provenance discipline (anchor-verified bios,
// code-picked-not-model-picked URLs, no-hook-without-a-read-source) — it
// only triggers the existing pipeline more often than the 15-min cron
// would on its own, purely on manual demand (never a new cron — this repo's
// Hobby plan already caps crons at once/day, and the prompt itself asked
// for manual-only).
//
// Two real corrections to how this was originally briefed (confirmed by
// reading the schema/worker directly before writing this file — see
// src/lib/enrichment-campaign.ts's header for the detail):
// 1. catalog_entities has no fit_score (that's an Entity-only column, the
//    org-private post-delivery pipeline) — there is no single "fit High"
//    ordering shared across every org for a platform-wide catalog row.
//    The candidate order from GET .../status substitutes "already
//    delivered to a real founder" + "verified" instead, which is the
//    closest available proxy to what was actually asked for (prioritize
//    what founders already see with empty columns; don't spend AI budget
//    on unverified/junk rows).
// 2. The catalog worker does not write through `contributions`/confidence-
//    routing at all — that system only applies to the OTHER (org-private
//    entities) enrichment path. The catalog worker has its own, stricter,
//    binary (verified-or-empty) provenance rule; there is nothing to route
//    through contributions here.
//
// Architecture note (why this isn't just N parallel fetches to one
// endpoint, unlike the bulk-approve patterns elsewhere in backoffice/queue):
// a single worker invocation can legitimately run for 1-3+ minutes (Layer
// 2's own web-search step alone has a 120s timeout inside the edge
// function) — well past what a Vercel Hobby-plan serverless function is
// allowed to run for. So the actual worker invocation happens as a DIRECT
// browser call to the Supabase Edge Function, authenticated with the
// current platform admin's own session (the worker's auth already
// explicitly supports this path — only pg_cron's service-role key or an
// is_platform_admin() session may call it) — never routed through a
// Next.js API route, and never with the service-role key, which must
// never reach the browser. The two Next.js routes per step (enqueue /
// collect) that DO exist are fast, single-row DB operations, safely under
// any function-duration limit. Runs sequentially, one job at a time
// (maxJobs:1) — not in parallel — so the queue's own priority/created_at
// claim order stays predictable (the same resource constraint that made
// the worker itself cap invocations to a handful of jobs before this
// campaign existed).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';
import { postJson, invokeUntilTerminal } from '@/lib/enrichment-worker-client';

// Prompt 279 — existingFields is the same-tier completeness tiebreaker
// the status route now sorts by; surfaced here only for a title tooltip,
// not re-sorted client-side (the server already returns candidates in
// final priority order).
// Prompt 281 §1 — fit is now the TOP-level sort key server-side; surfaced
// here purely for the "low fit" badge, never re-sorted client-side (same
// "server already returns final priority order" convention as existingFields).
type SectorFit = 'fit' | 'low_fit' | 'not_applicable';
interface Candidate { id: string; name: string; verified: boolean; deliveredCount: number; existingFields: number; fit: SectorFit }
interface Counts { total: number; pending: number; withCheckSize: number; withPeople: number; withHooks: number; chronicFetchFailures: number }
// Prompt 581 §B — replaces the old fit-badged, unbounded Layer2Candidate
// list (a catalog_people row reset back to hook_status='to_research'
// whose entity is already enriched, so it can never re-enter the
// entity-driven Layer 1 -> peopleNeedingLayer2 flow on its own — see
// layer2-candidates/route.ts's own header for why it's a dedicated,
// paginated route now instead of living inside status/route.ts).
type HookStatus = 'to_research' | 'researched' | 'none_found';
interface Layer2Row { id: string; name: string; entityName: string; demand: number; lowChance: boolean }
interface Layer2Counts { toResearch: number; researched: number; noneFound: number }
// A per-person outcome the operator can actually see, kept independent of
// the paginated list itself — Prompt 581 §A.2 found live that the OLD
// code relied on the row disappearing from a status-filtered list as its
// only signal of "something happened", which reads identically to
// "nothing happened" and hides a real failure (worker never claimed the
// job) behind a fabricated success message.
type L2State = 'queued' | 'researching' | 'researched' | 'none_found' | 'stuck' | 'failed';
interface Layer2Outcome { state: L2State; detail?: string; costEur?: number }
// Prompt 279 — rows the status route excluded from `candidates` because
// they've failed the same fetch-stage reason >=2 campaign runs in a row
// (site 404s/403s/429s — retrying costs a cap slot for a guaranteed
// repeat). Never hidden: listed here so a human can still see them and
// manually retry (POST enqueue-entity-layer1 has no knowledge of this
// exclusion at all — see status/route.ts's own header comment).
interface ChronicFailure { id: string; name: string; streak: number; lastError: string }

type RowState = 'idle' | 'layer1' | 'layer2' | 'done' | 'skipped' | 'failed';
interface RowInfo { name: string; state: RowState; detail?: string; hooksGained: number; fit?: SectorFit }

interface Summary {
  entitiesAttempted: number; entitiesEnriched: number; entitiesSkipped: number; entitiesFailed: number;
  peopleResearched: number; hooksGained: number; costEur: number;
}
const EMPTY_SUMMARY: Summary = { entitiesAttempted: 0, entitiesEnriched: 0, entitiesSkipped: 0, entitiesFailed: 0, peopleResearched: 0, hooksGained: 0, costEur: 0 };

export function EnrichmentCampaignPanel({ onEntityEnriched }: { onEntityEnriched: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [cap, setCap] = useState(25);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Record<string, RowInfo>>({});
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [abortReason, setAbortReason] = useState('');
  const [chronicFailures, setChronicFailures] = useState<ChronicFailure[]>([]);

  // Prompt 581 §B — the hook-research bucket's own paginated state,
  // independent of the cap-loop campaign above it.
  const [l2Status, setL2Status] = useState<HookStatus>('to_research');
  const [l2Page, setL2Page] = useState(1);
  const [l2PageSize, setL2PageSize] = useState<25 | 50 | 100>(25);
  const [l2Counts, setL2Counts] = useState<Layer2Counts>({ toResearch: 0, researched: 0, noneFound: 0 });
  const [l2Total, setL2Total] = useState(0);
  const [l2Rows, setL2Rows] = useState<Layer2Row[]>([]);
  const [l2AvgCost, setL2AvgCost] = useState<number | null>(null);
  const [l2RecommendedBatch, setL2RecommendedBatch] = useState(0);
  const [l2Outcomes, setL2Outcomes] = useState<Record<string, Layer2Outcome>>({});
  const stopRequestedRef = useRef(false);

  function refreshStatus() {
    setLoadErr('');
    fetch('/api/backoffice/catalog/enrichment-campaign/status').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setLoadErr(body.error); return; }
      setCounts(body.counts); setCandidates(body.candidates); setChronicFailures(body.chronicFailures ?? []);
    }).catch((e) => setLoadErr((e as Error).message));
  }
  useEffect(refreshStatus, []);

  function refreshLayer2() {
    const qs = new URLSearchParams({ status: l2Status, page: String(l2Page), pageSize: String(l2PageSize) });
    fetch(`/api/backoffice/catalog/enrichment-campaign/layer2-candidates?${qs}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) return;
      setL2Counts(body.counts); setL2Total(body.total); setL2Rows(body.rows);
      setL2AvgCost(body.avgCostEur); setL2RecommendedBatch(body.recommendedBatchCount);
    });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refreshLayer2, [l2Status, l2Page, l2PageSize]);

  function patchRow(id: string, patch: Partial<RowInfo>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } as RowInfo }));
  }
  function addCost(eur: number) {
    setSummary((prev) => ({ ...prev, costEur: prev.costEur + eur }));
  }

  // One candidate entity, start to finish: enqueue+invoke Layer 1, then
  // for every person it surfaced needing Layer 2, enqueue+invoke that too.
  // Returns {abort: reason} only for the two worker-level stop conditions
  // (disabled, daily cap) — every other outcome (skip/fail/done) is
  // per-entity and the campaign just moves on to the next candidate,
  // matching "uma falha nao trava as outras".
  async function processCandidate(c: Candidate, accessToken: string): Promise<{ abort?: string }> {
    patchRow(c.id, { name: c.name, state: 'layer1', hooksGained: 0, fit: c.fit });
    const enq = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-entity-layer1', { catalogEntityId: c.id });
    if (!enq.ok) { patchRow(c.id, { state: 'failed', detail: enq.error }); setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 })); return {}; }
    if (enq.skip) { patchRow(c.id, { state: 'skipped', detail: enq.reason }); setSummary((p) => ({ ...p, entitiesSkipped: p.entitiesSkipped + 1 })); return {}; }

    const result = await invokeUntilTerminal(accessToken, 1, () =>
      postJson('/api/backoffice/catalog/enrichment-campaign/collect-entity-layer1-result', { catalogEntityId: c.id, jobId: enq.jobId }));
    if (result.kind === 'abort') return { abort: result.message };
    if (result.kind === 'error' || result.kind === 'stuck') {
      patchRow(c.id, { state: 'failed', detail: result.kind === 'stuck' ? 'Queued but never claimed by the worker — try again.' : result.message });
      setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 }));
      return {};
    }
    const collected = result.collected;
    addCost((collected.cost as { eur?: number } | undefined)?.eur ?? 0);

    if (collected.status === 'done') {
      setSummary((p) => ({ ...p, entitiesEnriched: p.entitiesEnriched + 1 }));
      onEntityEnriched();
    } else if (collected.status === 'skipped') {
      setSummary((p) => ({ ...p, entitiesSkipped: p.entitiesSkipped + 1 }));
    } else {
      setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 }));
    }

    const people = (collected.peopleNeedingLayer2 as { id: string; fullName: string }[] | undefined) ?? [];
    let hooksGainedHere = 0;
    for (const person of people) {
      if (stopRequestedRef.current) break;
      patchRow(c.id, { state: 'layer2', detail: `Researching ${person.fullName}…` });
      const enqP = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-person-layer2', { catalogPersonId: person.id });
      if (!enqP.ok || enqP.skip) continue;
      const resultP = await invokeUntilTerminal(accessToken, 2, () =>
        postJson('/api/backoffice/catalog/enrichment-campaign/collect-person-layer2-result', { catalogPersonId: person.id, jobId: enqP.jobId }));
      if (resultP.kind === 'abort') return { abort: resultP.message };
      if (resultP.kind === 'error' || resultP.kind === 'stuck') continue; // one person's failure doesn't abort the entity or the campaign
      const collectedP = resultP.collected;
      addCost((collectedP.cost as { eur?: number } | undefined)?.eur ?? 0);
      setSummary((p) => ({ ...p, peopleResearched: p.peopleResearched + 1 }));
      if (collectedP.hookWritten) { hooksGainedHere++; setSummary((p) => ({ ...p, hooksGained: p.hooksGained + 1 })); }
    }
    patchRow(c.id, { state: 'done', detail: collected.status === 'done' ? undefined : String(collected.reason ?? ''), hooksGained: hooksGainedHere });
    return {};
  }

  async function runCampaign() {
    setLoadErr(''); setAbortReason(''); setSummary(EMPTY_SUMMARY); setRows({});
    stopRequestedRef.current = false;

    const { data: { session } } = await browserClient().auth.getSession();
    if (!session) { setLoadErr('Session expired — sign in again.'); return; }

    const targets = candidates.slice(0, cap);
    setRunning(true);
    for (const c of targets) {
      if (stopRequestedRef.current) break;
      setSummary((p) => ({ ...p, entitiesAttempted: p.entitiesAttempted + 1 }));
      const { abort } = await processCandidate(c, session.access_token);
      if (abort) { setAbortReason(abort); break; }
    }
    setRunning(false);
    refreshStatus();
  }

  // Prompt 279 — a single manual retry for one chronically-excluded
  // candidate. Not routed through `candidates`/the cap loop — this bypasses
  // the exclusion entirely by construction (processCandidate only ever
  // reads c.id/c.name; verified/deliveredCount/existingFields are unused
  // here, dummy values are fine) since enqueue-entity-layer1 itself has no
  // knowledge of the chronic-failure list, same as any other direct call.
  async function retryOne(id: string, name: string) {
    setLoadErr(''); setRunning(true);
    const { data: { session } } = await browserClient().auth.getSession();
    if (!session) { setLoadErr('Session expired — sign in again.'); setRunning(false); return; }
    setSummary((p) => ({ ...p, entitiesAttempted: p.entitiesAttempted + 1 }));
    const { abort } = await processCandidate({ id, name, verified: false, deliveredCount: 0, existingFields: 0, fit: 'not_applicable' }, session.access_token);
    if (abort) setAbortReason(abort);
    setRunning(false);
    refreshStatus();
  }

  function patchOutcome(id: string, patch: Layer2Outcome) {
    setL2Outcomes((prev) => ({ ...prev, [id]: patch }));
  }

  // Prompt 581 §B.3 — a single person's research, rewritten around three
  // real problems found live in the old version (Prompt 281 §3's
  // researchPerson): (1) it treated the row vanishing from a
  // status-filtered list as the only success signal — a genuine success
  // read identically to nothing happening; (2) it couldn't distinguish a
  // real none_found from a job the worker never claimed (both surfaced as
  // "No usable hook found", even though the fixed shared client below now
  // makes that distinction available); (3) it spent ~€0.30 on a search
  // with nothing to search from — 2 of the 3 real none_found jobs in this
  // campaign's history had neither a LinkedIn URL nor a firm website.
  async function researchPerson(row: Layer2Row, force = false) {
    if (row.lowChance && !force) {
      patchOutcome(row.id, { state: 'stuck', detail: 'Low chance of results — no LinkedIn or firm website to search from. Click again to research anyway.' });
      return;
    }
    setLoadErr('');
    patchOutcome(row.id, { state: 'queued' });
    const { data: { session } } = await browserClient().auth.getSession();
    if (!session) { setLoadErr('Session expired — sign in again.'); return; }
    const enq = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-person-layer2', { catalogPersonId: row.id });
    if (!enq.ok || enq.skip) { patchOutcome(row.id, { state: 'failed', detail: enq.reason ?? enq.error ?? 'Could not enqueue.' }); return; }
    patchOutcome(row.id, { state: 'researching' });
    const result = await invokeUntilTerminal(session.access_token, 2, () =>
      postJson('/api/backoffice/catalog/enrichment-campaign/collect-person-layer2-result', { catalogPersonId: row.id, jobId: enq.jobId }));
    if (result.kind === 'abort') { setAbortReason(result.message); patchOutcome(row.id, { state: 'failed', detail: result.message }); return; }
    if (result.kind === 'error') { patchOutcome(row.id, { state: 'failed', detail: result.message }); return; }
    if (result.kind === 'stuck') { patchOutcome(row.id, { state: 'stuck', detail: 'Queued but the worker never claimed it — try again.' }); return; }
    const collected = result.collected;
    const cost = (collected.cost as { eur?: number } | undefined)?.eur ?? 0;
    patchOutcome(row.id, {
      state: collected.hookWritten ? 'researched' : 'none_found',
      detail: collected.hookWritten ? 'Hook found.' : 'No usable hook found — background may still have been recorded.',
      costEur: cost,
    });
    // Deliberately NOT an immediate refreshLayer2(): the row staying put
    // with its outcome visible is the whole fix for §A.2's "silent
    // vanish" bug. It leaves the to_research list on the NEXT page
    // load/tab revisit, once its own outcome has actually been seen.
  }

  if (!authEnabled) {
    return (
      <Card title="Enrichment campaign">
        <p className="text-xs text-gray-400">Real AI spend against real production data — requires a live Supabase connection, not available in demo mode.</p>
      </Card>
    );
  }

  return (
    <Card title="Enrichment campaign">
      {loadErr && <p className="mb-2 text-sm text-[#B00000]">{loadErr}</p>}
      {counts && (
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500">
          <span><span className="font-semibold text-gray-800">{counts.total}</span> catalog entities</span>
          <span><span className="font-semibold text-amber-700">{counts.pending}</span> pending enrichment</span>
          <span><span className="font-semibold text-gray-800">{counts.withCheckSize}</span> with check size</span>
          <span><span className="font-semibold text-gray-800">{counts.withPeople}</span> with people</span>
          <span><span className="font-semibold text-gray-800">{counts.withHooks}</span> with researched hooks</span>
          {counts.chronicFetchFailures > 0 && (
            <span title="Failed the same fetch-stage reason 2+ campaign runs in a row — excluded from auto-selection, listed below, still manually retryable.">
              <span className="font-semibold text-gray-500">{counts.chronicFetchFailures}</span> chronically unreachable (excluded below)
            </span>
          )}
        </div>
      )}
      <p className="mb-2 text-[11px] text-gray-400">
        Priority: already delivered to a founder&apos;s org first, then verified over pending, then — within the same tier — whichever row already has more fields filled in (cheaper to finish, visible result sooner). Catalog rows have no stored &quot;fit&quot; (that only exists per-org, after delivery), so this is the closest available substitute.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-600">Cap per run
          <input type="number" min={1} max={100} value={cap} disabled={running}
            onChange={(e) => setCap(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="ml-1.5 w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs" />
        </label>
        <button disabled={running || candidates.length === 0} onClick={runCampaign}
          className="rounded-lg bg-[#0f5132] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
          {running ? 'Running…' : `Run campaign (${Math.min(cap, candidates.length)})`}
        </button>
        {running && (
          <button onClick={() => { stopRequestedRef.current = true; }}
            className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
            Stop after current entity
          </button>
        )}
      </div>

      {(running || summary.entitiesAttempted > 0) && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5 text-xs text-gray-700">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span>{summary.entitiesAttempted} attempted</span>
            <span className="text-green-700">{summary.entitiesEnriched} enriched</span>
            <span className="text-gray-500">{summary.entitiesSkipped} skipped</span>
            <span className="text-[#B00000]">{summary.entitiesFailed} failed</span>
            <span>{summary.peopleResearched} people researched</span>
            <span className="font-medium text-[#0E7490]">{summary.hooksGained} hooks gained</span>
            <span className="ml-auto font-semibold">€{summary.costEur.toFixed(4)} spent</span>
          </div>
          {abortReason && <p className="mt-1.5 font-medium text-amber-700">Stopped: {abortReason}</p>}
          {!running && summary.entitiesAttempted > 0 && !abortReason && <p className="mt-1.5 text-gray-500">Run complete.</p>}
        </div>
      )}

      {Object.keys(rows).length > 0 && (
        <ul className="mt-2 max-h-64 divide-y divide-gray-100 overflow-y-auto text-xs">
          {Object.entries(rows).map(([id, r]) => (
            <li key={id} className="flex items-center gap-2 py-1.5">
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                r.state === 'done' ? 'bg-green-100 text-green-800'
                  : r.state === 'skipped' ? 'bg-gray-100 text-gray-600'
                  : r.state === 'failed' ? 'bg-red-100 text-red-700'
                  : 'bg-cyan-100 text-cyan-800'}`}>
                {r.state === 'layer1' ? 'team page…' : r.state === 'layer2' ? 'hooks…' : r.state}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{r.name}</span>
              {/* Prompt 581 §A.1/§B.2 — "fit" is computed against the union
                  of sectors of whichever orgs this row has ever been
                  delivered to, not the viewing admin's own org (there
                  isn't one) — confirmed meaningless as a trust signal in
                  back-office, so the badge is gone; the value itself stays
                  as a server-side sort tiebreaker only (see status/route.ts). */}
              {r.hooksGained > 0 && <span className="shrink-0 text-[#0E7490]">+{r.hooksGained} hook{r.hooksGained > 1 ? 's' : ''}</span>}
              {r.detail && <span className="min-w-0 flex-1 truncate text-gray-400">{r.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Prompt 279 — surfaced, not hidden: excluded from auto-selection
          above, but still one click from a manual retry (enqueue-entity-
          layer1 has no knowledge of this exclusion — see status/route.ts). */}
      {chronicFailures.length > 0 && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            Chronically unreachable — excluded from auto-selection ({chronicFailures.length})
          </p>
          <ul className="space-y-1 text-xs">
            {chronicFailures.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-gray-700">{f.name}</span>
                <span className="shrink-0 text-gray-400">{f.lastError} × {f.streak}</span>
                <button disabled={running} onClick={() => void retryOne(f.id, f.name)}
                  className="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                  Retry now
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prompt 581 §B — people reset back to hook_status='to_research'
          whose entity is already enriched, so the normal Layer-1-driven
          flow can never re-surface them on its own. Real counts across
          all 3 hook_status values (no hidden cap — see
          layer2-candidates/route.ts's own header for the 1000-vs-3136
          bug this replaces), paginated, ordered by demand (§B.4), each
          name linking to its own dossier (§C, §B.5). */}
      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Hook research</p>
        <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
          {([
            ['to_research', `${l2Counts.toResearch} to research`],
            ['researched', `${l2Counts.researched} researched`],
            ['none_found', `${l2Counts.noneFound} none found`],
          ] as [HookStatus, string][]).map(([key, label]) => (
            <button key={key} onClick={() => { setL2Status(key); setL2Page(1); }}
              className={`rounded-full px-2 py-0.5 font-medium ${l2Status === key ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
              {label}
            </button>
          ))}
        </div>
        {l2Status === 'to_research' && (
          <p className="mb-2 text-[11px] text-gray-500">
            {l2RecommendedBatch} of these belong to a firm already in at least one org&apos;s pipeline (a proxy for &quot;worth it today&quot;, not the exact readiness&gt;=55 cut — see Prompt 581&apos;s report).
            {l2AvgCost != null && <> Estimated at the last 30 days&apos; real average, €{l2AvgCost.toFixed(2)}/person: ≈€{(l2AvgCost * l2RecommendedBatch).toFixed(2)}.</>}
            {' '}Batch execution isn&apos;t wired up yet — pending the batch-criterion decision (see report); nothing runs from this line.
          </p>
        )}
        {l2Rows.length === 0 ? (
          <p className="text-xs text-gray-400">Nothing in this bucket.</p>
        ) : (
          <ul className="divide-y divide-gray-100 text-xs">
            {l2Rows.map((p) => {
              const outcome = l2Outcomes[p.id];
              const busy = outcome?.state === 'queued' || outcome?.state === 'researching';
              return (
                <li key={p.id} className="flex items-center gap-2 py-1.5">
                  <Link href={`/backoffice/catalog/people/${p.id}`} className="min-w-0 flex-1 truncate font-medium text-[#0E7490] hover:underline">
                    {p.name}
                  </Link>
                  <span className="shrink-0 truncate text-gray-400" title={`${p.demand} org(s) with this firm in their pipeline`}>{p.entityName} · {p.demand} org{p.demand === 1 ? '' : 's'}</span>
                  {p.lowChance && !outcome && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800" title="No LinkedIn on the person, no website on the firm — little for the model to search from.">
                      ⚠️ low chance
                    </span>
                  )}
                  {outcome && (
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      outcome.state === 'researched' ? 'bg-green-100 text-green-800'
                        : outcome.state === 'none_found' ? 'bg-gray-100 text-gray-600'
                        : outcome.state === 'failed' || outcome.state === 'stuck' ? 'bg-red-100 text-red-700'
                        : 'bg-cyan-100 text-cyan-800'}`}
                      title={outcome.detail}>
                      {outcome.state === 'researched' ? 'hook ✓' : outcome.state.replace('_', ' ')}
                      {outcome.costEur != null && ` · €${outcome.costEur.toFixed(2)}`}
                    </span>
                  )}
                  <button disabled={busy} onClick={() => void researchPerson(p, outcome?.state === 'stuck' && p.lowChance)}
                    className="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                    {busy ? (outcome.state === 'queued' ? 'Queued…' : 'Researching…') : outcome?.state === 'stuck' && p.lowChance ? 'Research anyway' : outcome ? 'Research again' : 'Research now'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <button disabled={l2Page <= 1} onClick={() => setL2Page((p) => p - 1)} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">← Prev</button>
          <span>Page {l2Page} of {Math.max(1, Math.ceil(l2Total / l2PageSize))} ({l2Total} total)</span>
          <button disabled={l2Page >= Math.ceil(l2Total / l2PageSize)} onClick={() => setL2Page((p) => p + 1)} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-30">Next →</button>
          <select value={l2PageSize} onChange={(e) => { setL2PageSize(Number(e.target.value) as 25 | 50 | 100); setL2Page(1); }} className="ml-1 rounded border border-gray-300 px-1.5 py-1">
            {[25, 50, 100].map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>
        </div>
      </div>
    </Card>
  );
}
