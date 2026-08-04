// Prompt 117 Bloco C — Copy-as-Markdown. Pure serialization so it's testable
// independent of the report page's rendering, and the same function can back
// a "copy" button for any of the kinds History already knows how to render.
import { isRenderableReport } from '@/lib/ai-review-shape';
import { contradictionsOf, freeTextOf, STRUCTURED_KINDS, type Severity } from '@/components/readiness/ReviewResultBody';

function bullet(text: string, tags: string[] = []): string {
  const suffix = tags.length ? ` _(${tags.join(', ')})_` : '';
  return `- ${text}${suffix}`;
}

export function reviewResultToMarkdown(opts: { title: string; kindLabel: string; createdAt: string; kind: string; result: unknown }): string {
  const { title, kindLabel, createdAt, kind, result } = opts;
  const header = `# ${title}\n\n_${kindLabel} · ${createdAt.slice(0, 10)}_\n`;

  if (STRUCTURED_KINDS.has(kind) && isRenderableReport(result)) {
    const r = result;
    const lines = [
      header,
      `**Score:** ${r.score} / 10\n`,
      `${r.summary}\n`,
      r.strengths.length ? `## Strengths\n${r.strengths.map((s) => bullet(s)).join('\n')}\n` : '',
      r.weaknesses.length ? `## Weaknesses\n${r.weaknesses.map((f) => bullet(f.text, [f.severity, f.category])).join('\n')}\n` : '',
      r.risks.length ? `## Risks\n${r.risks.map((f) => bullet(f.text, [f.severity, f.category])).join('\n')}\n` : '',
      r.recommendations.length ? `## Recommendations\n${r.recommendations.map((f) => bullet(f.text, [f.category])).join('\n')}\n` : '',
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (kind === 'cross_document_review') {
    const contradictions = contradictionsOf(result);
    if (contradictions.length === 0) return `${header}\nNo genuine contradictions found between these two documents.\n`;
    return `${header}\n## Contradictions\n${contradictions.map((c: { text: string; severity: Severity }) => bullet(c.text, [c.severity])).join('\n')}\n`;
  }

  return `${header}\n${freeTextOf(result)}\n`;
}
