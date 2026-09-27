#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reusable catalog-dossier importer — reads a validated manifest (evidence +
research_log rows, already classified/QA'd upstream, one investor's team at
a time) and writes SQL INSERT files for catalog_evidence and
catalog_person_research_log. NEVER EXECUTES ANYTHING ON THE DATABASE ITSELF
— the .sql files it writes must be run separately by whoever has production
access, same as pv_person_dossier_import's generate_sql.py.

Unlike pv_person_dossier_import, this script does not classify or fix up
raw research (no disambiguate_excerpt/parse_period/classify_role_type):
the manifest format this reads already carries evidence_kind, role_type,
period_from/to + precision, strength, is_personal, and a provenance object
per row, because a research process produced it that way and a
dry_run_report.json already reviewed it (see lince_6_people_manifest.json /
dry_run_report.json, 27/09/2026, for the shape this was built against).
This script's job is: validate the manifest against production's real
enum/constraint shape, let the caller hold back specific people (an
unresolved identity question, e.g.), compute the same content_hash
production uses, and emit chunked SQL.

Manifest shape expected (top-level keys):
  entity_id: str
  evidence: [ {person_id, entity_id, evidence_kind, title, url, published_at,
               period_from, period_from_precision, period_to,
               period_to_precision, period_is_current, role_type, excerpt,
               language, strength, is_personal, provenance, topics, qa_note}, ... ]
  research_log: [ {person_id, scope, result, sources_checked, note}, ... ]

`topics` on each evidence row is deliberately NOT written anywhere by this
script — catalog_evidence_topics tagging is its own separate, deferred step
(same convention the Portugal Ventures import already established: real
evidence lands first, topic taxonomy decisions happen afterward on their own
timeline). Every row's topics are instead collected into a
topics_pending_review.json in --out-dir so nothing proposed is silently lost.

Usage:
    python3 generate_sql.py --manifest /path/to/manifest.json \
        --out-dir /path/to/sql --exclude-person-id <uuid> \
        --cross-check /path/to/dry_run_report.json
