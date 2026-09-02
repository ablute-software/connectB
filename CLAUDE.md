# connectB — orientation for Claude Code

connectB is an investor-outreach CRM for startup founders raising a round. It enforces
outreach *discipline* (one approach per entity, contact locks, kill words, pre-flight
checks, volume caps) rather than just storing contacts. Built for ablute_ (Nuno's
healthtech startup, €1.3M seed) but designed as a multi-tenant product with three roles:
**founder**, **investor**, and **developer/back-office** (the platform team).

## Stack & infra

- **Next.js 14** (App Router) · TypeScript · Tailwind. Node/Next build.
- **Supabase** project `wkjcaoqdvhykrfacsylr` — Postgres + Auth (`@supabase/ssr`) + (planned) Storage. RLS on.
- **Vercel** project `connect-b`, team **info-ablute projects** (Hobby plan). Auto-deploys on push to `main`.
- Live: https://connect-b-delta.vercel.app · Repo: https://github.com/ablute-software/connectB
- Env vars already set on Vercel (production+preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Also documented in `.env.example` (adds Resend, Stripe, `ANTHROPIC_API_KEY` for later).
- **Hobby-plan constraint:** `vercel.json` crons run **at most once/day**. Current: `/api/automations` at `0 9 * * *`. Do not set sub-daily schedules or deploys will be rejected (`cron_jobs_limits_reached`).

## Run locally

```bash
npm install
# create .env.local from .env.example (Supabase URL + anon + service_role)
npm run dev      # http://localhost:3000
npm run build    # must pass before pushing
```
Without Supabase env vars the app runs in **demo mode** (localStorage only, auth disabled).

## Verifying a change in the browser — never against production (Prompt 250)

Three test-data writes reached the same real production entity (`c8ff10dd-…`,
sherlockdeal.com) across separate incidents — `stage_change` interactions, real
quota consumption, `deal_messages` — because the safeguard lived in text
("disable `.env.local`, remember to restore it") instead of in something that
enforces itself. This section replaces that with four rules that hold regardless
of which session or model is reading this file (it said "two" while carrying
three; corrected when the fourth was added):

1. **Always start the dev server with `npm run dev:verify`, never plain `npm run
   dev`, for any session that will click through the UI.** `dev:verify` runs
   `scripts/dev-verify.mjs`, which forces demo mode by overriding the three
   Supabase env vars to `''` in the spawned process — **regardless of what
   `.env.local` contains on disk**. No file gets touched, so there's nothing to
   remember to restore, and no chance of forgetting. `npm run dev` (real
   Supabase, for actual feature work) is unaffected. Confirmed empirically: with
   real credentials present and untouched in `.env.local`, `curl localhost:PORT/api/me`
   under `dev:verify` returns `authEnabled: false`.
2. **Only ever use the `Claude_Browser` MCP tools (`mcp__Claude_Browser__*`) for
   verification clicks in this project — never `claude-in-chrome`.**
   `claude-in-chrome` drives the user's REAL Chrome, with real logged-in
   sessions; the original incident happened because a stray production tab in
   that same real browser could silently receive clicks meant for a demo tab.
   `Claude_Browser` is a separate, sandboxed pane — this alone removes that
   failure mode. Before any click sequence, call `tabs_context` and abort if any
   tab's origin matches a production domain (`sherlockdeal.com`,
   `*.sherlockdeal.com`, `connect-b-*.vercel.app`); always pass an explicit
   `tabId` to every `computer`/`navigate`/`form_input` call, never rely on
   "whichever tab is active."
   - **Known limit, stated plainly:** there is no PreToolUse hook that can
     enforce this mechanically — a hook is a stateless external process with no
     access to the live MCP browser session, so it cannot itself inspect open
     tabs. The two rules above are the strongest available substitute: rule 1 is
     a real technical control (env vars can't leak through even if rule 2 is
     forgotten); rule 2 is procedural but concrete and checkable with a real
     tool call, not a promise.
