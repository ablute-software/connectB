// Prompt 585 §B.4 — the AI-fallback tagging pass. Runs ONLY over evidence
// rows the dictionary matcher already tried and found nothing on (queued
// in evidence_tagging_queue by the migration's own backfill, and by the
// insert-time dictionary pass going forward — that pass is not yet wired
// into a live evidence-writer, since Phase 1 has no new writer beyond the
// backfill; see DECISIONS.md). Admin-triggered (not on a cron yet — "não
// correr o worker sobre produção neste prompt... o Nuno dispara").
//
// claude-haiku-4-5 by default (same cost tier as the enrichment worker's
// own Layer 2 model) — output is restricted to real topic_taxonomy slugs,
// validated server-side, never trusted to invent a topic.
import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/backoffice-auth';
import { logAiCall } from '@/lib/ai-cost-log';
import { DOCUMENT_CONTENT_INSTRUCTION, wrapDocumentContent } from '@/lib/prompt-injection-defense';
import { providerErrorMessage } from '@/lib/ai-provider-error';
import { buildEvidenceTaggingPrompt, parseEvidenceTaggingOutput, EVIDENCE_TAGGING_TOOL_SCHEMA } from '@/lib/evidence-tagging';

export const maxDuration = 60;

const ROUTE = '/api/backoffice/catalog/evidence-tagging/run';
const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;

export async function POST(req: Request) {
  const auth = await requirePlatformAdmin();
  if ('error' in auth) return auth.error;
  const { admin } = auth;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, error: 'AI review isn’t available in this workspace yet.' }, { status: 200 });

  const body = await req.json().catch(() => ({})) as { batch?: number };
  const batch = Math.min(Math.max(1, body.batch ?? DEFAULT_BATCH), MAX_BATCH);
  const model = process.env.EVIDENCE_TAGGING_MODEL ?? 'claude-haiku-4-5';

  const { data: topics } = await admin.from('topic_taxonomy').select('id, slug, label_en').eq('is_active', true);
  const topicOptions = (topics ?? []) as { id: string; slug: string; label_en: string }[];
  const idBySlug = new Map(topicOptions.map((t) => [t.slug, t.id]));
  const validSlugs = new Set(topicOptions.map((t) => t.slug));

  const { data: queued, error: queueErr } = await admin.from('evidence_tagging_queue')
    .select('id, evidence_id, attempts')
    .eq('status', 'queued').order('created_at', { ascending: true }).limit(batch);
  if (queueErr) return NextResponse.json({ ok: false, error: queueErr.message }, { status: 500 });
  if (!queued || queued.length === 0) return NextResponse.json({ ok: true, processed: 0, tagged: 0, noTags: 0, failed: 0 });

  const evidenceIds = queued.map((q) => q.evidence_id as string);
  const { data: evidenceRows } = await admin.from('catalog_evidence').select('id, title, excerpt').in('id', evidenceIds);
  const evidenceById = new Map((evidenceRows ?? []).map((e) => [e.id as string, e as { id: string; title: string; excerpt: string | null }]));

  let tagged = 0; let noTags = 0; let failed = 0;

  for (const job of queued) {
    const evidence = evidenceById.get(job.evidence_id as string);
    if (!evidence) {
      await admin.from('evidence_tagging_queue').update({ status: 'skipped', finished_at: new Date().toISOString() }).eq('id', job.id);
      continue;
    }

    await admin.from('evidence_tagging_queue').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);

    try {
      const prompt = buildEvidenceTaggingPrompt(evidence, topicOptions.map((t) => ({ slug: t.slug, labelEn: t.label_en })));
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: 400,
          system: 'You tag evidence with topics from a fixed taxonomy. You never invent a topic slug that was not offered. '
            + DOCUMENT_CONTENT_INSTRUCTION,
          messages: [{ role: 'user', content: wrapDocumentContent(prompt) }],
          tools: [{ name: 'report_tags', description: 'Return the topic tags for this evidence.', input_schema: EVIDENCE_TAGGING_TOOL_SCHEMA }],
          tool_choice: { type: 'tool', name: 'report_tags' },
        }),
      });
      if (!res.ok) throw new Error(providerErrorMessage('[evidence-tagging]', await res.text()));
      const data = await res.json();
      await logAiCall({ route: ROUTE, purpose: 'evidence:tag', model, usage: data.usage, targetType: 'catalog_evidence', targetId: job.evidence_id as string });

      const toolUse = (data.content as { type: string; input?: unknown }[]).find((b) => b.type === 'tool_use');
      const parsed = parseEvidenceTaggingOutput(toolUse?.input, validSlugs);

      if (parsed.tags.length > 0) {
        await admin.from('catalog_evidence_topics').upsert(
          parsed.tags.map((t) => ({ evidence_id: job.evidence_id, topic_id: idBySlug.get(t.slug), confidence: t.confidence, tag_source: 'ai' })),
          { onConflict: 'evidence_id,topic_id' },
        );
        tagged += 1;
      } else {
        noTags += 1;
      }
      // Polarity/is_personal are suggested alongside the tags (§B.4) —
      // applied directly since this route already runs at service-role
      // privilege and no separate approval step exists for these two
      // fields today; only ever overwrites the 'neutral'/false defaults,
      // never a value an admin already set by hand.
      if (parsed.polarity && parsed.polarity !== 'neutral') {
        await admin.from('catalog_evidence').update({ polarity: parsed.polarity }).eq('id', job.evidence_id).eq('polarity', 'neutral');
      }
      if (parsed.isPersonal) {
        await admin.from('catalog_evidence').update({ is_personal: true }).eq('id', job.evidence_id).eq('is_personal', false);
      }

      await admin.from('evidence_tagging_queue').update({
        status: 'done', finished_at: new Date().toISOString(), model,
        tokens_in: data.usage?.input_tokens ?? null, tokens_out: data.usage?.output_tokens ?? null,
      }).eq('id', job.id);
    } catch (e) {
      failed += 1;
      await admin.from('evidence_tagging_queue').update({
        status: 'failed', finished_at: new Date().toISOString(),
        attempts: ((job.attempts as number) ?? 0) + 1, last_error: (e as Error).message,
      }).eq('id', job.id);
    }
  }

  return NextResponse.json({ ok: true, processed: queued.length, tagged, noTags, failed });
}
