'use client';
// Readiness & Train — Action plan sub-tab (Prompt 115 Block C). Read-only
// aggregation over ai_reviews: every weakness/risk/recommendation from every
// structured document review, clustered by text similarity (Jaccard ≥0.6)
// so the same underlying issue raised by two different documents shows once
// with an "appears in your Deck and your Financial plan" note instead of
// twice. Ordered by recurrence-across-documents first, then severity, then
// recency — the point is "what to fix first", not a raw dump of every AI
// review.
//
// Recurrence is measured per document TYPE (`kind`), not per review row —
// see the note on latestPerKind() in lib/action-plan.ts. ai_reviews has no
// document_id (the review flow takes pasted text, not a picked file), so
// `kind` is the only document identity available until documents are linked
// to reviews; re-analyzing the same deck replaces its prior contribution to
// the ranking instead of counting as a second document.
//
// Contradictions come from Block D's cross_document_review kind (dual
// citation: sideA/sideB, each a {kind, quote}), built in the Review tab's
// "Cross-document check" card. Nothing here mutates CRM data or sends
// anything; every output is a report, same guardrail as the Review tab.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { Card } from '@/components/ui';
import { authEnabled, browserClient } from '@/lib/supabase';
import {
  DOC_KIND_LABEL, SEVERITY_WEIGHT, dataroomChecklist, clusterActions, clusterPriority, extractActions, latestPerKind, joinNatural,
  genuineContradictions, findMatchingSolution, type Severity, type Action, type AiReviewRow, type ActionCluster, type Contradiction,
} from '@/lib/action-plan';
import { uploadAndVerifyFile } from '@/lib/vault-upload-client';
import { weakClaimCoachingNote, CATEGORY_LABEL } from '@/lib/company-claims';
import type { ClaimCategory, ClaimSpecificity } from '@/lib/types';

interface ReviewRunRow { id: string; score: number | null; created_at: string }
interface WeakClaimRow { id: string; category: ClaimCategory; statement: string; note: string }

const TYPE_LABEL: Record<'weakness' | 'risk' | 'recommendation', string> = { weakness: 'Weakness', risk: 'Risk', recommendation: 'Recommendation' };
const SEVERITY_COLOR: Record<Severity, string> = { high: 'text-[#B00000]', medium: 'text-amber-600', low: 'text-gray-500' };

