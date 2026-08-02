// Prompt 94 — /today (with its Today/Agenda separadores) is superseded:
// Today moved under the new /tasks (alongside the former Outbox, now
// "Warrants"); Agenda split back out to its own top-level /agenda. Old
// links/bookmarks still land somewhere real rather than 404ing — the old
// ?tab=agenda distinction is preserved by routing it to the new Agenda
// page specifically, everything else (bare /today, ?tab=today) goes to
// Tasks's own default (Today) tab.
import { permanentRedirect } from 'next/navigation';

// Reading searchParams already makes this dynamic in Next 14, but stated
// explicitly (same as /company's redirect) so a build never bakes in one
// answer for every visitor regardless of their actual ?tab=.
export const dynamic = 'force-dynamic';

export default function TodayRedirect({ searchParams }: { searchParams: { tab?: string } }) {
  permanentRedirect(searchParams.tab === 'agenda' ? '/agenda' : '/tasks');
}
