# connectIRM — product spec addendum (founder feedback, 22 Jul 2026)

This extends `NEXT_STEPS.md` with features requested by Nuno (ablute_). Most of these
depend on **Phase 1 (wire content to Supabase)** landing first, because they need real,
per-org, persisted data and a public/private data split. Read `CLAUDE.md` for architecture.

---

## 0. Rename: CRM → IRM (Investor Relations Management)

Product is an **IRM**, not a CRM. Rebrand copy (keep the `connectB` wordmark):
- `src/app/layout.tsx` metadata title: "connectB — IRM" / "Investor Relations Management".
- `src/components/shell.tsx` subtitle "Investor CRM" → "Investor Relations".
- `src/app/login/page.tsx` + `signup/page.tsx`: "your investor CRM" → "your investor relations workspace".
- Anywhere else "CRM" appears in UI copy.

## 1. Core data-model changes (do with / right after Phase 1)

### 1a. Two-tier data with authored contributions
Every entity/person field exists in two layers:
- **Public catalog** — verified, app-provided, visible to every org (`catalog_*` tables).
- **Per-org private overlay** — a startup's own edits/additions.

When a startup user edits or adds info (contact, preferences, likes, notes, etc.), the change is:
1. saved as an **authored contribution** (stamped with `org_id`, `user_id`, `created_at`, field, old/new value) and shown to that org immediately as an overlay on the record;
2. **queued into the developer back-office** as a contribution.

New table sketch: `contributions(id, subject_type ['entity'|'person'], subject_id, catalog_id nullable, org_id, author_user_id, field, value jsonb, note, status ['private'|'submitted'|'verified'|'rejected'|'public'], created_at, reviewed_by, reviewed_at)`.

### 1b. Back-office verification → promote to public
In `/backoffice`, a developer sees contributions **aggregated across all orgs** about the same
person/entity ("14 startups say Andrea Zitna's email is X"). The developer cross-checks,
verifies authenticity, and can **promote a verified field to public** — from then on it belongs
to the shared catalog served to any startup. Keep a provenance/distribution log. Extends the
existing `investor_submissions` / `platform_admins` model to **field-level** contributions.

### 1c. People are first-class and multi-affiliation
A person can work at / belong to **several VCs at once**, be a **business angel**, and have other
investment activity — simultaneously and over time.
- Promote `people` to a first-class catalog object (not owned by a single entity).
- New join table `person_affiliations(person_id, entity_id nullable, title/role, kind ['partner'|'principal'|'operator'|'angel'|'advisor'|...], current bool, started_at, ended_at)`.
- `entity_id` null + kind `angel` = independent angel activity.
- Entity ↔ people is now many-to-many through affiliations; "contact order" is per (org, entity).

## 2. Entity profile: summary + add-info, people kept prominent

Today the entity page shows only People. Add an **entity summary** at the top:
- website, emails, phones, HQ, sectors, stage range, check size, thesis/focus, notable portfolio, co-investors, network notes.
- an **"Add info"** action → authored contribution flow (§1a).
Keep the **People list prominent** (contact-order enforced) directly below the summary, so the
startup can jump from the entity into a **person's profile** rather than staying at entity level.

## 3. Person profile: editable & rich

Editable, all via the authored-contribution flow (§1a):
- contact: LinkedIn URL, email(s), phone(s);
- affiliations (multi, §1c);
- preferences / thesis, likes / interests, personal notes;
- outreach intelligence already in the model: hooks, kill words, watch-outs.
Show a private/public badge per field so the startup knows what's shared vs. their own note.

## 4. THE INTERACTION ROADMAP — the crucial feature (deep design)

Goal: when a founder opens an investor relationship, they must instantly know **where we are,
whose turn it is, when it started and last moved, and what's next** — and be able to open the
**full chronological thread on demand**. Think of it as a *journey*, not a log.

### 4a. Recommendation on summary-vs-detail (Nuno's question)
**Summary-first, load-on-demand.** Show a compact **Relationship summary card** always; open the
**full thread in a right-side drawer** only when the founder clicks. Rationale: the pipeline has
dozens of investors — the founder triages at a glance ("who needs me today?"), then dives into the
one that needs attention. A **side drawer** beats a popup because it keeps pipeline context.

