# Prompt 718 Part C — data-repair proposal (Sherlock Deal org `48a7c481-3946-4a06-a86f-6169bd382c76`)

**PROPOSED ONLY. Not applied. Requires Nuno's explicit OK before running**, per Prompt 718's
own instruction. Confirmed live against production on 2026-09-22, matching the prompt's own
description exactly — no drift since the prompt was written.

## What's wrong, confirmed by SQL

Three real, accepted `company_claims` rows and their `gap_questions` rows, all created before
Part A's gapKey stability fix, when G1/G3/G6's key changed the instant the first claim in that
whole category existed:

| id | category | statement | source_ref | status |
|---|---|---|---|---|
| `a49104fc-666f-48c9-908a-7c3af121a842` | tracao_gtm | "No, we do not yet have any paying customers. However, we have signed agreements with partners, such as accelerators. **no**" | `gap:G1:` | accepted |
| `88d87eb3-1029-4f1f-9d6a-471b94f50f47` | equipa | "We have complementary skills" | `gap:G3:` | accepted |
| `31a3d440-70df-4eb8-841c-8769bceef457` | equipa | "We have complementary skills" **(duplicate)** | `gap:G3:88d87eb3-...` | accepted |
| `69097266-7023-47b1-952b-3b8929a24d5d` | funding | "Go-to-market" | `gap:G6:` | accepted |
| `2cbf5aef-0ce9-4936-a4f8-21e5fbcb14e7` | funding | "Go-to-market" **(duplicate)** | `gap:G6:69097266-...` | accepted |

`gap_questions` has a matching duplicate row (volatile key) for each of G1/G3/G6, alongside the
one with the stable key:

| id | gap_key | rule | disposition |
|---|---|---|---|
| `b770461b-ef63-4e79-916e-4d0f56ba4a15` | `G1:` | G1 | new_claim |
| `6777acbc-d323-4b2f-96e0-cb9098fafa1c` | `G1:a49104fc-...` **(duplicate)** | G1 | dismissed_explicit |
| `a0c0238a-f0e8-46b5-a23d-7111ae0c9d37` | `G3:` | G3 | new_claim |
| `685f27f4-dffd-4d56-ba31-be9bba8c6f4d` | `G3:88d87eb3-...` **(duplicate)** | G3 | new_claim |
| `3b553bea-6f41-4d77-b2f5-0c58ec490a37` | `G6:` | G6 | new_claim |
| `d361bb1d-2b5b-4882-8de4-9989d83a0173` | `G6:69097266-...` **(duplicate)** | G6 | new_claim |

## Proposed SQL

```sql
begin;

-- 1. Strip the erroneous trailing " no" the AI router appended onto an
--    unrelated claim (the bare "no" free-text answer that Part C's
--    forceDismiss now catches before it ever reaches this code path).
update company_claims
set statement = regexp_replace(statement, '\s+no$', ''),
    updated_at = now()
where id = 'a49104fc-666f-48c9-908a-7c3af121a842'
  and statement like '%accelerators. no';

-- 2. Delete the duplicate G3/G6 claims created when the volatile key made
--    the answer route think this was a brand-new question rather than a
--    re-answer of the one already on file.
delete from company_claims
where id in ('31a3d440-70df-4eb8-841c-8769bceef457', '2cbf5aef-0ce9-4936-a4f8-21e5fbcb14e7');

-- 3. Normalize gap_questions: delete the volatile-keyed duplicate rows.
--    The founder's LATEST real interaction with G1 was the bare "no" —
--    reflected here by updating the surviving G1: row's disposition
--    rather than leaving it at its earlier 'new_claim' state.
delete from gap_questions
where id in (
  '6777acbc-d323-4b2f-96e0-cb9098fafa1c',
  '685f27f4-dffd-4d56-ba31-be9bba8c6f4d',
  'd361bb1d-2b5b-4882-8de4-9989d83a0173'
);

update gap_questions
set disposition = 'dismiss_trivial_text', answered_at = '2026-09-22 14:31:23.577+00'
where id = 'b770461b-ef63-4e79-916e-4d0f56ba4a15';

commit;
```

## Before/after, to report once run

- `company_claims` for this org: 5 rows touched by category above → 1 statement fixed, 2 duplicates
  deleted (3 net row-count change: 5 → 3 surviving rows across these categories).
- `gap_questions` for this org: 6 rows → 3 rows (one per rule, all on the stable key), one
  disposition updated.

## What this does NOT do

Does not touch any other org's data. Does not change `catalog_deliveries`, `interactions`, or
anything outside `company_claims`/`gap_questions`. Does not re-run gap detection or blueprint
analysis — the founder will see the corrected claim and no more duplicates on next load, with no
other visible change.
