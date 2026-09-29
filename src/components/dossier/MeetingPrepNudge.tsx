'use client';
// Prompt 893 §E — "no separador Conversation, quando a stage é Meeting ou
// a última interacção é meeting/call, um cartão 'Meeting with <pessoa> —
// prepare →'." Self-contained (same convention as FilesTab/EntityPeoplePanel):
// takes only entityId, reads the store itself.
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { relationshipSummary } from '@/lib/relationship';

export function MeetingPrepNudge({ entityId }: { entityId: string }) {
  const { db } = useStore();
  const rel = relationshipSummary(db, entityId);
  const lastInteraction = [...db.interactions]
    .filter((i) => i.entity_id === entityId)
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
  const isMeetingContext = rel.stage === 'meeting' || lastInteraction?.channel === 'meeting' || lastInteraction?.channel === 'call';
  if (!isMeetingContext) return null;
  const personId = lastInteraction?.person_id;
  const person = personId ? db.people.find((p) => p.id === personId) : undefined;
  // The prep page is per-person — with no specific person on this
  // meeting-shaped interaction there's nowhere useful to send this link.
  if (!person) return null;
  return (
    <div className="rounded-lg border border-cyan-200 bg-[#E8F4F8] px-3 py-2 text-sm text-cyan-900">
      Meeting with {person.full_name} —{' '}
      <Link href={`/people/${person.id}/prep`} className="font-medium underline hover:no-underline">prepare →</Link>
    </div>
  );
}