3. **Layer 2 — server-side gate for the residual case: a session that DOES
   need a real Supabase connection** (testing an actual RLS policy, a route
   that behaves differently in demo mode, etc.). Any NEW verification
   fixture (org, entity, catalog entity) must be named starting with
   `zz-test-` (case-insensitive) — this is now enforced, not just a
   convention: `interactions`, `deal_threads`, `deal_messages`, and
   `catalog_deliveries` (the exact tables the original incident touched)
   can only be written to for a `zz-test-*`/`is_test` target through
   dedicated functions (`verification_insert_interaction`,
   `verification_get_or_create_deal_thread`,
   `verification_insert_deal_message`,
   `verification_insert_catalog_delivery` — migration 0183), revoked from
   `public`/`anon`/`authenticated` like every other admin mutation in this
   codebase. A write against a real record raises a clear Postgres
   exception instead of silently succeeding. The app's own routes never
   call these functions, so Nuno's real usage is completely unaffected.
   Ad-hoc verification scripts (`scripts/_verify_*.mjs`, `_check_*.mjs`, …)
   that write to these four tables must go through
   `scripts/_lib/verification-write.mjs` instead of a bare `.from(...).insert(...)`.
   **Known gap, stated plainly:** a live browser click against a real
   Supabase-backed server still writes through the app's normal routes,
   unchanged — rule 1 above (`dev:verify`) is what actually closes that
   vector by removing the real connection during verification; this layer
   is the second, independent net for direct-SQL/ad-hoc-script testing.
4. **Before reporting green: `git status --porcelain` must be empty, and the
   checks must have run on the SHA that is in `origin` — not on the working
   tree.** A clean run proves nothing about what you published if an edit was
   never staged. Confirmed the hard way (Prompt 535, 02/09/2026): a fix was
   made, `tsc`/`vitest`/`build` were run over it and reported as 2933/2933
   green, and only `DECISIONS.md` was committed — so the branch as pushed
   referenced a name that no longer existed and did not compile. The report
   described the disk, not the branch. Verify what you pushed, by reading it
   back from the remote (`git show origin/<branch>:<path>`), not what you have
   open.

## Architecture — read this before changing anything

There are **two layers**, and they are at different stages:

