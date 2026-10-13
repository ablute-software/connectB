'use client';
// Prompt 907 §B — whose ticket is this. One small component, used by the list's "Account" column and by the ticket header,
// so the two cannot say different things about the same ticket.
//
//   linked      "ABOUT FOOD (owner)" — the name is a link to the customer's Ficha; a VC firm carries a small "VC" tag
//   not linked  "No account" — and, when the e-mail (or the signed-in user) is an account anyway,
//               "matches account X — not linked" (X a link), or "matches a user with no company — not linked"
import Link from 'next/link';
import type { TicketAccount } from '@/lib/support-ticket-account';

export function TicketAccountLabel({ account }: { account: TicketAccount }) {
  if (account.kind === 'none') return <span className="text-gray-400">No account</span>;
  const name = account.name ?? '(unknown account)';
  return (
    <span>
      {account.href
        ? <Link href={account.href} className="font-medium text-[#0E7490] hover:underline">{name}</Link>
        : <span className="font-medium">{name}</span>}
      {account.role && <span className="text-gray-500"> ({account.role})</span>}
      {account.kind === 'investor_entity' && <span className="ml-1.5 rounded bg-gray-100 px-1 py-0.5 align-middle text-[9px] font-semibold text-gray-500">VC</span>}
    </span>
  );
}

export function TicketAccountMatch({ account }: { account: TicketAccount }) {
  const m = account.kind === 'none' ? account.matches : null;
  if (!m) return null;
  return (
    <span className="text-amber-700">
      {m.kind === 'user' || !m.name
        ? <>matches a user with no company — not linked</>
        : <>matches account {m.href ? <Link href={m.href} className="font-medium underline hover:no-underline">{m.name}</Link> : m.name} — not linked</>}
    </span>
  );
}

/** The list cell: the label, and under it the "matches…" note when there is one. */
export function TicketAccountCell({ account }: { account: TicketAccount }) {
  return (
    <div className="text-xs">
      <TicketAccountLabel account={account} />
      {account.kind === 'none' && account.matches && <div className="mt-0.5 text-[11px]"><TicketAccountMatch account={account} /></div>}
    </div>
  );
}