"""
import argparse
import json
import os

import lib


def sql_str(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def sql_date(v):
    if not v:
        return "NULL"
    return f"'{v}'::date"


def sql_bool(v):
    if v is None:
        return "NULL"
    return "true" if v else "false"


def sql_enum(v, cast):
    if v is None:
        return "NULL"
    return f"'{v}'::{cast}"


def sql_jsonb(d):
    return "'" + json.dumps(d, ensure_ascii=False).replace("\\", "\\\\").replace("'", "''") + "'::jsonb"


def generate_evidence_sql(rows, chunk_size):
    value_rows = []
    for r in rows:
        r = lib.normalize_period_is_current(r)
        provenance = dict(r.get("provenance") or {})
        if r.get("qa_note"):
            provenance["qa_note"] = r["qa_note"]
        row = "(" + ", ".join([
            sql_str(r["person_id"]),
            sql_str(r["entity_id"]),
            sql_enum(r["evidence_kind"], "evidence_kind"),
            sql_str((r.get("title") or "")[:500]),
            sql_str(r["url"]),
            sql_date(r.get("published_at")),
            sql_str(r.get("excerpt")),
            sql_enum("neutral", "evidence_polarity"),
            str(r.get("strength", 2)),
            sql_bool(r.get("is_personal", False)),
            sql_enum("import", "evidence_origin"),
            sql_enum("found", "evidence_status"),
            "NULL",  # created_by_org_id
            sql_jsonb(provenance),
            sql_enum(r.get("role_type"), "role_type_kind"),
            sql_date(r.get("period_from")),
            sql_enum(r.get("period_from_precision"), "date_precision"),
            sql_date(r.get("period_to")),
            sql_enum(r.get("period_to_precision"), "date_precision"),
            sql_bool(r.get("period_is_current")),
        ]) + ")"
        value_rows.append(row)

    cols = ("(person_id, entity_id, kind, title, url, published_at, excerpt, polarity, strength, "
            "is_personal, origin, status, created_by_org_id, provenance, role_type, period_from, "
            "period_from_precision, period_to, period_to_precision, period_is_current)")

    statements = []
    for i in range(0, len(value_rows), chunk_size):
        chunk = value_rows[i:i + chunk_size]
        statements.append(f"INSERT INTO catalog_evidence {cols} VALUES\n" + ",\n".join(chunk) + ";\n")
    return statements


def generate_research_log_sql(rows, entity_id, chunk_size):
    value_rows = []
    for r in rows:
        row = "(" + ", ".join([
            sql_str(r["person_id"]),
            sql_str(entity_id),
            sql_enum(r["scope"], "research_scope"),
            sql_enum(r["result"], "research_result"),
            sql_jsonb(r.get("sources_checked") or []),
            sql_enum("system", "research_performed_by_kind"),
            "NULL",  # performed_by_user_id
            "NULL",  # requested_by_org_id
            sql_str(r.get("note") or None),
        ]) + ")"
        value_rows.append(row)

    cols = ("(person_id, entity_id, scope, result, sources_checked, performed_by_kind, "
            "performed_by_user_id, requested_by_org_id, notes)")
    statements = []
    for i in range(0, len(value_rows), chunk_size):
        chunk = value_rows[i:i + chunk_size]
        statements.append(f"INSERT INTO catalog_person_research_log {cols} VALUES\n" + ",\n".join(chunk) + ";\n")
    return statements


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--chunk-size", type=int, default=40)
    ap.add_argument("--exclude-person-id", action="append", default=[],
                     help="hold this person's evidence AND research_log rows back entirely; repeatable")
    ap.add_argument("--cross-check", default=None,
                     help="optional dry_run_report.json — warns (does not abort) if its totals disagree with the manifest")
    args = ap.parse_args()

    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    evidence_rows = manifest["evidence"]
    research_rows = manifest.get("research_log", [])
    entity_id = manifest["entity_id"]

    if args.cross_check:
        with open(args.cross_check, encoding="utf-8") as f:
            report = json.load(f)
        expected_evidence = report.get("totals", {}).get("evidence_rows")
        expected_research = report.get("totals", {}).get("research_log_rows")
        if expected_evidence is not None and expected_evidence != len(evidence_rows):
            print(f"WARNING: dry-run report says {expected_evidence} evidence rows, "
                  f"manifest has {len(evidence_rows)} — re-check both files before applying.")
        if expected_research is not None and expected_research != len(research_rows):
            print(f"WARNING: dry-run report says {expected_research} research_log rows, "
                  f"manifest has {len(research_rows)} — re-check both files before applying.")

    # Exclusion happens BEFORE validation, deliberately: holding a person
    # back (an unresolved identity question, e.g.) must not require their
    # data to already be clean this round — that is very often exactly why
    # they are held back in the first place.
    excluded = set(args.exclude_person_id)
    evidence_kept, evidence_held = lib.split_by_excluded_people(evidence_rows, excluded)
    research_kept, research_held = lib.split_by_excluded_people(research_rows, excluded)

    all_errors = []
    for r in evidence_kept:
        for e in lib.validate_evidence_row(r):
            all_errors.append(f"evidence '{r.get('title')}' ({r.get('person_key')}): {e}")
    for r in research_kept:
        for e in lib.validate_research_log_row(r):
            all_errors.append(f"research_log {r.get('person_key')}/{r.get('scope')}: {e}")
    if all_errors:
        print(f"ABORTED — {len(all_errors)} validation error(s), nothing written:")
        for e in all_errors:
            print(f"  - {e}")
        raise SystemExit(1)

    os.makedirs(args.out_dir, exist_ok=True)

    evidence_statements = generate_evidence_sql(evidence_kept, args.chunk_size)
    with open(os.path.join(args.out_dir, "import_evidence.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(evidence_statements))
    print(f"Wrote {len(evidence_kept)} evidence rows in {len(evidence_statements)} statement(s) -> import_evidence.sql")

    rl_statements = generate_research_log_sql(research_kept, entity_id, args.chunk_size)
    with open(os.path.join(args.out_dir, "import_research_log.sql"), "w", encoding="utf-8") as f:
        f.write("\n".join(rl_statements))
    print(f"Wrote {len(research_kept)} research_log rows in {len(rl_statements)} statement(s) -> import_research_log.sql")

    topics = [
        {"person_key": r.get("person_key"), "evidence_title": r.get("title"), **t}
        for r in evidence_kept for t in (r.get("topics") or [])
    ]
    with open(os.path.join(args.out_dir, "topics_pending_review.json"), "w", encoding="utf-8") as f:
        json.dump(topics, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(topics)} proposed topic tags (NOT inserted anywhere) -> topics_pending_review.json")

    if excluded:
        held_people = sorted({r.get("person_key") for r in evidence_held + research_held})
        print(f"Held back {len(evidence_held)} evidence row(s) + {len(research_held)} research_log row(s) "
              f"for excluded person(s): {', '.join(held_people)}")


if __name__ == "__main__":
    main()