// Prompt 302 §1 — same visual bubble language as SwotVisualCard.tsx, mirrored
// into two columns: the problem raised (red, left) and its suggested fix
// (green, right) side by side, same shape, different tone.
function Bubble({ tone, children }: { tone: 'problem' | 'solution'; children: React.ReactNode }) {
  const style = tone === 'problem' ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50';
  const dot = tone === 'problem' ? 'bg-red-500' : 'bg-emerald-500';
  return (
    <div className={`flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs text-gray-800 ${style}`}>
      <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ClusterRow({ cluster, allActions, docsById, existingVersions, documentVersionsAvailable, addDocumentVersion, orgId, onUploaded }: {
  cluster: ActionCluster;
  allActions: Action[];
  docsById: Map<string, { id: string; name: string; storage_path?: string; version?: string }>;
  existingVersions: { document_id: string; version: number }[];
  documentVersionsAvailable: boolean;
  addDocumentVersion: (docId: string, storagePath: string, size?: number, scan?: { status?: string; provider?: string | null; sha256?: string }) => void;
  orgId: string;
  onUploaded: (msg: string) => void;
}) {
  const lead = cluster.items[0];
  const distinctDocs = Array.from(new Set(cluster.items.map((i) => i.sourceKind)));
  const worstSeverity = cluster.items.reduce<Severity | null>((worst, i) => {
    if (!i.severity) return worst;
    if (!worst || SEVERITY_WEIGHT[i.severity] > SEVERITY_WEIGHT[worst]) return i.severity;
    return worst;
  }, null);
  // Prompt 302 §1 — an on-demand solution, when the same review already
  // made one (matched by text similarity — see findMatchingSolution's own
  // header for why this is approximate, not a real declared link).
  const solution = findMatchingSolution(cluster, allActions);
  // Prompt 302 §2 — only the LEAD item's own document link is shown (a
  // cluster can merge findings from several documents; the lead is the
  // one the priority ranking is actually sorted on).
  const linkedDoc = lead.documentId ? docsById.get(lead.documentId) : undefined;
  const [uploading, setUploading] = useState(false);

  async function uploadCorrectedVersion(file: File) {
    if (!linkedDoc) return;
    setUploading(true);
    try {
      const verified = await uploadAndVerifyFile(orgId, file);
      // Same nextNum computation addDocumentVersion itself uses internally —
      // computed here so the confirmation message names the real version
      // number without waiting on a re-render to read it back.
      const docVersions = existingVersions.filter((v) => v.document_id === linkedDoc.id);
      const priorNum = docVersions.length ? Math.max(...docVersions.map((v) => v.version)) : (linkedDoc.storage_path ? 1 : 0);
      const nextNum = priorNum + 1;
      addDocumentVersion(linkedDoc.id, verified.storagePath, verified.size, { status: verified.malwareScanStatus, provider: verified.provider, sha256: verified.sha256 });
      onUploaded(`New version (v${nextNum}) uploaded to the Vault, replaces v${priorNum} — the previous one stays in history, recoverable.`);
    } catch (e) {
      onUploaded(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Bubble tone="problem">
          <p className="text-gray-800">{lead.text}</p>
          {lead.quote && <p className="mt-1 text-[11px] italic text-gray-500">&ldquo;{lead.quote}&rdquo;</p>}
        </Bubble>
        <Bubble tone="solution">
          {solution ? <p className="text-gray-800">{solution.text}</p> : <p className="text-gray-400">No suggestion yet — the AI hasn&apos;t proposed a matching fix for this one.</p>}
        </Bubble>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {worstSeverity && <span className={`shrink-0 text-xs font-semibold uppercase ${SEVERITY_COLOR[worstSeverity]}`}>{worstSeverity}</span>}
          <p className="text-xs text-gray-400">
            {TYPE_LABEL[lead.type]} · {lead.category}
            {distinctDocs.length > 1 ? ` · appears in ${joinNatural(distinctDocs)}` : ` · from ${distinctDocs[0]}`}
          </p>
        </div>
        {linkedDoc ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">{linkedDoc.name}{lead.documentVersion ? ` (reviewed at ${lead.documentVersion})` : ''}</span>
            {documentVersionsAvailable && authEnabled && (
              <label className={`cursor-pointer rounded-lg border border-gray-200 px-2 py-1 text-gray-600 hover:bg-gray-50 ${uploading ? 'opacity-50' : ''}`}>
                {uploading ? 'Uploading…' : 'Upload corrected version'}
                <input type="file" className="hidden" disabled={uploading}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCorrectedVersion(f); e.target.value = ''; }} />
              </label>
            )}
          </div>
        ) : (
          <span className="text-[11px] text-gray-400" title="This review was made before document linking existed, or wasn't linked to a Vault file.">
            No Vault document linked
          </span>
        )}
      </div>
    </li>
  );
}

function InvestabilityChart({ runs }: { runs: ReviewRunRow[] }) {
  const points = runs.filter((r): r is ReviewRunRow & { score: number } => r.score != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (points.length < 2) {
    return <p className="text-xs text-gray-400">Run at least 2 investability reviews (Review tab) to see a trend here.</p>;
  }
  const W = 560, H = 120, PAD = 24;
  const xStep = (W - 2 * PAD) / (points.length - 1);
  const xs = points.map((_, i) => PAD + i * xStep);
  const ys = points.map((p) => H - PAD - (p.score / 100) * (H - 2 * PAD));
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Investability score over time">
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#E5E7EB" strokeWidth={1} />
      <path d={path} fill="none" stroke="#0E7490" strokeWidth={2} />
      {xs.map((x, i) => (
        <g key={points[i].id}>
          <circle cx={x} cy={ys[i]} r={3} fill="#0E7490" />
          <text x={x} y={H - 6} fontSize={9} textAnchor="middle" fill="#9CA3AF">{points[i].created_at.slice(5, 10)}</text>
        </g>
      ))}
    </svg>
  );
}

export function ActionPlanPanel() {
  const { db, addDocumentVersion } = useStore();
  const [reviews, setReviews] = useState<AiReviewRow[]>([]);
  const [runs, setRuns] = useState<ReviewRunRow[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [weakClaims, setWeakClaims] = useState<WeakClaimRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [documentVersionsAvailable, setDocumentVersionsAvailable] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((me) => setDocumentVersionsAvailable(!!me.capabilities?.documentVersions)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!authEnabled || !db.org.id) { setLoading(false); return; }
    Promise.all([
      // Prompt 302 §2 — document_id/document_version travel alongside the
      // rest of the row; both are null for a review made before this existed.
      browserClient().from('ai_reviews').select('id, kind, result, created_at, document_id, document_version')
        .eq('org_id', db.org.id).eq('status', 'completed')
        .in('kind', Object.keys(DOC_KIND_LABEL))
        .order('created_at', { ascending: false }),
      browserClient().from('review_runs').select('id, score, created_at')
        .eq('org_id', db.org.id).order('created_at', { ascending: false }).limit(30),
      browserClient().from('ai_reviews').select('id, result, created_at')
        .eq('org_id', db.org.id).eq('status', 'completed').eq('kind', 'cross_document_review')
        .order('created_at', { ascending: false }).limit(1),
    ]).then(([reviewsRes, runsRes, contradictionsRes]) => {
      setReviews(latestPerKind((reviewsRes.data as AiReviewRow[] | null) ?? []));
      setRuns((runsRes.data as ReviewRunRow[] | null) ?? []);
      const latestCrossDoc = contradictionsRes.data?.[0] as { result: { contradictions?: Contradiction[] } } | undefined;
      setContradictions(genuineContradictions(latestCrossDoc?.result?.contradictions ?? []));
      setLoading(false);
    });
  }, [db.org.id]);

  // Prompt 307 §B2 — a claim de baixa especificidade vira coaching AQUI (o
  // founder já vem a esta aba por recomendações), nunca no material do
  // investidor. RLS scoped (company_claims_org_members, migração 0176),
  // mesmo padrão de leitura directa que ai_reviews/review_runs acima —
  // um erro (tabela ainda não aplicada nalgum ambiente) degrada para [],
  // nunca rebenta a aba.
  useEffect(() => {
    if (!authEnabled || !db.org.id) return;
    browserClient().from('company_claims').select('id, category, statement, specificity')
      .eq('org_id', db.org.id).eq('status', 'accepted')
      .then(({ data }) => {
        const rows = (data ?? []) as { id: string; category: ClaimCategory; statement: string; specificity: ClaimSpecificity }[];
        const withNotes = rows
          .map((c) => ({ id: c.id, category: c.category, statement: c.statement, note: weakClaimCoachingNote(c) }))
          .filter((c): c is WeakClaimRow => c.note !== null);
        setWeakClaims(withNotes);
      });
  }, [db.org.id]);

  const actions = extractActions(reviews);
  const clusters = clusterActions(actions).sort((a, b) => clusterPriority(b) - clusterPriority(a));
  const top5 = clusters.slice(0, 5);
  const rest = clusters.slice(5);
  const docsById = new Map(db.documents.map((d) => [d.id, d]));

  const checklist = dataroomChecklist(db.folders, db.documents);
  const missingCount = checklist.filter((c) => !c.present).length;

  if (loading) return <Card title="Action plan"><p className="text-sm text-gray-400">Loading…</p></Card>;

  return (
    <>
      <Card title="Action plan">
        {clusters.length === 0 ? (
          <p className="text-xs text-gray-500">
            No document reviews yet — run one or two in the Review tab and the priority actions that come out of them
            will show up here as a single ranked list, deduplicated across documents.
          </p>
        ) : (
          <>
            <p className="text-xs text-gray-500">
              {clusters.length} distinct {clusters.length === 1 ? 'item' : 'items'} from {reviews.length} document{reviews.length === 1 ? '' : 's'}{' '}
              reviewed, ranked by how often the same issue shows up across documents, then by severity.
            </p>
            <p className="mt-1 text-[11px] text-gray-400">
              Recurrence is measured per document type today (e.g. your Deck vs your Financial plan) — re-analyzing
              the same document type replaces its previous run here rather than counting as a second document. This
              becomes per-document once reviews are linked to a specific file in the Vault.
            </p>
          </>
        )}
      </Card>

      {contradictions.length > 0 && (
        <Card title="Contradictions between documents">
          <ul className="space-y-3">
            {contradictions.map((c, i) => (
              <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-800">{c.text}</p>
                  <span className={`shrink-0 text-xs font-semibold uppercase ${SEVERITY_COLOR[c.severity]}`}>{c.severity}</span>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-amber-200 bg-white p-2 text-xs">
                    <div className="font-semibold text-gray-500">{DOC_KIND_LABEL[c.sideA.kind] ?? c.sideA.kind}</div>
                    <div className="mt-0.5 text-gray-700">&ldquo;{c.sideA.quote}&rdquo;</div>
                  </div>
                  <div className="rounded border border-amber-200 bg-white p-2 text-xs">
                    <div className="font-semibold text-gray-500">{DOC_KIND_LABEL[c.sideB.kind] ?? c.sideB.kind}</div>
                    <div className="mt-0.5 text-gray-700">&ldquo;{c.sideB.quote}&rdquo;</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {top5.length > 0 && (
        <Card title="Top priorities">
          {uploadMsg && <p className="mb-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">{uploadMsg}</p>}
          <ul className="space-y-2">
            {top5.map((cluster, i) => (
              <ClusterRow key={i} cluster={cluster} allActions={actions} docsById={docsById} existingVersions={db.documentVersions}
                documentVersionsAvailable={documentVersionsAvailable} addDocumentVersion={addDocumentVersion}
                orgId={db.org.id} onUploaded={setUploadMsg} />
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer text-xs text-gray-400">Show all {clusters.length} ({rest.length} more)</summary>
              <ul className="mt-2 space-y-2">
                {rest.map((cluster, i) => (
                  <ClusterRow key={i} cluster={cluster} allActions={actions} docsById={docsById} existingVersions={db.documentVersions}
                    documentVersionsAvailable={documentVersionsAvailable} addDocumentVersion={addDocumentVersion}
                    orgId={db.org.id} onUploaded={setUploadMsg} />
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      {weakClaims.length > 0 && (
        <Card title="Strengthen your claims">
          <p className="text-xs text-gray-500">
            These claims are written broadly, so they carry less weight than they could — the fix is yours: add a
            name, a date, or the outcome, or point to a different example instead. This never changes what
            investors see on its own; it&apos;s just for you.
          </p>
          <ul className="mt-2 space-y-2">
            {weakClaims.map((c) => (
              <li key={c.id} className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="text-xs font-medium text-gray-400">{CATEGORY_LABEL[c.category]}</p>
                <p className="mt-0.5 text-sm text-gray-800">&ldquo;{c.statement}&rdquo;</p>
                <p className="mt-1 text-xs text-gray-500">{c.note}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Data Room completeness">
        <p className="mb-2 text-xs text-gray-500">
          No AI, just a structural check against a standard due-diligence checklist — the same &quot;how complete is your
          profile/data room&quot; signal the Hype Startup formula uses, but with the concrete list of what to add.
        </p>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">{checklist.length - missingCount} of {checklist.length} present</p>
        </div>
        <ul className="mt-2 space-y-1">
          {checklist.map((c) => (
            <li key={c.label} className={`text-xs ${c.present ? 'text-emerald-700' : 'text-gray-400'}`}>
              {c.present ? '✓' : '·'} {c.label}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Investability over time">
        <InvestabilityChart runs={runs} />
      </Card>
    </>
  );
}
