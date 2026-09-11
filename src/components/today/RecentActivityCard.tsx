'use client';
// Prompt 884 — the right column's Recent activity card: last 3-5 real
// events (buildRecentActivity), with a real "View all activity →" link to
// a full paginated list (/today/activity), not a dead link.
import Link from 'next/link';
import { Card, EntityLink } from '@/components/ui';
import { useStore } from '@/lib/store';
import { buildRecentActivity, formatActivityTime } from '@/lib/recent-activity';

export function RecentActivityCard({ now }: { now: Date }) {
  const { db } = useStore();
  const events = buildRecentActivity(db).slice(0, 5);

  return (
    <Card title="Recent activity">
      {events.length === 0 ? <p className="text-sm text-gray-400">No activity yet.</p> : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              {e.entityId ? (
                <span><EntityLink id={e.entityId}>{e.label}</EntityLink></span>
              ) : (
                <span>{e.label}</span>
              )}
              <div className="text-xs text-gray-400">{formatActivityTime(e.occurredAt, now)}</div>
            </li>
          ))}
        </ul>
      )}
      <Link href="/today/activity" className="mt-3 block text-xs font-medium text-[#0E7490] hover:underline">
        View all activity →
      </Link>
    </Card>
  );
}
