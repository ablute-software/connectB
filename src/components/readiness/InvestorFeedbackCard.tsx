'use client';
// Prompt 349 — Chamber 2 + Chamber 3 landing on the founder side. Two
// distinct sources, never merged into one list: Chamber 2 items are
// identified (an investor chose, item by item, to share this with you);
// Chamber 3 is the k-anonymous (k>=3) structural aggregate — no investor
// identity, no per-investor number, ever. When Chamber 3 isn't available
// (fewer than 3 contributors), it renders NOTHING at all — not a "not
// enough data yet" placeholder, since a below-threshold count is exactly
// what k-anonymity exists to hide.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Share { id: string; investor_name: string; kind: string; text: string; shared_at: string }
interface Digest { contributorCount: number; scoreAvg: number | null; scoreMin: number | null; scoreMax: number | null; themes: string[]; generatedAt: string }

const KIND_LABEL: Record<string, string> = { reading: 'Reading', threshold_suggestion: 'Suggestion', alert_reason: 'Note' };

export function InvestorFeedbackCard() {
  const [shares, setShares] = useState<Share[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);

  useEffect(() => {
    fetch('/api/founder/investor-feedback', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => setShares(body.shares ?? [])).catch(() => {});
    fetch('/api/org/watson-investor-digest', { cache: 'no-store' }).then((r) => r.json())
      .then((body) => setDigest(body.available ? body.digest : null)).catch(() => {});
  }, []);

  if (shares.length === 0 && !digest) return null;

  return (
    <Card title="What investors think">
      {digest && (
        <div className="mb-3 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-gray-700">
          <p className="font-medium text-[#0E7490]">
            Aggregate across {digest.contributorCount} investors — never attributed to any single one.
          </p>
          {digest.scoreAvg !== null && (
            <p className="mt-1 text-gray-600">Average score: {digest.scoreAvg} (range {digest.scoreMin}–{digest.scoreMax})</p>
          )}
          {digest.themes.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-gray-600">
              {digest.themes.map((t, i) => <li key={i}>{t}</li>)}
            </ul>
          )}
        </div>
      )}
      {shares.length > 0 && (
        <ul className="space-y-2">
          {shares.map((s) => (
            <li key={s.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
              <span className="font-medium text-gray-700">{s.investor_name}</span>
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{KIND_LABEL[s.kind] ?? s.kind}</span>
              <p className="mt-1 text-gray-600">{s.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
