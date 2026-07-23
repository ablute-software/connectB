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

## 6. Back-office console — the developer role is NOT a founder

The developer persona **does not do outreach**, so the founder's pipeline/agenda/today make no
sense there. The back-office is an *operator console* with its own queue + deadlines:

- **Curation queue (the developer's "pipeline")**: investor submissions, field-level
  contributions aggregated across orgs (§1b), profile claims (§5), GDPR requests. States:
  pending → in review → verified/rejected → promoted to public catalog.
- **Ops "Today" (the developer's "agenda")**: GDPR requests approaching the **30-day legal
  deadline** (hard SLA), submissions stalled >7 days, failed automation runs. This is the
  back-office landing screen.
- **Catalog management**: edit public entities/people, **merge duplicates** (same person
  submitted by several startups under different spellings — will happen constantly), compose
  packs, data-quality panel (% profiles with email / thesis / check size filled).
- **Tenants**: list of orgs, activity (last login, interactions/week), active vs. churned,
  later billing status.
- **Platform metrics**: signups, active orgs, contributions/week, pack unlocks, revenue.

**Dual-role UX (Nuno is founder AND developer):** never mix the two views — risk of editing
the public catalog thinking you're in the private ablute_ overlay. Use a **context switcher**
in the shell: "ablute_ (founder)" ↔ "Back-office (platform)", each with its own nav. In
back-office mode the founder nav (pipeline/agenda/today) is hidden; nav becomes
**Queue · Catalog · Startups · Metrics**.

## 6b. Data enrichment & completeness (founder feedback, 22 Jul — the "why is David Alves missing his LinkedIn?" problem)

Context: catalog data was **seeded manually**; there is no engine fetching anything from the web.
A profile like David Alves (COREangels Porto) shows "LinkedIn ?" / "No email" while a 10-second
LinkedIn search finds him — because nobody typed it in. Fix this as a *workflow*, not blind scraping:

### 6b-1. Completeness score
Per catalog person/entity, a weighted score: person → linkedin_url, email, role, affiliations,
preferences/thesis; entity → website, contact email, thesis, check size, stage range, portfolio.
Show the % in back-office and (subtly) on founder-facing profiles.

### 6b-2. Enrichment queue (back-office)
- Profiles below a threshold (~70%) enter an **enrichment queue** in `/backoffice`.
- **Ranked by demand**: nº of orgs with that entity in an active pipeline (stage-weighted), plus
  explicit founder requests. An incomplete profile 5 startups are chasing outranks one nobody contacts.
- Founder-side: a **"Request more info"** action on incomplete profiles → drops into the queue,
  increments demand. Founders tell the platform where curation effort pays.

### 6b-3. AI-assisted research (human-in-the-loop, reuses §1b)
- Back-office "Research with AI" button on a queued profile → server route (Anthropic API +
  web search) searches **public web only** (fund sites, news, interviews, podcasts, portfolio pages)
  and returns **proposed fields, each with source URL + confidence**.
- The AI is just another contributor: proposals land as `contributions` with `author = system/ai`,
  go through the **same verify-then-promote flow** as startup contributions (§1b). Never auto-publish.
- **LinkedIn: store the URL only** (found/confirmed manually). No scraping — ToS violation.
  The §5 self-claim flow is the long-term highest-quality source (the investor validates their own data).

### 6b-4. GDPR / provenance
Enriching person profiles from public sources is still personal-data processing: log
`source_url + retrieved_at + verified_by` per field (provenance), keep it auditable, and wire it
to §5 rectification/erasure. B2B professional context = defensible legitimate interest, but only
with the provenance log.

## 8. AI OUTREACH COMPOSER — the app's most important feature (founder feedback, 22 Jul)

The founder gets **AI-suggested outreach text** (first contact or follow-up) composed from full
context, pre-filled into the send fields, **always confirmed by the founder before anything goes
out**. Composition uses the **Anthropic API** (same `ANTHROPIC_API_KEY` as Phase 6).

### 8a. Context builder
Assemble, per (org, entity, person): startup profile (name, sector, stage, round target, one-liner,
traction), investor context (entity thesis/check size, person preferences, hooks, kill words,
watch-outs), relationship state (§4: stage, whose turn, days waiting, full prior thread), and
`rules.ts` constraints (channel caps, lock state, LinkedIn 900-char limit). This context JSON is
the composer's input — it's what makes output specific, not generic.

### 8b. Compose endpoint
Server route → Claude API with the context + a prompt library keyed by (channel, stage, intent:
first-touch / follow-up / reply / meeting-ask). Returns **structured output**: channel, subject
(email), body, rationale (which hooks were used), confidence. Every draft is passed through
`lintMessage()` **server-side before display**; failing drafts are regenerated or flagged.

### 8c. Review & confirm UI
Draft lands **in the send fields** (not auto-sent): founder reads, edits inline, sees lint/preflight
banners live. Send button only enables when `preflight()` passes. Editing is tracked (AI draft vs
founder final) for learning what the founder changes.

### 8d. Channel pairing & dispatch
- **Email — real send from the founder's mailbox**: OAuth pairing (Gmail API / Microsoft Graph
  "send-as"), fallback SMTP. Sent from the founder's own address, reply-to intact. Store only OAuth
  tokens (encrypted, per org_member), never passwords.
- **LinkedIn — NO auto-send** (no messaging API; automation violates ToS and risks the founder's
  account). Flow: **"Copy + open profile"** button → founder pastes & sends in LinkedIn → one-click
  "mark as sent" logs it. Same for other channels without APIs.
- Channel picker uses the person's/entity's known contacts (§2/§3); missing contact → prompt to add
  (contribution flow §1a).

### 8e. Logging & discipline
Every dispatch (or confirmed manual send) is written as an `interaction` (`ai_generated: true`,
`message_ref` to the final text) → appears in the §4 thread, counts toward daily/weekly caps,
starts the awaiting-reply clock. **The AI never sends autonomously; nothing bypasses rules.ts.**

### 8f. Sub-tasks (build order)
1. Context builder (needs Phase 1 data) → 2. compose endpoint + prompt library → 3. review UI in
the entity/person page + Outbox → 4. interaction logging (§8e) → 5. email OAuth pairing (with
Phase 5) → 6. LinkedIn copy-assist. Ship 1–4 first (draft-only mode is already high-value); pairing
comes after.

## 9. INTERACTION HISTORY IMPORT (founder feedback, 22 Jul)

Founders arrive with **manually-kept records** (spreadsheets, docs, notes) of past investor
interactions. The app must import them, extract structure, and fold them into the IRM.
*(Two example files from Nuno pending — refine field mapping in a §9 annex when they land.)*

### 9a. Upload & formats
Accept xlsx/csv/docx/txt (later .eml/.mbox). Files stored per org (Supabase Storage, Phase 4
bucket); parsing is async with progress.

### 9b. AI extraction
Claude API with **structured output schema**: `people[]` (name, role, phones, emails, linkedin),
`entities[]` (name, site, emails), `interactions[]` (date, channel, direction, person/entity,
summary, outcome, followup markers), each with a **confidence score**. Low-confidence items →
**confirmation prompts** ("Is 'David' David Alves @ COREangels Porto?"). Never silently guess
identities.

### 9c. Reconciliation vs catalog
Match extracted people/entities against the catalog: email exact > LinkedIn URL > fuzzy name+company.
- **Matched** → link imported interactions to the existing record.
- **Unmatched** → create an **org-private** record AND queue a contribution to the **back-office
  merge/integration queue** (§6): the developer decides new-catalog-entry vs merge-with-existing
  (dedup, §6 Catalog management).

### 9d. Staging review (nothing lands unreviewed)
Import produces a **staging diff**: N people (X matched, Y new), M interactions on a preview
timeline, conflicts flagged. Founder approves/edits/discards per item; only then is it committed
(interactions stamped `source: import`, file provenance kept).

### 9e. Post-import analysis → plan
After commit, the app analyses each imported relationship:
- rebuild the §4 timeline & stage (heuristics: reply → Engaged, meeting language → Meeting…);
- compute pending state: whose turn, days waiting, overdue follow-ups, lock status per `rules.ts`
  ("contactable now" vs "locked / not this phase");
- propose **pipeline placement** (wave, priority) + next-best-action per §4d — founder confirms
  before it enters the pipeline.

### 9f. GDPR note
Imported personal data = org-private overlay (lawful basis: the org's own records). It reaches the
public catalog **only** through back-office verification (§1b), and provenance (source file, import
date) is kept per field.

## 9b. IMPORT ANNEX — real files received (22 Jul, evening). Authoritative field mapping + hard requirements.

Nuno delivered the real import pack: `entities.csv` (19), `people.csv` (22), `interactions.csv` (8),
`README.md`. This annex supersedes the generic §9 assumptions. **Read the pack's README.md first.**

### 9b-0. Company identity — corrections that apply EVERYWHERE
- The company is **ablute_** (always written that way). **Exotictarget** is the legal entity
  (EUIPO trademark 019058853 holder) — use only where the legal entity matters.
- **There is NO parent company called "Avelud"** — if that string ever appears in imports,
  seed or notes it is an ERROR: delete it. (Repo verified clean 22 Jul.)
- ablute_ itself holds the **ANI "selo de idoneidade em I&D"**.
- Round: €1.3M seed @ €7–10M pre-money. €100k pre-seed convertible (Portugal Ventures) closed.
  12-month pilot, 11 endpoints (Porto/Matosinhos/Maia) starting — **no results yet**.

### 9b-1. File format facts
UTF-8, comma-separated, all fields quoted. **Pipe `|` separates multi-values**
(`invests_in_geographies`, `sectors`, `kill_words`) → split to `text[]`. Link keys:
`people.entity_name → entities.name`; `interactions.entity_name + person_name`.
Import order: entities → people → interactions. Literal `UNKNOWN` → NULL + needs-verification flag.

### 9b-2. Column mapping highlights (full column docs in the pack's README)
- entities: `hardware_stance` is **the most important column** (screen on it before fit_score —
  ablute_'s recorded rejections are hardware-policy, not merit). `wave` 0=existing investor,
  1=first, 4=deprioritised. `hard_filter`/`hard_filter_status` gate drafting. `status` maps to
  pipeline status. `last_verified`+`source_url` = provenance; re-verify >90 days.
- people: `seniority_rank` (1=first; never approach rank 2 while rank 1 unresolved — existing rule).
  `email_verified` vs `email_guess` are DIFFERENT fields: **never promote a guess to verified,
  never send to a guess** (only 4 verified emails exist in the pack — that is the honest state).
  `hook_status` gates drafting (`researched` only). `do_not_contact` is permanent.
- interactions: `classification` (awaiting|pass) → outcome; `pass_reason` populates the
  pass-analysis (Bynd's 3 passes are policy: medtech/hardware); `next_action`+`next_action_due`
  → tasks. History spans 2019–2026 (Bynd thread ×6, Crista Galli contacted 21 Jul 2026,
  follow-up due 2026-08-04).

### 9b-3. Deduplication — HARD requirement (not naive INSERT)
a) **Entities match on**: (1) normalised website domain, (2) normalised name (lowercase, strip
   legal suffixes/punct/diacritics/whitespace/parenthetical aliases). Aliases are real:
   "MAZE (Mustard Seed MAZE)" == "MAZE" == "Mustard Seed MAZE"; "Bynd Venture Capital" ==
   "Bynd" == "Busy Angels SCR" (former name). **New `entity_aliases` table** so future imports match.
b) **People match on**: (1) normalised LinkedIn URL (strip query params), (2) verified email,
   (3) normalised full name + entity. **Normalise diacritics**: "António Miguel"=="Antonio Miguel",
   "Tomás Penaguião"=="Tomas Penaguiao".
c) **Merge, never blind-overwrite**: verified beats unverified; never overwrite non-empty with
   empty or human note with anything; newer `last_verified` wins on factual fields; both-non-empty-
   and-different → **conflict review queue**, never silently pick.
d) **Dry-run preview**: counts + per-row diff NEW/MATCHED/CONFLICT/SKIPPED with accept-or-skip
   per row. **Idempotent** — same file twice changes nothing.
