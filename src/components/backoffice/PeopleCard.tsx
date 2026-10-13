'use client';
// Prompt 907 §A — the "People" card on the back-office Ficha do cliente: who can sign in to this account, and the
// invitations still waiting. A compact, READ-ONLY table for support context (who do I write to, did they ever confirm their
// e-mail, when did anyone last log in); the actions stay on the moderation / Startups screens.
//
// E-mails are plain text. There is no per-person page to open for an account holder (profile_claims is empty and points at a
// startup's private contact rows, not at its users), so nothing here pretends to be a link.
import { Card } from '@/components/ui';
import type { CustomerInvite, CustomerPerson } from '@/lib/backoffice-customer-people';

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

const JOINED_TITLE: Record<NonNullable<CustomerPerson['joinedSource']>, string> = {
  invitation: 'The day their invitation was accepted',
  seat: 'The day the seat was created',
  account: 'The day their account was created (this table has no joined date of its own)',
};

export function PeopleCard({ members, invites }: { members: CustomerPerson[]; invites: CustomerInvite[] }) {
  return (
    <Card title={`People (${members.length})`}>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody is attached to this account.</p>
      ) : (
        <table className="w-full text-sm" data-testid="people-members">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5 pr-3">E-mail</th><th className="pr-3">Role</th><th className="pr-3">Joined</th>
              <th className="pr-3">E-mail confirmed</th><th>Last login</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-t border-gray-50">
                <td className="py-2 pr-3">{m.email}</td>
                <td className="pr-3 text-gray-600">{m.role ?? '—'}</td>
                <td className="whitespace-nowrap pr-3" title={m.joinedSource ? JOINED_TITLE[m.joinedSource] : undefined}>{fmtDate(m.joinedAt)}</td>
                <td className="pr-3">
                  {m.emailConfirmed
                    ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">Yes</span>
                    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">No</span>}
                </td>
                <td className="whitespace-nowrap">{m.lastSignInAt ? fmtDate(m.lastSignInAt) : <span className="text-gray-400">never</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {invites.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Pending invitations ({invites.length})</p>
          <table className="w-full text-sm" data-testid="people-invites">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3">E-mail</th><th className="pr-3">Role</th><th className="pr-3">Sent</th><th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} className="border-t border-gray-50">
                  <td className="py-2 pr-3">{i.email}</td>
                  <td className="pr-3 text-gray-600">{i.role ?? '—'}</td>
                  <td className="whitespace-nowrap pr-3">{fmtDate(i.sentAt)}</td>
                  <td className="whitespace-nowrap">
                    {fmtDate(i.expiresAt)}
                    {i.expired && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-bold text-red-700">EXPIRED</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
