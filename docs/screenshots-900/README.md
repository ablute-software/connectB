# Prompt 900 — verification screenshots (13/10/2026)

Taken with `npm run dev:verify` (demo mode; `/api/me` → `verifyIdentity` = this checkout, HEAD `ff0c92f8` plus the working tree, port 3000) in the
Browser pane. Throwaway pages (deleted afterwards, never committed) mount the REAL Startups page — so the REAL tab strip, the REAL Orgs table and
the REAL `ClosedDeletedTab` — and the endpoints they call were stood in for by a throwaway API route that runs the REAL loader
(`loadClosedAccounts`) over an in-memory database of `zz-test` fixtures. **What the stand-in does for the two actions is TypeScript applying the
effect of the SQL functions; the SQL itself is proved separately, on production data, by `scripts/verify-closed-deleted-900.sql` (62 PASS / 0 FAIL,
rolled back).** The real routes — including the platform-admin gate — are proved by vitest. No real customer data appears in these captures
(the case is re-created with `zz-test-caramel-biscuit` / `alexandra@zz-test.example`), and nothing here ran against production.

| file | what it shows |
|---|---|
| `A0-orgs-tab-points-to-the-new-tab.jpg` | the Orgs tab: only the live accounts; "6 closed or deleted accounts are not listed here — they are in **Closed & deleted**", and the tab strip carries the count |
| `A1-closed-and-deleted-tab-top.jpg` | the new tab: search, All / Deleted by moderation / Closed filters, and the first account (closed by its owner, with the retention clock and the owner's "Reopen account…") |
| `A2-the-real-case-both-actions-on.jpg` | the real case re-created: a test account deleted by moderation ("ciau"), its owner confirmed, **also holding a live investor seat**, "Signs in through Investor — …", **Release email** and **Reopen account** both available |
| `B1-release-email-panel-confirm-off.jpg` | Release email: what it will do (the account stays deleted; the person and the blocked list are not touched; what the person still holds; **and, because it is the last member, what the existing rule does to the account**); Confirm is off |
| `B2-release-email-reason-typed-still-off.jpg` | a reason is not enough: Confirm stays off until the e-mail is typed |
| `B3-release-email-e-mail-typed-confirm-on.jpg` | the written confirmation typed: Confirm is on |
| `B4-after-release-account-also-closed.jpg` | after the release: the account now says **Deleted 29/09 … Closed 13/10 …** each with its own person and words, "Closed when its last member was released", Reopen off with its reason |
| `B5-history-of-the-account.jpg` | the account's history, newest first: the release (with the reason and the "last member" fact), the delete, the suspend |
| `C1-gdpr-erasure-both-off-with-reasons.jpg` | a member in a GDPR erasure: both actions off for the whole account, **with the reason written next to the buttons** (not only a tooltip); a second account (two members, one with a live investor seat, one with nothing else) above it |
| `C2-blocked-email-only-that-release-off.jpg` | a blocked e-mail: that person's Release is off ("E-mail on the blocked list — cannot sign in"); the other member's is on ("Signs in through Ecosystem — …"); Reopen is off for the account |
| `D1-reopen-account-panel.jpg` | Reopen account, in the calmer colour used for what gives something back; the account name must be typed |
| `D2-reopen-account-typed-confirm-on.jpg` | reason and name typed: Confirm is on |
| `D3-after-reopen.jpg` | after the reopen: "Reopened … It is active again.", and the tab counts one fewer (6 → 5) |
| `D4-orgs-tab-after-reopen.jpg` | the reopened account is back in the Orgs list (with its Internal tag); the pointer now says 5 |
| `E1-owner-closure-reopen-panel.jpg` | the Prompt 602 owner-closure reopen, now hosted in this tab with the same panel |
