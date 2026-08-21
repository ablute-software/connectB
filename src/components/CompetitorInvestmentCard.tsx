'use client';
// Prompt 292 §Fase 1 (Pedido 6) — dossier highlight when this investor
// has a recorded stake in a company from the shared library (migration
// 0201). Reuses the SAME /api/founder/competitor-investments response the
// Pipeline row badge reads (see that route's own header for why one
// batched fetch serves both surfaces) and just filters it down to this
// one entity — a small over-fetch, simpler than a second query path for
// identical, RLS-open data.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { authEnabled } from '@/lib/supabase';
import { competitorInvestmentSummary, type CompetitorInvestmentItem } from '@/lib/competitor-investment-copy';

export function CompetitorInvestmentCard({ entityId }: { entityId: string }) {
  const [items, setItems] = useState<CompetitorInvestmentItem[]>([]);

  useEffect(() => {
    if (!authEnabled) return;
    let cancelled = false;
    fetch('/api/founder/competitor-investments').then((r) => r.json())
      .then((body) => { if (!cancelled && body.ok) setItems((body.items ?? []).filter((i: CompetitorInvestmentItem) => i.entityId === entityId)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [entityId]);

  if (items.length === 0) return null;

  return (
    <Card title="💰 Portfolio signal" tint="blue">
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-gray-800">
            {competitorInvestmentSummary(item)}
            {item.confidence && <span className="ml-1.5 text-xs text-gray-400">({item.confidence} confidence)</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
