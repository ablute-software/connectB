# Prompt 906 — verification screenshots (13/10/2026)

Taken with `npm run dev:verify` (demo mode, `/api/me` → `verifyIdentity` = this checkout, HEAD `4cc52284` plus the
working tree) in the Browser pane, on a **throwaway harness page** that was deleted afterwards and never committed.
The page mounts the REAL components (`VisibilityToggle`, `CompletenessBar`, `IdentityCard`, `RoundCard`,
`RoundUpdatesCard`, `RoundUpdatesFeed`, `ForgotPasswordSent`) over the REAL demo store; the four server endpoints they
call were stood in for by the page itself. The real routes are proved by vitest over an in-memory database; the Supabase
store's save path is proved by `org-sync.test.ts`. None of this ran against production.

| file | what it shows |
|---|---|
| `A1-before-6-fields-missing-3pct.jpg` | a sign-up-only profile: "6 fields missing. Still needed: sector, round target, current phase, founding year, revenue, primary contact", 3% |
| `A2-after-identity-save-2-fields-23pct-no-reload.jpg` | after Save on Identity (sector, phase, year, revenue 0), **no reload**: "2 fields missing. Still needed: round target, primary contact", 23% |
| `A3-after-round-save-1-field-24pct-no-reload.jpg` | after Save on Round (target €250,000), no reload: "1 field missing. Still needed: primary contact", 24% |
| `B1-published-founder-card-and-investor-feed.jpg` | an update published (one email); the founder's card now has Edit / Delete; the investor feed beside it shows it |
| `B2-edited-founder-card-and-investor-feed-says-edited.jpg` | after Edit: new text, "· edited <date>" on both sides, no email |
| `B3-delete-confirmation.jpg` | the delete confirmation, with the agreed sentence |
| `B4-after-delete-feed-empty.jpg` | after Delete: the founder's list and the investor feed are both empty |
| `C1-forgot-password-confirmation.jpg` | the "Forgot your password?" confirmation (the red "1 error" badge is the harness page's own hydration warning, not the component) |
