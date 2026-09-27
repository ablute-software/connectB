import lib


def test_content_hash_matches_production_formula():
    # Real row from production (catalog_evidence, Marco Neves / Portugal
    # Ventures), content_hash read directly from the table on 2026-09-27.
    assert lib.content_hash(
        "d1ee1ba4-7643-4a99-9d0d-2914fb15dfe0",
        "7cddf0fb-2ee6-49f0-9379-ba6cd8777e22",
        "https://www.portugalventures.pt/wp-content/uploads/2026/08/RGS2025_PortugalVentures_web.pdf",
        "Banco Totta & Açores — Analista de Crédito Grandes Empresas",
    ) == "3bb59fc1099da96cc3570f3df930344a"


def test_content_hash_null_excerpt_matches_production():
    assert lib.content_hash(
        "d1ee1ba4-7643-4a99-9d0d-2914fb15dfe0",
        "7cddf0fb-2ee6-49f0-9379-ba6cd8777e22",
        "https://www.portugalventures.pt/en/news/new-leadership-for-the-2025-2027-triennium/",
        None,
    ) == "21bcc41dff205bb77325c908c60c073a"


def test_content_hash_is_deterministic_and_url_sensitive():
    a = lib.content_hash("p1", "e1", "https://a.example", "text")
    b = lib.content_hash("p1", "e1", "https://a.example", "text")
    c = lib.content_hash("p1", "e1", "https://b.example", "text")
    assert a == b
    assert a != c


def _base_evidence_row(**overrides):
    row = {
        "person_id": "p1", "entity_id": "e1", "evidence_kind": "role_history",
        "title": "Some role", "url": "https://example.com",
        "role_type": "employment", "strength": 3,
        "period_from": None, "period_from_precision": None,
        "period_to": None, "period_to_precision": None,
    }
    row.update(overrides)
    return row


def test_validate_evidence_row_accepts_a_clean_row():
    assert lib.validate_evidence_row(_base_evidence_row()) == []


def test_validate_evidence_row_rejects_missing_required_field():
    row = _base_evidence_row(title=None)
    errors = lib.validate_evidence_row(row)
    assert any("title" in e for e in errors)


def test_validate_evidence_row_rejects_unknown_kind():
    row = _base_evidence_row(evidence_kind="not_a_real_kind")
    errors = lib.validate_evidence_row(row)
    assert any("evidence_kind" in e for e in errors)


def test_validate_evidence_row_rejects_unknown_role_type():
    row = _base_evidence_row(role_type="ceo")
    errors = lib.validate_evidence_row(row)
    assert any("role_type" in e for e in errors)


def test_validate_evidence_row_rejects_out_of_range_strength():
    row = _base_evidence_row(strength=7)
    errors = lib.validate_evidence_row(row)
    assert any("strength" in e for e in errors)


def test_validate_evidence_row_rejects_orphaned_period_precision():
    # A date with no precision, or a precision with no date, would violate
    # the real catalog_evidence_period_from_precision_pair constraint.
    row = _base_evidence_row(period_from="2020-01-01", period_from_precision=None)
    errors = lib.validate_evidence_row(row)
    assert any("period_from" in e for e in errors)

    row2 = _base_evidence_row(period_from=None, period_from_precision="year")
    errors2 = lib.validate_evidence_row(row2)
    assert any("period_from" in e for e in errors2)


def test_validate_evidence_row_accepts_paired_period_precision():
    row = _base_evidence_row(period_from="2020-01-01", period_from_precision="year")
    assert lib.validate_evidence_row(row) == []


def test_validate_evidence_row_rejects_end_date_with_current_true():
    row = _base_evidence_row(
        period_to="2024-01-01", period_to_precision="year", period_is_current=True,
    )
    errors = lib.validate_evidence_row(row)
    assert any("period_is_current" in e for e in errors)


def test_validate_evidence_row_accepts_end_date_with_current_none():
    # The far more common shape (education rows, mostly): a real end date
    # with no explicit period_is_current. Not an error — generate_sql.py's
    # normalize_period_is_current fills this in before it reaches SQL.
    row = _base_evidence_row(
        period_to="2024-01-01", period_to_precision="year", period_is_current=None,
    )
    assert lib.validate_evidence_row(row) == []


def test_normalize_period_is_current_fills_false_when_end_date_known():
    row = {"period_to": "2024-01-01", "period_is_current": None}
    assert lib.normalize_period_is_current(row)["period_is_current"] is False


def test_normalize_period_is_current_leaves_ongoing_role_untouched():
    row = {"period_to": None, "period_is_current": None}
    assert lib.normalize_period_is_current(row)["period_is_current"] is None


def test_normalize_period_is_current_does_not_mutate_the_original():
    row = {"period_to": "2024-01-01", "period_is_current": None}
    lib.normalize_period_is_current(row)
    assert row["period_is_current"] is None


def test_validate_research_log_row_accepts_clean_row():
    row = {"person_id": "p1", "scope": "career", "result": "found"}
    assert lib.validate_research_log_row(row) == []


def test_validate_research_log_row_rejects_unknown_scope():
    row = {"person_id": "p1", "scope": "hobbies", "result": "found"}
    errors = lib.validate_research_log_row(row)
    assert any("scope" in e for e in errors)


def test_validate_research_log_row_rejects_unknown_result():
    row = {"person_id": "p1", "scope": "career", "result": "maybe"}
    errors = lib.validate_research_log_row(row)
    assert any("result" in e for e in errors)


def test_split_by_excluded_people_holds_back_exactly_the_named_person():
    rows = [
        {"person_id": "keep-1", "x": 1},
        {"person_id": "hold-1", "x": 2},
        {"person_id": "keep-2", "x": 3},
        {"person_id": "hold-1", "x": 4},
    ]
    kept, held_back = lib.split_by_excluded_people(rows, {"hold-1"})
    assert [r["x"] for r in kept] == [1, 3]
    assert [r["x"] for r in held_back] == [2, 4]


def test_split_by_excluded_people_with_no_exclusions_keeps_everything():
    rows = [{"person_id": "a"}, {"person_id": "b"}]
    kept, held_back = lib.split_by_excluded_people(rows, set())
    assert kept == rows
    assert held_back == []