e) **Provenance per imported field**: source file, source_url, imported_at.

### 9b-4. Affiliations — upgrade, don't duplicate
Migration 0009's `person_affiliations` exists but people still hang off one `entity_id`. Required:
- Extend `person_affiliations` with `seniority_rank int`, `is_primary bool`, `notes text`
  (it already has role/title, kind, current, started/ended). Do NOT create a parallel table.
- Approach order becomes **per (person, entity) affiliation** (`seniority_rank` within the entity).
- Person profile shows ALL affiliations (role/rank each, current vs past); entity profile lists
  its people via affiliations.
- Real cases that prove it: **Lurdes Gramaxo** (Bynd partner AND President Investors Portugal AND
  APBA board — Bynd passed 3×, so the ONLY viable approach is her Investors-Portugal hat: the
  affiliation determines the message); **David Alves** (COREangels Porto + VP Investors Portugal);
  **António Murta** (Pathena fund in wind-down + Pathena Family Office + medtech angel — approach
  as angel, not fund); **Lucanus Polagnoli** (Calm/Storm founder, ex-Speedinvest health team →
  knows Andrea Zitna — consistency check must fire across these two).

## 10. Priority mapping (into NEXT_STEPS phases)

- **Phase 1** (data → Supabase) is the prerequisite for everything here.
- **Phase 2** onboarding — fold in §1c person model if convenient.
- **New Phase 3.5 "IRM data model"**: §1a/§1b/§1c contributions + verification + multi-affiliation.
- **New Phase 3.6 "Entity & person profiles"**: §2 + §3.
- **New Phase 3.7 "Interaction roadmap"**: §4 — high founder value; can start on top of the existing `interactions` model even before full catalog work.
- **New Phase 6.5 "Investor self-claim + GDPR"**: §5 (needs LinkedIn OAuth + back-office).
- **Back-office console (§6)**: grows with each phase — the curation queue lands with Phase 3.5
  (contributions), the GDPR/claims queues with Phase 6.5; the context switcher can come earlier.
