# Prompt 907 — verification screenshots (13/10/2026)

Taken with `npm run dev:verify` (demo mode, `/api/me` → `verifyIdentity` = this checkout, HEAD `43d5dd9e` plus the working tree) in the
Browser pane. Throwaway harness pages (deleted afterwards, never committed) mount the REAL back-office pages (`FichaClienteDetailPage`,
`SupportListPage`, `SupportTicketPage`); the endpoints they call were stood in for by a throwaway API route that runs the REAL library code
(`loadOrgPeople`, `buildSupportTicketList`, `resolveTicketAccounts`) over an in-memory database of `zz-test-907` fixtures. The real
routes — including the platform-admin gate — are proved by vitest. No real customer data appears in these captures, and nothing here ran
against production.

| file | what it shows |
|---|---|
| `A1-ficha-people-2-members-1-pending-invite.jpg` | the Ficha of an org with 2 members (owner confirmed, last login 12/10; a teammate who never confirmed or logged in, joined the day the invitation was accepted) and 1 pending invitation, in the People card under the header |
| `B1-ticket-list-with-account-column.jpg` | the ticket list: From, then Account — a startup with the sender's role, a VC firm with its tag, "No account", and "No account — matches account X — not linked" |
| `B2-ticket-list-filtered-by-account.jpg` | the same list filtered by one account; the menu still offers every account |
| `B3-ticket-detail-test-closed-account-owner.jpg` | the detail header: "test · Closed · <org> (owner)" |
| `B4-ticket-detail-no-account-matches-account.jpg` | a ticket from the public form with the owner's real address: "No account", and which account it matches |
| `B5-ticket-detail-visitor-no-account.jpg` | a visitor with no account at all |
