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
import { authEnabled, browserClient, SUPABASE_URL } from '@/lib/supabase';
import { Card } from '@/components/ui';

interface Candidate { id: string; name: string; verified: boolean; deliveredCount: number }
interface Counts { total: number; pending: number; withCheckSize: number; withPeople: number; withHooks: number }

type RowState = 'idle' | 'layer1' | 'layer2' | 'done' | 'skipped' | 'failed';
interface RowInfo { name: string; state: RowState; detail?: string; hooksGained: number }

interface Summary {
  entitiesAttempted: number; entitiesEnriched: number; entitiesSkipped: number; entitiesFailed: number;
  peopleResearched: number; hooksGained: number; costEur: number;
}
const EMPTY_SUMMARY: Summary = { entitiesAttempted: 0, entitiesEnriched: 0, entitiesSkipped: 0, entitiesFailed: 0, peopleResearched: 0, hooksGained: 0, costEur: 0 };

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

// Direct browser -> Edge Function call (see the file header for why this
// can't go through a Next.js route). 170s client-side timeout — generous
// above the worker's own internal 120s Layer-2 search timeout plus
// overhead, so a genuinely stuck call still fails visibly instead of
// hanging the campaign forever.
async function invokeWorker(accessToken: string, layer: 1 | 2): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 170_000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/enrichment-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ maxJobs: 1, layer }),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export function EnrichmentCampaignPanel({ onEntityEnriched }: { onEntityEnriched: () => void }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadErr, setLoadErr] = useState('');
  const [cap, setCap] = useState(25);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<Record<string, RowInfo>>({});
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [abortReason, setAbortReason] = useState('');
  const stopRequestedRef = useRef(false);

  function refreshStatus() {
    setLoadErr('');
    fetch('/api/backoffice/catalog/enrichment-campaign/status').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setLoadErr(body.error); return; }
      setCounts(body.counts); setCandidates(body.candidates);
    }).catch((e) => setLoadErr((e as Error).message));
  }
  useEffect(refreshStatus, []);

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
    patchRow(c.id, { name: c.name, state: 'layer1', hooksGained: 0 });
    const enq = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-entity-layer1', { catalogEntityId: c.id });
    if (!enq.ok) { patchRow(c.id, { state: 'failed', detail: enq.error }); setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 })); return {}; }
    if (enq.skip) { patchRow(c.id, { state: 'skipped', detail: enq.reason }); setSummary((p) => ({ ...p, entitiesSkipped: p.entitiesSkipped + 1 })); return {}; }

    let invoked: Record<string, unknown>;
    try {
      invoked = await invokeWorker(accessToken, 1);
    } catch (e) {
      patchRow(c.id, { state: 'failed', detail: `Worker call failed: ${(e as Error).message}` });
      setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 }));
      return {};
    }
    if (invoked.skipped) return { abort: `Enrichment is disabled server-side (${invoked.reason}).` };
    if (invoked.stopped) return { abort: `Daily AI cost cap reached (€${Number(invoked.spentToday ?? 0).toFixed(2)} of €${invoked.cap}) — stopping here for today.` };

    const collected = await postJson('/api/backoffice/catalog/enrichment-campaign/collect-entity-layer1-result', { catalogEntityId: c.id, jobId: enq.jobId });
    if (!collected.ok) { patchRow(c.id, { state: 'failed', detail: collected.error }); setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 })); return {}; }
    addCost(collected.cost?.eur ?? 0);

    if (collected.status === 'done') {
      setSummary((p) => ({ ...p, entitiesEnriched: p.entitiesEnriched + 1 }));
      onEntityEnriched();
    } else if (collected.status === 'skipped') {
      setSummary((p) => ({ ...p, entitiesSkipped: p.entitiesSkipped + 1 }));
    } else {
      setSummary((p) => ({ ...p, entitiesFailed: p.entitiesFailed + 1 }));
    }

    const people: { id: string; fullName: string }[] = collected.peopleNeedingLayer2 ?? [];
    let hooksGainedHere = 0;
    for (const person of people) {
      if (stopRequestedRef.current) break;
      patchRow(c.id, { state: 'layer2', detail: `Researching ${person.fullName}…` });
      const enqP = await postJson('/api/backoffice/catalog/enrichment-campaign/enqueue-person-layer2', { catalogPersonId: person.id });
      if (!enqP.ok || enqP.skip) continue;
      let invokedP: Record<string, unknown>;
      try {
        invokedP = await invokeWorker(accessToken, 2);
      } catch {
        continue; // one person's transient failure doesn't abort the entity or the campaign
      }
      if (invokedP.skipped) return { abort: `Enrichment is disabled server-side (${invokedP.reason}).` };
      if (invokedP.stopped) return { abort: `Daily AI cost cap reached (€${Number(invokedP.spentToday ?? 0).toFixed(2)} of €${invokedP.cap}) — stopping here for today.` };
      const collectedP = await postJson('/api/backoffice/catalog/enrichment-campaign/collect-person-layer2-result', { catalogPersonId: person.id, jobId: enqP.jobId });
      if (collectedP.ok) {
        addCost(collectedP.cost?.eur ?? 0);
        setSummary((p) => ({ ...p, peopleResearched: p.peopleResearched + 1 }));
        if (collectedP.hookWritten) { hooksGainedHere++; setSummary((p) => ({ ...p, hooksGained: p.hooksGained + 1 })); }
      }
    }
    patchRow(c.id, { state: 'done', detail: collected.status === 'done' ? undefined : collected.reason, hooksGained: hooksGainedHere });
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
        </div>
      )}
      <p className="mb-2 text-[11px] text-gray-400">
        Priority: already delivered to a founder&apos;s org first, then verified over pending — catalog rows have no stored &quot;fit&quot; (that only exists per-org, after delivery), so this is the closest available substitute.
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
              {r.hooksGained > 0 && <span className="shrink-0 text-[#0E7490]">+{r.hooksGained} hook{r.hooksGained > 1 ? 's' : ''}</span>}
              {r.detail && <span className="min-w-0 flex-1 truncate text-gray-400">{r.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
