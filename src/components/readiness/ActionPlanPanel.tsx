'use client';
// Readiness & Train — Action plan sub-tab. Placeholder shipped with Prompt
// 115 Block B (the nav/structure move); the real panel — priority-ordered,
// deduplicated findings aggregated from ai_reviews, with a cross-document
// contradictions section and an investability-over-time chart — is Block C,
// its own commit right after this one. This tab exists now so the 3-tab
// structure is complete and real, not so this specific content is done.
import { Card } from '@/components/ui';

export function ActionPlanPanel() {
  return (
    <Card title="Action plan">
      <p className="text-xs text-gray-500">
        This is coming next — a single prioritized list built from your Review runs, so you know what to fix first
        instead of reading four separate reports. Run a review or two in the Review tab in the meantime.
      </p>
    </Card>
  );
}
