'use client';
// Prompt 117 Bloco C — standalone printable/shareable view of one past
// review or investability run, linked from History (Bloco B). Deliberately
// its own route rather than a modal: window.print() prints whatever's on
// the page, so isolating exactly one report (not the whole History list)
// onto its own page is what makes Print actually work.
//
// Zero server-side sending: Print is window.print() (never jsPDF/
// html2canvas — this is a real invoice-shaped instruction, not a design
// preference, per the prompt that asked for this Bloco), mailto:/wa.me: are
// plain links the browser's own mail/WhatsApp client opens, and Copy is a
// clipboard write. Nothing here calls an API route or sends anything on
// the founder's behalf.
import { useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';
import { ReviewResultBody } from '@/components/readiness/ReviewResultBody';
import { KIND_LABEL } from '@/components/readiness/HistoryPanel';
import { ClarificationBullet } from '@/components/readiness/ClarificationBullet';
import { clarificationsByKey, clarificationKey, upsertClarification, type ReviewCategory, type ReviewClarification } from '@/lib/review-clarifications';
import { reviewResultToMarkdown } from '@/lib/review-result-markdown';

interface AiReviewRow {
  id: string; org_id: string; kind: string; title: string | null; created_at: string;
  input_text: string | null; interaction_draft: string | null; result: unknown;
}
interface ReviewRunRow {
  id: string; org_id: string; score: number | null; summary: string | null; created_at: string;
  // Prompt 166 §A — opportunities/threats added; optional since runs from
  // before that prompt won't have them.
  report: { strengths: string[]; weaknesses: string[]; opportunities?: string[]; threats?: string[]; risks: string[]; recommendations: string[] } | null;
}

type Loaded =
  | { kind: 'ai_review'; row: AiReviewRow }
  | { kind: 'review_run'; row: ReviewRunRow };

export default function ReportPage({ params, searchParams }: { params: { id: string }; searchParams: { type?: string } }) {
  const type = searchParams.type === 'review_run' ? 'review_run' : 'ai_review';
  const [loaded, setLoaded] = useState<Loaded | null | 'not_found'>(null);
  const [copied, setCopied] = useState(false);
  // Prompt 168 §B — "any visible run" includes this standalone report page.
  // Fetched per-run (not org-wide like ReviewPanel/History) since only one
  // run is ever on screen here. reviewClarifications === false (capability
  // not yet applied) leaves this null, same "absent means not editable yet"
  // read as everywhere else.
  const [reviewClarifications, setReviewClarifications] = useState<boolean | null>(null);
  const [clarifications, setClarifications] = useState<ReviewClarification[]>([]);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' }).then((r) => r.json())
      .then((me) => setReviewClarifications(!!me.capabilities?.reviewClarifications))
      .catch(() => setReviewClarifications(false));
  }, []);

  useEffect(() => {
    if (!authEnabled) { setLoaded('not_found'); return; }
    (async () => {
      if (type === 'review_run') {
        const { data } = await browserClient().from('review_runs')
          .select('id, org_id, score, summary, report, created_at').eq('id', params.id).maybeSingle();
        setLoaded(data ? { kind: 'review_run', row: data as ReviewRunRow } : 'not_found');
      } else {
        const { data } = await browserClient().from('ai_reviews')
          .select('*').eq('id', params.id).maybeSingle();
        setLoaded(data ? { kind: 'ai_review', row: data as AiReviewRow } : 'not_found');
      }
    })();
  }, [type, params.id]);

  useEffect(() => {
    if (!authEnabled || !reviewClarifications || type !== 'review_run') return;
    browserClient().from('review_clarifications').select('*').eq('review_run_id', params.id)
      .then(({ data }) => setClarifications((data as ReviewClarification[] | null) ?? []));
  }, [reviewClarifications, type, params.id]);

  function handleClarificationSaved(c: ReviewClarification) {
    setClarifications((prev) => upsertClarification(prev, c));
  }
  const clarificationMap = reviewClarifications ? clarificationsByKey(clarifications) : null;

  if (loaded === null) return <div className="mx-auto max-w-2xl p-6 text-sm text-gray-400">Loading…</div>;
  if (loaded === 'not_found') {
    return (
      <div className="mx-auto max-w-2xl p-6 text-sm text-gray-500">
        Report not found — either it doesn&apos;t exist, or you&apos;re not signed in to the workspace it belongs to.
      </div>
    );
  }

  const title = loaded.kind === 'ai_review'
    ? (loaded.row.title ?? KIND_LABEL[loaded.row.kind] ?? loaded.row.kind)
    : 'Investability ranking';
  const kindLabel = loaded.kind === 'ai_review' ? (KIND_LABEL[loaded.row.kind] ?? loaded.row.kind) : 'Investability ranking';
  const createdAt = loaded.row.created_at;
  const originalText = loaded.kind === 'ai_review' ? (loaded.row.input_text ?? loaded.row.interaction_draft ?? null) : null;

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const markdown = loaded.kind === 'ai_review'
    ? reviewResultToMarkdown({ title, kindLabel, createdAt, kind: loaded.row.kind, result: loaded.row.result })
    : reviewResultToMarkdown({
        title, kindLabel, createdAt, kind: 'investability_ranking',
        result: { review: `Score: ${loaded.row.score} / 100\n\n${loaded.row.summary ?? ''}` },
      });

  const mailHref = `mailto:?subject=${encodeURIComponent(`${title} — Sherlock Deal report`)}`
    + `&body=${encodeURIComponent(`${title}\n\n${shareUrl}\n\nNote: this link only opens for people signed in to this workspace.`)}`;
  const waHref = `https://wa.me/?text=${encodeURIComponent(`${title} — Sherlock Deal report: ${shareUrl}`)}`;

  async function copyMarkdown() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6 print:max-w-none print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-lg font-bold">{title}</h1>
          <div className="text-xs text-gray-400">{kindLabel} · {createdAt.slice(0, 10)}</div>
        </div>
        <button onClick={() => window.print()} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600">Print / PDF</button>
      </div>

      <div className="hidden print:block">
        <h1 className="text-lg font-bold">{title}</h1>
        <div className="text-xs text-gray-400">{kindLabel} · {createdAt.slice(0, 10)}</div>
      </div>

      {/* Prompt 503 §3 — este aviso era uma barra AMARELA isolada no topo do
          conteúdo, e o Nuno leu-a como se o relatório tivesse falhado a
          abrir. Não é um estado de erro: é texto estático, sempre mostrado
          quando o relatório carrega BEM (o caso de falha, 'not_found', é uma
          página completamente diferente, mais acima). A informação é real e
          importa antes de partilhar — o que muda é onde e como aparece:
          deixa de ser um alerta no topo e passa a ser a nota de rodapé dos
          próprios botões de partilha, que é o momento em que serve para
          alguma coisa. Sem amarelo, porque não é um aviso de problema. */}
      <div className="print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <a href={mailHref} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">Email</a>
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">WhatsApp</a>
          <button onClick={copyMarkdown} className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
            {copied ? 'Copied ✓' : 'Copy as Markdown'}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Before you share: this link only opens for people signed in to this workspace. An investor who hasn&apos;t been
          granted access sees a login page, not the report.
        </p>
      </div>

      <Card title={loaded.kind === 'review_run' ? 'Investability ranking — readiness vs round value' : title}>
        {loaded.kind === 'review_run' ? (
          <div className="text-sm">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-[#0E7490]">{loaded.row.score}</span>
              <span className="text-xs text-gray-400">/ 100</span>
            </div>
            {loaded.row.summary && <p className="mt-1 text-gray-700">{loaded.row.summary}</p>}
            {loaded.row.report && (['strengths', 'weaknesses', 'opportunities', 'threats', 'risks', 'recommendations'] as const).map((k) => (
              loaded.kind === 'review_run' && loaded.row.report?.[k]?.length ? (
                <div key={k} className="mt-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{k}</div>
                  <ul className="ml-4 list-disc text-xs text-gray-700">
                    {(loaded.row.report[k] ?? []).map((x, i) => (
                      <li key={i}>
                        {x}
                        {clarificationMap && loaded.kind === 'review_run' && (
                          <ClarificationBullet
                            orgId={loaded.row.org_id} reviewRunId={loaded.row.id} category={k as ReviewCategory} itemIndex={i} itemText={x}
                            existing={clarificationMap.get(clarificationKey(loaded.row.id, k as ReviewCategory, i)) ?? null}
                            onSaved={handleClarificationSaved} hideOnPrint
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            ))}
          </div>
        ) : (
          <ReviewResultBody kind={loaded.row.kind} result={loaded.row.result} />
        )}
        {originalText && (
          <details className="mt-3 print:hidden">
            <summary className="cursor-pointer text-xs text-gray-400">Original text</summary>
            <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-2 text-xs text-gray-600">{originalText}</pre>
          </details>
        )}
      </Card>

      <div className="pt-2 text-center text-[10px] text-gray-400 print:block">Sherlock Deal · report generated {createdAt.slice(0, 10)}</div>
    </div>
  );
}
