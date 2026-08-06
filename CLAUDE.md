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

## Architecture — read this before changing anything

There are **two layers**, and they are at different stages:

1. **Auth / multi-tenant layer — real, on Supabase.**
   - `src/middleware.ts` — auth gate. Public routes: `/login`, `/signup`, `/auth`, `/portal`, `/api/me`. Redirects unauthenticated users to `/login`. Passes everything through in demo mode.
   - `src/lib/supabase.ts` — browser client + `authEnabled` (`NEXT_PUBLIC_*` must be inlined at build; keep them **non-sensitive** on Vercel or the client bundle won't get them).
   - `src/lib/supabase-server.ts` — server client + **`resolveRole(userId, email)`**: `developer` if in `platform_admins`, else `founder` if in `org_members`, else `investor` if an `access_grants` row matches the email, else `none`.
   - `src/app/api/me/route.ts` — returns `{ authEnabled, user, role }` for the shell.
   - `src/app/api/provision-org/route.ts` — service-role provisioning on founder sign-up. **Special-case:** the owner emails (`OWNER_EMAILS` — `ablutecompany@gmail.com` and `sherlockdeal.com@gmail.com`) are linked to the existing seeded ablute_ org (`bca54499-03c8-469b-a48d-b9f442e44f69`) as owner **and** added to `platform_admins`. It's a list because the project account moved to the sherlockdeal.com address; with a single value, signing up as the other one silently yields an ordinary founder with an empty org and no back-office. Revisit this once real onboarding exists.
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
- Any full-viewport overlay (`position: fixed; inset: 0`) must be rendered through `createPortal(..., document.body)`, never inline in the component tree — see `WelcomeModal.tsx`/`HelpSupportWidget.tsx` for the existing pattern (SSR guard: `if (typeof document === 'undefined') return null;` before the portal). An ancestor with `transform`, `filter`, `backdrop-filter`, `perspective`, `will-change: transform` or `contain` silently becomes the containing block for fixed-position descendants, which collapses the overlay to that ancestor's box with no error, no warning and no failing test. Confirmed empirically (2026-08-06): the shared `WorkspaceHeader`'s `backdrop-blur` reduced the MatchDeal pairing modal's overlay from 800px to 53px and pushed the card 254px above the viewport — a `max-h`/`overflow-y-auto` fix on the modal itself twelve hours later couldn't touch it, because the bug's axis was the overlay's containing block, not the card's scroll. Do not rely on the ancestor chain staying free of these properties — it is not something the component itself can check, and a purely visual change three files away can reopen it.

See `NEXT_STEPS.md` for the prioritised build plan.
