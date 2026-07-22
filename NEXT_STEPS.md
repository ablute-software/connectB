# connectB — next steps (build plan)

Status: **app is live and auth works** (3 roles resolve against Supabase). The gap is that
the CRM *content* still runs from a per-browser localStorage seed, so it isn't yet a real
multi-tenant product. Everything below turns it into one. Ordered by priority. Read
`CLAUDE.md` first for architecture.

---

## Phase 0 — config fixes (do first; ~10 min, no code)

These are dashboard settings, not code.

1. **Fix the localhost email links.** Supabase → Authentication → **URL Configuration**:
   - *Site URL* → `https://connect-b-delta.vercel.app`
   - *Redirect URLs* → add `https://connect-b-delta.vercel.app/**`
   This fixes both the sign-up confirmation link and the investor magic links (both currently point to `http://localhost:3000`).
2. **Unblock sign-ups.** The "email rate limit exceeded" is Supabase's tiny built-in email quota (dev only; resets ~1h).
   - Dev now: Authentication → **Sign In / Providers → Email** → turn **off** "Confirm email" (instant login, no email sent).
   - Production later: configure **custom SMTP (Resend)** in Supabase Auth — needed anyway for outreach email (Phase 5).

## Phase 1 — wire the CRM content to Supabase (the big one)

Goal: replace the localStorage store with real, org-scoped Postgres data via RLS, so data
persists server-side and each org sees only its own.

- Build a **Supabase data adapter** that satisfies the same action contract as `src/lib/store.tsx`
  (`logInteraction`, `classifyInteraction`, `unlockPack`, `submitInvestor`, `reviewSubmission`,
  `runAutomationTick`, `approveRun`, task/entity/person CRUD, folders/documents, templates).
- On login, load the current org's data (entities, people, interactions, tasks, folders,
  documents, templates, automations, packs) scoped by `org_id`; RLS + `is_org_member()` already enforce isolation.
- Keep `src/lib/rules.ts` untouched — feed it live data instead of seed data.
- Preserve the demo/localStorage fallback when env vars are absent (local dev / previews).
- Migrate the ablute_ pipeline from `src/lib/data/seed.ts` / `supabase/seed.sql` so Nuno's org keeps its real 15-entity pipeline in Postgres.
- Remove the hard-coded `ablute_` header in `src/components/shell.tsx`; show the org name from `/api/me`.

## Phase 2 — clean first run + real onboarding

- New org should start **empty**, not showing ablute_ data (falls out of Phase 1).
- Rework `/signup` (+ `provision-org`) into a proper onboarding that collects and **validates required fields**:
  - **Startup:** legal/brand name, website, sector, stage, round size/target, country, one-liner.
  - **Person:** full name, **role/cargo (required)**, phone/telemóvel, LinkedIn, email.
- Store these on `orgs` and `org_members`/a `profiles` table (extend schema `0003_*.sql`).
- Revisit the owner-email special-case in `provision-org` once onboarding is real (it currently auto-joins ablute_ + grants back-office).
- Decide email-confirmation posture for production (Phase 0.2).

## Phase 3 — team members & permissions (invitations)

- Roles on `org_members`: `owner`, `admin`, `manager`, `member` (extend the enum) with a permission matrix.
- **Invitations:** `org_invitations` table (email, role, token, status, invited_by, expires_at).
  Flow: owner/admin invites by email → email with link → `/invite/[token]` → accept (signs up or links existing account) → becomes an `org_member` with the granted role.
- Permission checks in the UI and in server routes (who can invite, edit, approve outbox, manage data room, unlock packs).
- Needs Phase 1 (data on Supabase) and Phase 0.2 / Phase 5 (email) working.

## Phase 4 — Data Room with real files

- Supabase **Storage** buckets per org; upload/download in `/documents`; signed URLs.
- Gate investor access via `access_grants`; log opens in `document_views`; surface "who viewed what" to the founder.
- Investor `/portal` shows only granted folders/documents.

## Phase 5 — email sending (Resend)

- Transactional (confirmation, invites, magic links) via custom SMTP in Supabase.
- Outreach: the Outbox approval flow actually dispatches emails via Resend; respect the two automation modes (draft-review vs full-auto) and all `rules.ts` guards. **LinkedIn stays draft-only — never auto-send.**

## Phase 6 — AI Review (paid feature)

- `src/app/api/ai-review/route.ts` already scaffolds it. Wire the Anthropic API (`ANTHROPIC_API_KEY`) to review founder-authored data-room / pitch content. Guardrail: the AI never sends or mutates data — review/suggest only. Gate as a paid feature.

## Phase 7 — billing for packs (Stripe)

- Investor "packs" unlock for a price (free during development). Add Stripe checkout + webhook to flip `pack_unlocks`. Keep the `catalog_deliveries` unique(org_id, catalog_id) ledger so the same investor is never delivered twice to one org.

## Cross-cutting / polish

- Incorporate the refined design ideas from `ideias design.txt`.
- Password reset; verify investor magic-link end-to-end after Phase 0.
- Back-office: developers verify submitted investors into the shared catalog; distribution log.
- Keep every deploy Hobby-safe (crons ≤ daily) until/unless upgrading the Vercel plan.

---

### Quick reference
- Live: https://connect-b-delta.vercel.app · Repo: https://github.com/ablute-software/connectB
- Supabase: https://supabase.com/dashboard/project/wkjcaoqdvhykrfacsylr · Vercel: https://vercel.com/info-ablute-projects/connect-b
- ablute_ org id: `bca54499-03c8-469b-a48d-b9f442e44f69`
