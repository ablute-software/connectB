// Verification follow-up on Prompt 117 (V1) — shared shape validation +
// coercion for AI-review structured reports, used by both the write path
// (/api/ai-review) and the render path (ReportView/ReviewResultBody).
// Previously only the render path guarded against a malformed model
// response (isRenderableReport, born from a real crash found while
// building the History tab) — that protects React, not the data. Every
// future reader of ai_reviews.result would have had to reimplement the
// same guard. This is now the one definition of "valid shape," and the
// write path uses it to coerce-before-reject rather than persist garbage
// silently (the previous behavior) or drop the model's real response
// entirely (the tempting-but-wrong fix).
import type { CompanyFactCategory } from './types';

// Prompt 302 §2 — quote is optional: every review made before this existed
// has none (never invent one retroactively — see the migration's own
// comment), and only weaknesses/risks ask the model for it (recommendations
// are the suggested FIX, not a point traceable to one source sentence).
export interface Finding { text: string; category: CompanyFactCategory; quote?: string }
export interface SeverityFinding extends Finding { severity: 'low' | 'medium' | 'high' }
export interface StructuredReport {
  score: number; summary: string;
  strengths: string[]; weaknesses: SeverityFinding[]; risks: SeverityFinding[]; recommendations: Finding[];
}

export function isRenderableReport(r: unknown): r is StructuredReport {
  const x = r as Partial<StructuredReport> | null;
  return !!x && Array.isArray(x.strengths) && Array.isArray(x.weaknesses) && Array.isArray(x.risks) && Array.isArray(x.recommendations);
}

// Splits a markdown-bullet-style string into lines, stripping "- "/"* "/
// "1. " markers — the exact shape observed in production (`strengths` came
// back as "\n- Care homes represent...\n- Connected monitoring...\n"
// instead of an array). Recovers real, itemized content instead of
// wrapping the whole blob as one opaque entry. Falls back to a single-item
// array when no bullet markers are found — still better than discarding it.
function splitBulletString(s: string): string[] {
  const lines = s.split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*|^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : [s.trim()].filter(Boolean);
}

function coerceStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? v : null;
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') return splitBulletString(v);
  return null;
}

// weaknesses/risks/recommendations are arrays of {text, category, severity?}
// objects, not plain strings — when the field collapses to a string, each
// recovered line becomes its own finding with a generic category/severity
// (unrecoverable from flattened text) rather than one finding holding the
// entire blob as `text`, so ReportView's per-item rendering still works.
function coerceFindingArray(v: unknown, withSeverity: boolean): Finding[] | SeverityFinding[] | null {
  if (Array.isArray(v)) {
    const ok = v.every((x) => x && typeof x === 'object' && typeof (x as Finding).text === 'string');
    return ok ? (v as Finding[]) : null;
  }
  if (v === undefined || v === null) return [];
  if (typeof v === 'string') {
    return splitBulletString(v).map((text) => (
      withSeverity ? { text, category: 'other', severity: 'medium' as const } : { text, category: 'other' }
    ));
  }
  return null;
}

export type CoercionResult =
  | { ok: true; report: StructuredReport; coerced: boolean }
  | { ok: false };

// score/summary are left unvalidated beyond a type check — every malformed
// row observed in production had those two fields correct; the failure
// mode is specific to the array fields.
export function coerceReport(raw: unknown): CoercionResult {
  const x = raw as Partial<StructuredReport> | null;
  if (!x || typeof x !== 'object' || typeof x.score !== 'number' || typeof x.summary !== 'string') return { ok: false };

  const strengths = coerceStringArray(x.strengths);
  const weaknesses = coerceFindingArray(x.weaknesses, true);
  const risks = coerceFindingArray(x.risks, true);
  const recommendations = coerceFindingArray(x.recommendations, false);
  if (strengths === null || weaknesses === null || risks === null || recommendations === null) return { ok: false };

  const wasAlreadyValid = isRenderableReport(x);
  return {
    ok: true,
    coerced: !wasAlreadyValid,
    report: { score: x.score, summary: x.summary, strengths, weaknesses: weaknesses as SeverityFinding[], risks: risks as SeverityFinding[], recommendations: recommendations as Finding[] },
  };
}