- **Enrichment (§6b)**: completeness score + queue land with Phase 3.5 (they ride on `contributions`);
  the AI research button lands with Phase 6 (Anthropic API); "Request more info" is a small add-on to §2/§3.
- **New Phase 5.5 "AI outreach composer"**: §8 — draft-only mode (8a–8c + 8e) needs Phase 1 + §4;
  email pairing (8d) rides on Phase 5; Anthropic API shared with Phase 6. **Highest founder value
  after the §4 roadmap.**
- **New Phase 5.7 "History import"**: §9 — needs Phase 1, §4 (timeline), §1 contributions
  (back-office merge queue) and Storage (Phase 4) for the files.
- **Phase 0.5 quick win**: the CRM→IRM rename (§0) — mechanical, do anytime.

Order suggestion once Phase 1 is done: **§4 roadmap** and **§2/§3 profiles** first (they deliver
the most day-one founder value), then **§8 composer (draft-only)**, then **§1 contributions +
back-office verification**, then **§9 import**, then **§5** and §8d channel pairing.

## 11. COMPANY CANON — the org's verified-truth archive (founder decision, 23 Jul)

Principle: the composer NEVER asserts anything unconfirmed. Every factual claim in a
generated draft either traces to a confirmed fact, or generation pauses and asks the
user. "Infallibility" here means discipline, not intelligence.

