#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Pure functions for the reusable catalog-dossier importer.

Unlike pv_person_dossier_import (which classified raw, messy research into
evidence_kind/role_type/period from scratch), this importer's input is
already a *validated manifest*: a research process elsewhere produced
manifest.json (the real rows) plus a dry_run_report.json (the human-readable
review of the same rows, with totals) and the classification/QA work — kind,
role_type, period precision, excerpt disambiguation — already happened
upstream, one row at a time, with an explicit qa_note per row. This module's
job is narrower: validate that the manifest is internally consistent and
matches the enum/constraint shape production actually enforces, compute the
same content_hash production uses for its own dedup, and let a caller hold
back specific people (an unresolved identity question, say) before anything
is written.

Enum values below were read directly from production (pg_enum) on
2026-09-27, the same day this file was written — not guessed from a
migration file, since a migration can lag behind what's actually deployed.
"""
import hashlib

EVIDENCE_KINDS = {
    "bio", "interview", "podcast", "talk_event", "article_authored",
    "article_about", "statement", "press_release", "investment",
    "fund_announcement", "social_post", "photo", "other", "role_history",
    "education", "portfolio_relationship",
}
ROLE_TYPES = {"employment", "board_advisory"}
DATE_PRECISIONS = {"exact_day", "month", "year", "approximate"}
RESEARCH_SCOPES = {
    "career", "education", "board_seats", "statements", "interviews",
    "articles", "podcasts", "events", "topics", "portfolio", "personal_signals",
}
RESEARCH_RESULTS = {"found", "not_found", "not_public"}


def content_hash(person_id: str, entity_id: str, url: str, excerpt: str | None) -> str:
    """Reproduces production's own identity rule exactly (verified against
    real catalog_evidence rows, 2026-09-27):
        md5(person_id || '|' || entity_id || '|' || url || '|' || md5(excerpt))
    entity_id is coalesced to '' the same way COALESCE(entity_id::text, '')
    does in SQL — never skip this even though every row in practice carries
    a real entity_id, since a NULL entity_id is a legitimate person-level-
    only evidence row elsewhere in this schema.

    catalog_evidence.content_hash is a GENERATED column — Postgres computes
    it itself on INSERT, and generate_sql.py must never supply a value for
    it (a generated column rejects any explicit value, even a correct one).
    This function exists purely so a caller can pre-check a manifest row
    against production's existing hashes for a real duplicate, the same
    dedup PV's own importer performs — not to populate the column.
    """
    entity_part = entity_id or ""
    excerpt_part = excerpt or ""
    excerpt_hash = hashlib.md5(excerpt_part.encode("utf-8")).hexdigest()
    raw = f"{person_id}|{entity_part}|{url}|{excerpt_hash}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()


def validate_evidence_row(row: dict) -> list[str]:
    """Returns a list of validation error strings; empty means the row is
    safe to turn into SQL. Never raises — the caller decides whether one bad
    row aborts the whole batch or is just reported.
    """
    errors = []
    for field in ("person_id", "entity_id", "evidence_kind", "title", "url"):
        if not row.get(field):
            errors.append(f"missing required field '{field}'")
    kind = row.get("evidence_kind")
    if kind is not None and kind not in EVIDENCE_KINDS:
        errors.append(f"evidence_kind '{kind}' is not a known production enum value")
    role_type = row.get("role_type")
    if role_type is not None and role_type not in ROLE_TYPES:
        errors.append(f"role_type '{role_type}' is not a known production enum value")
    strength = row.get("strength")
    if strength is not None and not (isinstance(strength, int) and 1 <= strength <= 4):
        errors.append(f"strength {strength!r} must be an integer 1-4")
    # catalog_evidence_period_from_precision_pair / _to_precision_pair: a date
    # and its precision must be both present or both absent. Never guess a
    # precision to satisfy the constraint — a mismatch here means the
    # manifest itself is wrong and should be fixed upstream, not patched here.
    for date_field, precision_field in (
        ("period_from", "period_from_precision"), ("period_to", "period_to_precision"),
    ):
        date_val = row.get(date_field)
        precision_val = row.get(precision_field)
        if (date_val is None) != (precision_val is None):
            errors.append(f"{date_field}/{precision_field} must both be set or both be null")
        if precision_val is not None and precision_val not in DATE_PRECISIONS:
            errors.append(f"{precision_field} '{precision_val}' is not a known production enum value")
    # catalog_evidence_period_end_implies_not_current: a row with a known end
    # date cannot also claim to be current — that is a real contradiction in
    # the source data, not something to silently coerce. A missing
    # period_is_current alongside a period_to (the far more common case) is
    # NOT an error here: it is a logical entailment (an end date is known ⇒
    # not current) that generate_sql.py fills in on the way to SQL, since
    # leaving it None would violate the same constraint for no reason.
    if row.get("period_to") is not None and row.get("period_is_current") is True:
        errors.append("period_to is set but period_is_current is true — a known end date cannot also be current")
    return errors


def validate_research_log_row(row: dict) -> list[str]:
    errors = []
    for field in ("person_id", "scope", "result"):
        if not row.get(field):
            errors.append(f"missing required field '{field}'")
    scope = row.get("scope")
    if scope is not None and scope not in RESEARCH_SCOPES:
        errors.append(f"scope '{scope}' is not a known production enum value")
    result = row.get("result")
    if result is not None and result not in RESEARCH_RESULTS:
        errors.append(f"result '{result}' is not a known production enum value")
    return errors


def normalize_period_is_current(row: dict) -> dict:
    """Returns a copy of `row` with period_is_current filled in when it can
    be entailed with certainty: a known period_to means the role/education
    is definitely not current, so a None here becomes False. Never touches
    a row where period_to is absent (an ongoing role's period_is_current is
    a real fact the manifest must state, not something this can infer), and
    never touches an explicit True (validate_evidence_row already rejects
    that combination as a contradiction, before this ever runs).
    """
    if row.get("period_to") is not None and row.get("period_is_current") is None:
        row = dict(row)
        row["period_is_current"] = False
    return row


def split_by_excluded_people(rows: list[dict], excluded_person_ids: set[str]) -> tuple[list[dict], list[dict]]:
    """Splits any list of rows that carry a person_id into (kept, held_back).
    Used identically for evidence rows and research_log rows — both shapes
    carry person_id, and an excluded person must be held back from both
    tables together, never one without the other.
    """
    kept, held_back = [], []
    for row in rows:
        (held_back if row.get("person_id") in excluded_person_ids else kept).append(row)
    return kept, held_back