1. **Auth / multi-tenant layer — real, on Supabase.**
   - `src/middleware.ts` — auth gate. Public routes: `/login`, `/signup`, `/auth`, `/portal`, `/api/me`. Redirects unauthenticated users to `/login`. Passes everything through in demo mode.
   - `src/lib/supabase.ts` — browser client + `authEnabled` (`NEXT_PUBLIC_*` must be inlined at build; keep them **non-sensitive** on Vercel or the client bundle won't get them).
   - `src/lib/supabase-server.ts` — server client + **`resolveRole(userId, email)`**: `developer` if in `platform_admins`, else `founder` if in `org_members`, else `investor` if an `access_grants` row matches the email, else `none`.
   - `src/app/api/me/route.ts` — returns `{ authEnabled, user, role }` for the shell.
   - `src/app/api/provision-org/route.ts` — service-role provisioning on founder sign-up. **Special-case:** an owner email (`OWNER_EMAILS` — `ablutecompany@gmail.com` only, since Prompt 531) is linked to the existing seeded ablute_ org (`bca54499-03c8-469b-a48d-b9f442e44f69`) as owner **and** added to `platform_admins`, ignoring every startup field the form sent. `sherlockdeal.com@gmail.com` was removed from the list on 2026-09-01: Sherlock Deal is now its own first real customer — a separate startup org with that address as its founder account — so it must take the ordinary founder path, which this special-case makes impossible. Nobody is locked out by that: team back-office access comes from the `@ablute.pt` domain rule (`isAbluteTeamEmail`, migration 0050), not from this list, and the list had never actually been exercised in production (`ablutecompany@gmail.com` is orphaned there too — no org, no `platform_admins` row). Revisit the remaining address once real onboarding exists.
   - Also since Prompt 538: `/api/provision-org` is in the middleware's `PUBLIC` list, because the route authenticates itself (see its BUG-SEG-1 block) and is otherwise unreachable — with email confirmation on, `signUp()` returns no session, so every founder signup's provisioning POST was redirected to `/login` and the route never ran. Do not "tidy" it back out of `PUBLIC`.
   - `src/app/login`, `src/app/signup`, `src/app/auth/callback` — auth UI + magic-link/code exchange.
   - DB schema: `supabase/migrations/0001_init.sql` (orgs, org_members, entities, people, folders, documents, access_grants, document_views, interactions, tasks, rule_overrides, message_templates, automations, automation_runs, ai_reviews; `is_org_member()`; constraints incl. `no_edit_links`, `pass_requires_reason`) and `0002_catalog.sql` (catalog_entities, packs, pack_items, pack_unlocks, catalog_deliveries with `unique(org_id, catalog_id)`, investor_submissions, platform_admins, `is_platform_admin()`). `supabase/seed.sql` holds the ablute_ pipeline.

2. **CRM content layer — NOT yet on Supabase. This is the main gap.**
   - `src/lib/store.tsx` is a **client-side localStorage store** (`STORAGE_KEY='ablute-crm-demo-v3'`), seeded from `src/lib/data/seed.ts`. Every CRM page (`/`, today, agenda, dashboard, entities/[id], people/[id], documents, outbox, automations, packs, backoffice) reads/writes this local store.
   - Consequence: every user sees the **same ablute_ seed data**, per-browser; nothing persists to the multi-tenant Postgres tables yet. The mobile header even hard-codes `ablute_` (`src/components/shell.tsx`).
   - The store's action semantics (`logInteraction`, `classifyInteraction`, `unlockPack`, `submitInvestor`, `reviewSubmission`, `runAutomationTick`, `approveRun`, …) are the contract a Supabase data adapter must satisfy. The schema + RLS already exist to back them.

## Business rules live in `src/lib/rules.ts` — pure functions, keep them

`outboundCounts`, `preflight`, `preflightSummary`, `lintMessage`, `passReasonAlert`,
`outboundsAwaitingFollowUp`, `fillTemplate`. Constants `LOCK_DAYS=14`, `LINKEDIN_DM_MAX=900`.
The linter rejects `/edit` links, enforces the 900-char LinkedIn cap, flags kill words and
generic first lines; caps are 5/day, 20/week; never a 3rd unanswered follow-up; 3+ passes
in a category raises a "the pitch may be the problem" alert. These are the product's soul —
reuse them as-is when wiring to Supabase; don't reimplement.

## Conventions

- Single source of truth for domain types: `src/lib/types.ts`.
- Server-only code imports from `supabase-server.ts` (has `import 'server-only'`); never import `next/headers` into anything a client component pulls in (that split exists on purpose).
- Keep the two-mode behaviour: if env vars are absent, fall back to demo/localStorage so local dev and previews work.
- Commit messages end with the Co-Authored-By / session trailers already used on `main`.
- Every new Postgres `view` must specify `with (security_invoker = true)` explicitly in its own `create` statement — including a view that's a deliberate cross-user aggregate needing to bypass RLS (e.g. `matchdeal_startup_hype`, which sums across users), as long as its only readers are revoked down to roles with `rolbypassrls` (`postgres`, `service_role`): RLS is bypassed by the *role*, not by DEFINER semantics, so `security_invoker = true` costs nothing there and keeps the `security_definer_view` lint clean. A bare `create or replace view` silently clears a `security_invoker` option applied later via `alter view ... set (...)` while preserving any separately-applied `revoke`/`grant` — confirmed empirically (2026-08-06, migration 0135) — so relying on a follow-up `alter` instead of the clause at the point of definition lets the gap silently reopen on the next schema replay; `drop view` + recreate is worse still, since it also resets the ACL back to Supabase's public-schema defaults (re-granting anon/authenticated), so both protections need to be re-declared together at that point. Only declare `security_invoker = false` explicitly (never by omitting the clause) for a view that genuinely must stay readable by a non-bypassing role (e.g. `authenticated`) while still bypassing RLS for that reader — treat that combination itself as a design smell requiring an explicit sign-off comment, not a routine documented exception, and revoke it from every other role (`public`, `anon`, and `authenticated` too unless that's the one role it must serve) in the same migration: the exception is only safe once PostgREST can no longer serve it to anyone it shouldn't, never on the DEFINER behaviour alone (this is exactly the class of gap that caused the 2026-08-06 leak on `matchdeal_startup_hype` — which, notably, does NOT need this exception; it's revoked down to `postgres`/`service_role` and keeps `security_invoker = true` per the paragraph above). Exercising this exception permanently trips the Supabase advisor lint `0010_security_definer_view` at ERROR for that view — it stays readable by a non-bypassing role with DEFINER semantics, which is exactly what the lint checks for, and there's no way to silence it short of undoing the exception. The sign-off comment must name the lint and the view, and from that point on the production acceptance bar for advisors is "exactly the ERRORs on this documented list", not "zero ERRORs" — don't read a newly-appeared ERROR as a regression without checking this list first, and don't "fix" it by flipping the view back to `security_invoker = true` without re-checking why the exception existed.
- **Startup-performance privacy (root rule).** Founder-private platform/fundraising performance data — pass counts and reasons, passes ratio, contact/outreach counts and velocity, pipeline stats, round progress vs. target (soft-circled amounts, funding gap), interactions, kill words, internal notes — must NEVER reach any investor-facing surface, page, API response, generated text (AI or template), email, or export. Positive qualitative framing about the startup is welcome, but WITHOUT numbers or derivable specifics. Any diff that lets this class of data flow into an investor-facing surface — directly, via join, or via an AI prompt whose output is investor-visible — FAILS the whole diff. Generated content counts: if an AI prompt receives founder-private data and its output can become investor-visible, that is a violation at the prompt, not only at the render. Confirmed empirically (2026-08-16): the investor-visible SWOT for ablute_ carried "High pass rate: 42 total passes… suggests pitch or readiness issues" and "only 116 of 759 investors contacted (15%)" — the founder's own CRM served to the people it is about. The leak was not an accident of rendering: `/api/review/investability` accepted a `pipeline` object and injected it into the model prompt, and its own header comment quoted that exact sentence as the desired output shape. Two consequences that generalise: (1) a prompt is a data flow — audit it like a `select`; (2) when the same generated artifact has two audiences, generate two artifacts, never one filtered at the edge. The investor projection is fail-closed: no investor-safe field means no SWOT, never a fallback to the full report. One distinction, decided 2026-08-16 after the audit this rule triggered, and it is the line between the two halves of the rule: performance DERIVED by the platform (passes, outreach counts, velocity, pipeline stats, anything computed about the founder rather than stated by them) is forbidden outright and has no toggle — it is observation about the founder, not theirs to give. Progress DECLARED by the founder (`round_secured_eur` they typed, soft commits they confirmed) is theirs, is standard social proof in a pitch, and lives behind their own checkbox (`orgs.round_progress_visible_to_investors`, migration 0174) — off means the fields never leave the server, not hidden client-side. `round_target_eur` stays visible either way: the ask is the pitch, and what the toggle protects is progress AGAINST that ask.
- Any full-viewport overlay (`position: fixed; inset: 0`) must be rendered through `createPortal(..., document.body)`, never inline in the component tree — see `WelcomeModal.tsx`/`HelpSupportWidget.tsx` for the existing pattern (SSR guard: `if (typeof document === 'undefined') return null;` before the portal). An ancestor with `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change: transform` or `contain` silently becomes the containing block for fixed-position descendants, which collapses the overlay to that ancestor's box with no error, no warning and no failing test. Confirmed empirically (2026-08-06): the shared `WorkspaceHeader`'s `backdrop-blur` reduced the MatchDeal pairing modal's overlay from 800px to 53px and pushed the card 254px above the viewport — a `max-h`/`overflow-y-auto` fix on the modal itself twelve hours later couldn't touch it, because the bug's axis was the overlay's containing block, not the card's scroll. Do not rely on the ancestor chain staying free of these properties — it is not something the component itself can check, and a purely visual change three files away can reopen it.
- **Sherlock golden rule (Nuno, 28/08/2026).** Sherlock promotes itself by being a **Solution** (get the startup invested, with the most feasible investor for the company and phase), a **Shortcut** (make it easier to find the right investor and do all the work until the term sheet is signed), and a **Feeling** (of being a smart entrepreneur by delegating the sluggish, hard tasks to technology — someone else is losing another year of growth wasting time on unnecessary things). Practical consequence for every feature and every line of copy: the product must *reduce* perceived weight, never add it. Show what Sherlock already did before asking the founder for anything; frame remaining work as small and finite; never guilt-trip, never present a wall of empty fields.

See `NEXT_STEPS.md` for the prioritised build plan.