### 4b. Layer 1 — Relationship summary card (always visible; compact version in the pipeline row)
- **Stage stepper** (horizontal): `Not contacted → Contacted → Engaged (replied) → Meeting → Diligence → Decision (committed/passed)`. Current stage highlighted.
- **One-line status**: `First contact 12 Mar · Last touch 3 Apr (12d ago) · 5 touches · Waiting on them · Next: follow-up due 8 Apr`.
- **Whose-turn chip**, colour-coded: amber = we owe a reply, blue = they owe, red = overdue / at-risk.
- CTAs: **Open thread** (loads the drawer) · **Log interaction**.

### 4c. Layer 2 — Thread drawer (opens on demand)
- Header: entity · stage · first/last dates · whose-turn · next step.
- **Filter**: *All people at this entity* | a specific person (an entity has multiple contacts — the founder needs both the per-person thread and the entity-wide story).
- **Chronological timeline** (toggle newest/oldest): each entry = date · channel icon (LinkedIn / email / call / meeting / intro) · direction (out/in) · person · short note · outcome tag (replied / no-reply / positive / pass) · link to the actual message/draft · attachments.
- **Milestones**: stage transitions and key events rendered as bold markers, so it reads as a roadmap.
- **Inline actions**: add interaction; edit/annotate a past entry (authored edit); set / complete the next step; change stage.
- **Discipline banners in context** (reuse `src/lib/rules.ts`): "Locked until 26 Apr (14-day rule)", "Awaiting reply 12d — follow-up allowed", "⚠ 3rd unanswered message — hold", daily/weekly cap usage.

### 4d. Founder-value extras (build these — they make it an IRM, not a log)
- **"Waiting on them for N days"** auto-computed from last outbound with no inbound → drives the Today list and follow-up nudges.
- **Consistency across contacts**: when messaging two people at the same fund / related funds (e.g. the Polagnoli↔Speedinvest note), surface prior messages so the founder stays consistent.
- **Relationship health**: stalled (no movement X days) / warm (recent inbound) / hot (meeting or diligence) → feeds the dashboard.
- **Next-best-action** per relationship, respecting `rules.ts` (e.g. "Follow up with Andrea on LinkedIn — reply overdue 5d", or "Locked — prep person #2").
- **Share/export the thread** for team alignment (the co-admin).

### 4e. Data model
- `interactions(org_id, entity_id, person_id, channel, direction ['out'|'in'], occurred_at, note, outcome, message_ref, created_by)` — mostly exists.
- Relationship stage: `relationship_state(org_id, entity_id, stage, next_step_task_id, updated_at)` (private, per org). Stage changes also written as `interactions` of type `stage_change` so they appear on the timeline.
- First/last contact and whose-turn are **derived** from `interactions`; next step is a `tasks` row (exists).

## 5. Investor self-claim (LinkedIn) + GDPR/RGPD

An investor can **claim their own public profile** and exercise data-subject rights.
- After logging in, allow **"Sign in / connect with LinkedIn"** (Supabase LinkedIn OAuth provider).
- **Match check**: require **≥95% overlap** between the account/LinkedIn and the public record — name, current/past company, access email. Compute a match score; only a high score allows a claim.
- On successful claim: mark the person `claimed_by = user_id`; the investor can request, **under GDPR/RGPD, rectification or erasure** of the info shown to startups.
- **GDPR request queue**: rectification/erasure requests route to the back-office **and notify every org** whose overlay/derived data is affected; keep an auditable log. Erasure must cascade to public catalog + org overlays as required by law.
- New tables: `profile_claims(person_id, claimant_user_id, linkedin_payload jsonb, match_score, status, created_at)`, `gdpr_requests(person_id, claimant_user_id, kind ['rectify'|'erase'], details, status, created_at, resolved_at)`.

## 6. Priority mapping (into NEXT_STEPS phases)

- **Phase 1** (data → Supabase) is the prerequisite for everything here.
- **Phase 2** onboarding — fold in §1c person model if convenient.
- **New Phase 3.5 "IRM data model"**: §1a/§1b/§1c contributions + verification + multi-affiliation.
- **New Phase 3.6 "Entity & person profiles"**: §2 + §3.
- **New Phase 3.7 "Interaction roadmap"**: §4 — high founder value; can start on top of the existing `interactions` model even before full catalog work.
- **New Phase 6.5 "Investor self-claim + GDPR"**: §5 (needs LinkedIn OAuth + back-office).
- **Phase 0.5 quick win**: the CRM→IRM rename (§0) — mechanical, do anytime.

Order suggestion once Phase 1 is done: **§4 roadmap** and **§2/§3 profiles** first (they deliver
the most day-one founder value), then **§1 contributions + back-office verification**, then **§5**.
