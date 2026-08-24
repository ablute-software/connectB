'use client';
// Prompt 348 §A/§B/§E — the investor's own "Watching" list: reached as a
// Pipeline filter pill (same pattern ArchivePanel already uses), not a
// separate tab. Two private orderings; delta since last visit; thresholds
// are configured per-startup from here too. Nothing here is ever visible
// to the founder — position, delta magnitude, thresholds are all private.
import { useEffect, useState } from 'react';

interface ChangedField { field: string; label: string; from: unknown; to: unknown }
interface WatchItem {
  watchId: string; orgId: string; orgName: string; oneLiner: string | null;
  matchScore: number; deltaScore: number; changedFields: ChangedField[];
  newClass1Statements: string[]; newClass2Statements: string[]; newRoadmapCount: number;
}

const THRESHOLD_OPTIONS: { kind: string; label: string; needsValue?: boolean }[] = [
  { kind: 'class1_evidence', label: 'New class-1 evidence (paid commitment)' },
  { kind: 'class2_evidence', label: 'New class-2 evidence (pilot / LOI / partnership)' },
  { kind: 'round_opened_or_changed', label: 'A new round opens, or the target changes' },
  { kind: 'roadmap_milestone', label: 'A roadmap milestone changes' },
  { kind: 'match_score_above', label: 'Match score rises above', needsValue: true },
];

function fmtValue(v: unknown): string {
  if (v == null) return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

function ThresholdEditor({ orgId }: { orgId: string }) {
  const [enabled, setEnabled] = useState<Record<string, number | null>>({});
  const [matchValue, setMatchValue] = useState('70');
  const [open, setOpen] = useState(false);

  function load() {
    fetch(`/api/portal/watch/thresholds?orgId=${encodeURIComponent(orgId)}`).then((r) => r.json()).then((d) => {
      const next: Record<string, number | null> = {};
      for (const t of d.thresholds ?? []) next[t.kind] = t.threshold_value ?? null;
      setEnabled(next);
    });
  }
  useEffect(() => { if (open) load(); }, [open, orgId]);

  async function toggle(kind: string, on: boolean) {
    await fetch('/api/portal/watch/thresholds', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId, kind, enabled: on, thresholdValue: kind === 'match_score_above' ? Number(matchValue) || 0 : undefined }),
    });
    load();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-gray-400 hover:underline">Alert me when…</button>;

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 p-2">
      {THRESHOLD_OPTIONS.map((o) => (
        <label key={o.kind} className="flex items-center gap-1.5 py-0.5 text-xs text-gray-600">
          <input type="checkbox" checked={o.kind in enabled} onChange={(e) => toggle(o.kind, e.target.checked)} />
          {o.label}
          {o.needsValue && o.kind in enabled && (
            <input type="number" value={matchValue} onChange={(e) => setMatchValue(e.target.value)} onBlur={() => toggle(o.kind, true)}
              className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs" />
          )}
        </label>
      ))}
      <button onClick={() => setOpen(false)} className="mt-1 text-[11px] text-gray-400 hover:underline">Done</button>
    </div>
  );
}

export function WatchingPanel({ onOpenStartup }: { onOpenStartup: (orgId: string) => void }) {
  const [sort, setSort] = useState<'closest_to_criteria' | 'most_changed'>('closest_to_criteria');
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);

  function load() {
    fetch(`/api/portal/watchlist?sort=${sort}`).then((r) => r.json()).then((d) => setItems(d.items ?? [])).catch(() => setItems([]));
  }
  useEffect(load, [sort]);

  async function markSeen(orgId: string) {
    await fetch('/api/portal/watch', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orgId }) });
    load();
  }

  if (!items) return <p className="text-sm text-gray-400">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">Not watching anyone yet.</p>
        <p className="mt-1 text-xs text-gray-400">Open a startup&apos;s dossier and use &quot;Watch this startup&quot; to start following changes to what you already see.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Prompt 348 §E — private to the investor; the founder never sees
          this ordering or that it exists at all, same precedent as the
          scorecard. */}
      <div className="flex items-center gap-1.5">
        <button onClick={() => setSort('closest_to_criteria')}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${sort === 'closest_to_criteria' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>
          Closest to my criteria
        </button>
        <button onClick={() => setSort('most_changed')}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${sort === 'most_changed' ? 'bg-[#0E7490] text-white' : 'border border-gray-200 text-gray-600'}`}>
          Most changed
        </button>
      </div>

      <div className="space-y-2">
        {items.map((it) => {
          const hasChanges = it.changedFields.length > 0 || it.newClass1Statements.length > 0 || it.newClass2Statements.length > 0 || it.newRoadmapCount > 0;
          const expanded = expandedOrgId === it.orgId;
          return (
            <div key={it.watchId} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => onOpenStartup(it.orgId)} className="text-left text-sm font-semibold text-gray-900 hover:underline">{it.orgName}</button>
                <span className="shrink-0 rounded-full bg-[#E8F4F8] px-2 py-0.5 text-[11px] font-semibold text-[#0E7490]">{it.matchScore}% match</span>
              </div>
              {it.oneLiner && <p className="mt-0.5 text-xs text-gray-500">{it.oneLiner}</p>}
              {hasChanges ? (
                <button onClick={() => setExpandedOrgId(expanded ? null : it.orgId)}
                  className="mt-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  ● changed since your last visit
                </button>
              ) : (
                <p className="mt-1.5 text-[11px] text-gray-400">No changes since your last visit.</p>
              )}
              {expanded && (
                <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50/50 p-2 text-xs text-gray-700">
                  <p className="mb-1 font-semibold text-gray-800">What changed since your last visit</p>
                  <ul className="space-y-0.5">
                    {it.changedFields.map((f) => (
                      <li key={f.field}>{f.label}: {fmtValue(f.from)} → {fmtValue(f.to)}</li>
                    ))}
                    {it.newClass1Statements.map((s, i) => <li key={`c1-${i}`}>New class-1 evidence: {s}</li>)}
                    {it.newClass2Statements.map((s, i) => <li key={`c2-${i}`}>New class-2 evidence: {s}</li>)}
                    {it.newRoadmapCount > 0 && <li>{it.newRoadmapCount} roadmap milestone{it.newRoadmapCount === 1 ? '' : 's'} changed.</li>}
                  </ul>
                  <button onClick={() => markSeen(it.orgId)} className="mt-2 rounded-lg border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-white">
                    Mark as seen
                  </button>
                </div>
              )}
              <div className="mt-2">
                <ThresholdEditor orgId={it.orgId} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
