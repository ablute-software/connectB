# ablute_ Investor CRM

Investor-outreach CRM for a seed round that **enforces outreach discipline** — it doesn't just store data.
Built for ablute_'s Seed Round 2026 (€1.3M); multi-tenant by design so other founders can be onboarded later.

## What's inside

| Area | Where |
|---|---|
| Pipeline table (home) | `/` |
| Today / Next Best Action queue | `/today` |
| Entity & person profiles (pre-flight "Can I contact?") | `/entities/[id]`, `/people/[id]` |
| Meeting prep one-pager | `/people/[id]/prep` |
| Log-an-interaction flow + live message linter | `/log` |
| Agenda (month view, ICS export) | `/agenda` |
| Dashboard (funnel, round progress, pass reasons, overrides audit) | `/dashboard` |
| Documents & Data Room (folders, grants, engagement) | `/documents` |
| Investor portal (external, magic-link) | `/portal` |
| Automations (draft_review / full_auto) + Outbox approval queue | `/automations`, `/outbox` |
| AI Review (paid, Anthropic API) | Settings + `/api/ai-review` |

## Business rules enforced in code (`src/lib/rules.ts`)

- **Pre-flight** before any outbound: researched hook · no open hard filter · 14-day contact lock
  (one approach per entity) · seniority order · verified-email-only for email sends (no override) ·
  volume caps (5/day, 20/week) · never a third unanswered message (no override) · official
  submission channel first · do-not-contact hard stop (no override).
- **Message linter**: kill words, 900-char LinkedIn limit, `/edit` links blocked, generic-line-1 warning, one-small-ask reminder.
- **Pass reasons required**; same category at 3+ entities → "the pitch may be the problem" alert.
- **Overrides** always demand a justification and are written to an audit log.
- **Automations** run in `draft_review` (Outbox approval) or `full_auto` — full-auto executes **only**
  when pre-flight is green; otherwise the run falls into the Outbox with the reason. LinkedIn has no
  official send API, so LinkedIn automations always produce ready-to-paste drafts.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

**Demo mode (default):** with no env vars the app runs entirely in the browser with the real
ablute_ pipeline seeded (14+ entities / 20 people, hard filters, kill words, waves). State persists
in localStorage. Settings → "Reset demo" restores the seed.

**Connecting Supabase:**
1. Create a Supabase project, then run `supabase/migrations/0001_init.sql` (SQL editor or CLI) and `supabase/seed.sql`
   (regenerate it any time with `node scripts/gen-seed-sql.mjs`).
2. Copy `.env.example` → `.env.local` and fill the Supabase keys.
3. The data layer swap point is `src/lib/store.tsx` (documented inline) — action semantics
   (locks, follow-up tasks, overrides, runs) are pure functions in `src/lib/rules.ts`, shared by both modes.

**Deploy (Vercel):** import the repo, set env vars, deploy. `vercel.json` schedules the hourly
automation tick (`/api/automations`).

**Phase keys** (all optional until the phase is used): Resend (email sends; verify the ablute.pt domain
first), Stripe (billing), `ANTHROPIC_API_KEY` (AI Review).

## Deliberately out of scope

- Automated LinkedIn sending (no official API; automating risks the account).
- Sending to guessed/unverified emails — never, no override (30–40% bounce destroys sender reputation).
- LinkedIn scraping.

## GDPR

B2B legitimate-interest basis; per-person `data_source` field (Art. 14); do-not-contact toggle
purges research fields immediately and blocks outbounds permanently; investor-portal views are
logged and disclosed.
