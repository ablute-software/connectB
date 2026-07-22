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
   - `src/app/api/provision-org/route.ts` — service-role provisioning on founder sign-up. **Special-case:** the owner email (`ablutecompany@gmail.com`) is linked to the existing seeded ablute_ org (`bca54499-03c8-469b-a48d-b9f442e44f69`) as owner **and** added to `platform_admins`. Revisit this once real onboarding exists.
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

See `NEXT_STEPS.md` for the prioritised build plan.