### 11a. Data model
`company_facts` (org-scoped, RLS org members; NEVER catalog — this is private truth):
- id, org_id, category enum company_fact_category
  ('product','traction','team','positioning','financing','regulatory','market','metrics','other')
- statement text (one atomic fact, first person plural: "Seed €1.3M phased; first
  tranche €300k")
- status enum company_fact_status ('confirmed','unconfirmed','deprecated')
- source enum company_fact_source ('user','import','ai_extracted'), source_ref text null
- valid_from date null, superseded_by uuid null references company_facts(id)
- confirmed_at timestamptz null, confirmed_by uuid null, created_at, updated_at
Temporal rule: facts are never deleted, they are superseded. The delta between a
deprecated fact and its successor IS the re-approach argument (e.g. health/hardware
→ wellness/biosphere). Deprecated facts remain queryable for "what did we tell them
back then".

### 11b. Composer provenance gate (HARD — chosen over soft-marking)
Generation pipeline:
1. Composer receives: confirmed canon facts + entity record + interaction history +
   reopen_trigger.
2. Model output contract: draft + claims[] — every factual sentence mapped to a fact
   id, OR flagged needs_confirmation with a key question and suggested answers.
3. If any needs_confirmation: the draft is NOT shown. UI presents the question(s) as
   popups (AskUserQuestion-style: question + 2-4 options + free text). Each answer
   is written to company_facts as status=confirmed, source=user. Then generation
   resumes/regenerates. Only a fully-grounded draft is ever displayed.
4. Investor-side claims (portfolio companies, essays, fund announcements) must trace
   to entity records/interactions. If not present: same popup flow, and the answer
   is saved as an entity note so it's grounded next time.
This is how the canon grows: by use, not by form-filling.

### 11c. Consistency engine (reopen doctrine, automated)
When drafting for an entity with prior interactions, the composer context must
include: the prior outcome verbatim (esp. a pass reason), the reopen_trigger, the
date of last contact, and the canon delta since then (facts superseded after that
date + new facts with valid_from after it). The draft must cite the prior "no" and
lead with what changed — the system supplies the delta; the AI never reconstructs
it from memory.

### 11d. Misalignment alert
Before any generation: compare entity profile (stage, ticket, thesis, hardware_stance)
against canon (round size, stage, traction, positioning). Verdict
aligned/caution/misaligned with reasons, stored on the org's entity row
(alignment_status, alignment_notes, alignment_assessed_at). Misaligned → prominent
alert + recommendation: don't approach now; park with a reopen_trigger. Caution →
show reasons in pre-flight.

### 11e. Bootstrap & UI
- Extraction pass over already-imported interaction history and Data Room docs →
  candidate facts as status=unconfirmed, source=import/ai_extracted → review queue
  (confirm / edit-then-confirm / reject), same pattern as import conflicts.
- New page "Company" (workspace section): facts grouped by category, status pills
  (reuse shared pill components), confirm/edit/supersede/add-manually, review queue
  badge. Copy hygiene rules apply (no vendor names, no internals).

### 11f. FUTURE — Analysis tab (specified, NOT to build yet)
A dedicated tab that reviews everything exhaustively: SWOT, risks, weaknesses,
strengths, benchmarking vs comparable raises, investability ranking (readiness vs
round value), personalized advice. Consumes the canon + pipeline stats. Blocked
until the founder unblocks it — depends on canon
*(Section numbering note: §7 intentionally unused; priority mapping moved to §10.)*
