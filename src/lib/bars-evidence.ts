'use client';
// Prompt 412 §B.2 — the BARS evidence rail's candidate list: investor-
// visible sources ONLY (staged disclosure — CLAUDE.md's own root rule:
// nothing founder-private ever becomes a candidate here). Reduced to one
// flat, deterministically-filterable shape and fetched ONCE per drawer
// session (lazy, on first open), reused across every question in that
// axis — filtering by a question's evidenceHints is a client-side list
// filter, never a new request. No AI/semantic matching this wave (412
// §E): a candidate is offered whenever its `kind` is one of the
// question's evidenceHints, nothing narrower.
//
// Every source reuses an ALREADY-ESTABLISHED investor-visible route
// rather than a new query of its own — this is what guarantees the rail
// can never surface something the investor wouldn't otherwise see:
// /api/portal/access (documents), /api/portal/company-claims (accepted
// claims only), /api/portal/startup/[orgId] (the same level-gated
// dossier the page itself renders — tractionDetailed/roadmap included
// only when that investor's disclosure level already unlocks them),
// /api/portal/interaction-log (this investor's own logged interactions).
import { useEffect, useState } from 'react';
import type { EvidenceKind } from './bars-types';

export interface EvidenceCandidate {
  kind: EvidenceKind;
  id: string;
  text: string;
  tierLabel: string;
}

// 412 §B.2's 4 chip labels: "Document", "Verified fact", "Founder-
// declared", "Your note". A claim's own evidence_class (company_claims
// migration 0176: 1=paid commitment..5=decoration) picks Verified fact
// vs Founder-declared for THAT claim; every other kind gets a fixed label
// — there's no independent verification layer for traction/roadmap
// numbers or documents beyond "the founder attached it" / "it's a filed
// document", and interaction/investor_note are always the investor's own.
function claimTierLabel(evidenceClass: number | null | undefined): string {
  return evidenceClass != null && evidenceClass <= 2 ? 'Verified fact' : 'Founder-declared';
}

interface PortalDoc { id: string; name: string }
interface DocSection { key: string; label: string; documents: PortalDoc[] }
interface CompanyClaimRow { id: string; statement: string; evidence_class: number | null }
interface RoadmapEventRow { id: string; title: string }
interface TimelineEntryRow { id: string; content: string | null; channel: string; kind: string }

async function safeJson<T>(promise: Promise<Response>, fallback: T): Promise<T> {
  try {
    const res = await promise;
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function useEvidenceCandidates(orgId: string, enabled: boolean): { candidates: EvidenceCandidate[]; loading: boolean } {
  const [candidates, setCandidates] = useState<EvidenceCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !orgId) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      safeJson<{ sections: DocSection[] }>(fetch(`/api/portal/access?orgId=${encodeURIComponent(orgId)}`), { sections: [] }),
      safeJson<{ claims: CompanyClaimRow[] }>(fetch(`/api/portal/company-claims?orgId=${encodeURIComponent(orgId)}`), { claims: [] }),
      safeJson<{ dossier?: { tractionDetailed?: Record<string, unknown>; roadmap?: RoadmapEventRow[] } }>(
        fetch(`/api/portal/startup/${encodeURIComponent(orgId)}`), {},
      ),
      safeJson<{ entries: TimelineEntryRow[] }>(fetch(`/api/portal/interaction-log?orgId=${encodeURIComponent(orgId)}`), { entries: [] }),
    ]).then(([access, claimsRes, startup, interactionLog]) => {
      if (cancelled) return;
      const out: EvidenceCandidate[] = [];

      for (const section of access.sections) {
        for (const doc of section.documents) out.push({ kind: 'document', id: doc.id, text: doc.name, tierLabel: 'Document' });
      }
      for (const c of claimsRes.claims) {
        out.push({ kind: 'claim', id: c.id, text: c.statement, tierLabel: claimTierLabel(c.evidence_class) });
      }
      const traction = startup.dossier?.tractionDetailed ?? {};
      for (const [label, value] of Object.entries(traction)) {
        out.push({ kind: 'traction_metric', id: `traction:${label}`, text: `${label}: ${String(value)}`, tierLabel: 'Founder-declared' });
      }
      for (const ev of startup.dossier?.roadmap ?? []) {
        out.push({ kind: 'roadmap_event', id: ev.id, text: ev.title, tierLabel: 'Founder-declared' });
      }
      for (const entry of interactionLog.entries) {
        const text = entry.content?.trim() || `${entry.kind} — ${entry.channel}`;
        out.push({ kind: 'interaction', id: entry.id, text: text.length > 100 ? `${text.slice(0, 100)}…` : text, tierLabel: 'Your note' });
      }

      setCandidates(out);
    }).finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [orgId, enabled]);

  return { candidates, loading };
}

export function candidatesForHints(candidates: EvidenceCandidate[], hints: EvidenceKind[]): EvidenceCandidate[] {
  return candidates.filter((c) => hints.includes(c.kind));
}
