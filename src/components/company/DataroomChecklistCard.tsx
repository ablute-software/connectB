'use client';
// Investor Workspace Fase 2 (prompt 55) — "your data room through the
// investor's eyes." Read-only: the actual folder→section mapping is set
// via migration data today (see 0058's header for the ablute_ mapping
// table); this card just shows the founder what an investor currently
// sees, section by section.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface SectionStatus {
  key: string; label: string; documentCount: number; viewCount: number;
  lastViewedAt: string | null; totalMinutes: number | null;
}
interface ChecklistResponse { sections: SectionStatus[]; lastActive: SectionStatus | null }

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

export function DataroomChecklistCard() {
  const [data, setData] = useState<ChecklistResponse | null>(null);

  useEffect(() => {
    fetch('/api/org/dataroom-checklist').then((r) => r.json()).then((d) => setData(d.error ? null : d));
  }, []);

  if (!data) return null;

  return (
    <Card title="Your data room, through the investor's eyes">
      {data.lastActive && (
        <p className="mb-3 text-xs text-gray-500">
          Last activity: {timeAgo(data.lastActive.lastViewedAt as string)}, viewed <b>{data.lastActive.label}</b>
          {data.lastActive.totalMinutes ? ` · ${data.lastActive.totalMinutes} min` : ''}
        </p>
      )}
      <div className="space-y-1.5">
        {data.sections.map((s) => (
          <div key={s.key} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
            <span className="font-medium text-gray-700">{s.label}</span>
            {s.documentCount > 0 ? (
              <span className="text-xs text-[#0E7490]">{s.documentCount} document{s.documentCount === 1 ? '' : 's'}</span>
            ) : (
              <span className="text-xs text-amber-600">In preparation</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
