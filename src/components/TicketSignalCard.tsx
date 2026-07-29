'use client';
// Investor Workspace Fase 1 (prompt 54) — Zona 2, founder-side visibility.
// investor_ticket_signals is keyed by (org_id, investor_email), not by
// entity_id — a signal is about "this person's stated range for our
// round," and people (not entities) have emails. Matches against every
// email this entity's people are known by (email_verified first, then
// email_guess) rather than requiring a person_id, since a signal recorded
// before the person self-confirmed (Prompt 47) only ever has the email.
import { useEffect, useState } from 'react';
import { authEnabled, browserClient } from '@/lib/supabase';
import { Card } from '@/components/ui';
import type { Person } from '@/lib/types';

interface Signal { id: string; range_label: string; created_at: string; investor_email: string }

export function TicketSignalCard({ orgId, people }: { orgId: string; people: Person[] }) {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loaded, setLoaded] = useState(false);

  const emails = new Set(
    people.flatMap((p) => [p.email_verified?.toLowerCase(), p.email_guess?.toLowerCase()]).filter(Boolean) as string[],
  );

  useEffect(() => {
    if (!authEnabled || emails.size === 0) { setLoaded(true); return; }
    browserClient().from('investor_ticket_signals').select('id, range_label, created_at, investor_email')
      .eq('org_id', orgId).order('created_at', { ascending: false })
      .then(({ data }) => {
        setSignals(((data ?? []) as Signal[]).filter((s) => emails.has(s.investor_email.toLowerCase())));
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, people.length]);

  if (!authEnabled || !loaded || signals.length === 0) return null;

  const latest = signals[0];
  return (
    <Card title="Ticket range">
      <div className="text-sm text-gray-700">
        Indicated <b>{latest.range_label}</b> on {latest.created_at.slice(0, 10)}
      </div>
      {signals.length > 1 && (
        <div className="mt-2 space-y-0.5 text-xs text-gray-400">
          {signals.slice(1).map((s) => (
            <div key={s.id}>{s.range_label} — {s.created_at.slice(0, 10)}</div>
          ))}
        </div>
      )}
    </Card>
  );
}
