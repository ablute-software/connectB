# catalog_dossier_import

Reusable importer for a shared-catalog investor's team dossier data
(`catalog_evidence` + `catalog_person_research_log`), built 27/09/2026 while
importing 6 people at LINCE Capital. Unlike `pv_person_dossier_import`
(which classified raw, messy research from scratch), this importer's input
is a *validated manifest*: a research process elsewhere already assigned
`evidence_kind`, `role_type`, period precision, `strength`, `is_personal`
and `provenance` per row, and a matching `dry_run_report.json` already
reviewed the same rows for a human. This package's job is narrower —
validate the manifest against production's real enum/constraint shape,
optionally hold specific people back, and emit SQL.

## Manifest shape

```jsonc
{
  "entity_id": "<catalog_entities.id for the investor>",
  "evidence": [
    {
      "person_id": "...", "entity_id": "...", "evidence_kind": "role_history",
      "title": "...", "url": "...", "published_at": "2023-11-01" | null,
      "period_from": "2023-01-01" | null, "period_from_precision": "year" | null,
      "period_to": null, "period_to_precision": null, "period_is_current": true | false | null,
      "role_type": "employment" | "board_advisory" | null,
      "excerpt": "...", "language": "pt", "strength": 1-4, "is_personal": false,
      "provenance": {"provenance_tier": "A", "provenance_source": "...", "import_batch": "..."},
      "topics": [{"topic": "...", "relation_kind": "...", ...}],
      "qa_note": "..."
    }
  ],
  "research_log": [
    {"person_id": "...", "scope": "career", "result": "found", "sources_checked": [...], "note": "..."}
  ]
}
```

## How to run a real import

```bash
python3 -m pytest -v test_lib.py   # 20 tests, always run first
python3 generate_sql.py \
  --manifest /path/to/manifest.json \
  --out-dir /path/to/sql \
  --exclude-person-id <uuid>            # repeatable; holds a person's evidence
  --cross-check /path/to/dry_run_report.json  # optional but recommended
```

This writes `import_evidence.sql`, `import_research_log.sql` (chunked
INSERTs) and `topics_pending_review.json` into `--out-dir`. **It never
touches the database.** Read the generated SQL, then apply it yourself
(`mcp__Supabase__execute_sql`, `psql`, or `supabase db`) with production
access.

## Things this importer deliberately does NOT do

- **Never supplies `content_hash`.** `catalog_evidence.content_hash` is a
  GENERATED column — Postgres computes it itself on INSERT, and an explicit
  value in that column is rejected outright (`428C9`). `lib.content_hash()`
  exists only so a caller can pre-check a manifest row against production's
  existing hashes for a real duplicate, never to populate the column.
- **Never writes `catalog_evidence_topics`.** Topic tagging is its own,
  separately-decided step (same convention the Portugal Ventures import
  established): every row's proposed topics land in
  `topics_pending_review.json` instead, so nothing proposed is silently
  lost, but no taxonomy decision is made here.
- **Never classifies or fixes up raw research.** No
  `disambiguate_excerpt`/`parse_period`/`classify_role_type` — the manifest
  already carries that decision, one row at a time, with a `qa_note`
  explaining it. If a row is wrong, fix the manifest upstream, not this
  script.

## Constraints this importer validates against (read from production, 27/09/2026)

- `catalog_evidence_period_from_precision_pair` / `_to_precision_pair`: a
  date and its precision must be both present or both null.
- `catalog_evidence_period_end_implies_not_current`: a row with a known
  `period_to` cannot have `period_is_current = true`. A `null` alongside a
  known `period_to` is normalized to `false` by `generate_sql.py`
  (`lib.normalize_period_is_current`) — a known end date logically entails
  "not current," so this is not a guess.
- Every enum column (`evidence_kind`, `role_type`, `date_precision`,
  `research_scope`, `research_result`) is checked against the real
  `pg_enum` labels, not a possibly-stale migration file.

## Excluding a person

Exclusion happens **before** validation, deliberately: holding someone back
(an unresolved identity question, e.g. "is this the same Frederico Santos
as the one now at MESO Capital?") must not require their data to already be
clean this round — that is very often exactly why they are excluded.
