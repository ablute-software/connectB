'use client';
// Investor Workspace Tools (prompt 62.6) — "mark as reviewed" per data-room
// section. Self-contained on purpose: portal/page.tsx already maps the 6
// sections inline, and this avoids threading more state through that large
// existing component for a small, independent toggle.
import { useEffect, useState } from 'react';

export function SectionReviewToggle({ orgId, sectionKey }: { orgId: string; sectionKey: string }) {
  const [reviewed, setReviewed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/diligence-checklist?orgId=${orgId}`).then((r) => r.json()).then((d) => {
      const section = (d.sections ?? []).find((s: { key: string }) => s.key === sectionKey);
      setReviewed(section?.reviewed ?? false);
    });
  }, [orgId, sectionKey]);

  async function toggle() {
    if (reviewed == null) return;
    const next = !reviewed;
    setBusy(true);
    try {
      await fetch('/api/portal/diligence-checklist', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orgId, sectionKey, reviewed: next }),
      });
      setReviewed(next);
    } finally { setBusy(false); }
  }

  if (reviewed == null) return null;

  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-gray-500">
      <input type="checkbox" checked={reviewed} onChange={toggle} disabled={busy} />
      Reviewed
    </label>
  );
}
