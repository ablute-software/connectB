#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testes automatizados das regras do importador (pytest). Cobrem exactamente
os pontos que o Nuno pediu explicitamente:
  - ausência != not_found
  - found prevalece sobre ausência antiga
  - role_type (executivo/não-executivo/ambíguo nunca forçado)
  - datas ambíguas (nunca adivinhadas)
  - deduplicação (candidato<->candidato e candidato<->produção)
  - relevance_to_sherlock_demo nunca importado
  - role_conflict nunca importado como facto
  - nenhuma informação privada/não citável (o dicionário nunca gera um
    evidence_kind fora do enum aprovado; role_conflict e campos nunca-importar
    ficam de fora)

Correr com: pytest -v test_lib.py  (a partir desta pasta)
"""
import lib


# ---------------------------------------------------------------------------
# research_log: ausência != not_found; found prevalece sobre ausência antiga
# ---------------------------------------------------------------------------
def test_no_evidence_and_no_explicit_search_produces_no_row():
    """Sem evidência E sem prova explícita de pesquisa -> nenhuma linha (nunca not_found por omissão)."""
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=[], candidate_role_types=[],
        prod_kinds=[], declared_not_found_scopes=set(), has_topics=False,
    )
    scopes_with_rows = {s for s, _ in rows}
    assert "career" not in scopes_with_rows
    assert "education" not in scopes_with_rows
    assert rows == []


def test_explicit_not_found_declaration_produces_not_found_row():
    """Só quando o material fonte prova explicitamente que o scope foi pesquisado."""
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=[], candidate_role_types=[],
        prod_kinds=[], declared_not_found_scopes={"education"}, has_topics=False,
    )
    assert ("education", "not_found") in rows
    assert not any(s == "career" for s, _ in rows)


def test_found_prevails_over_old_not_found_declaration():
    """Evidência actual (candidata nova) vence sempre uma declaração antiga de ausência no mesmo scope."""
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=["education"], candidate_role_types=[None],
        prod_kinds=[], declared_not_found_scopes={"education"}, has_topics=False,
    )
    assert ("education", "found") in rows
    assert ("education", "not_found") not in rows


def test_production_evidence_also_counts_as_found():
    """Evidência já existente em produção (não só candidatos novos) conta como found."""
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=[], candidate_role_types=[],
        prod_kinds=["role_history"], declared_not_found_scopes=set(), has_topics=False,
    )
    assert ("career", "found") in rows


def test_board_advisory_role_history_goes_to_board_seats_scope_not_career():
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=["role_history"], candidate_role_types=["board_advisory"],
        prod_kinds=[], declared_not_found_scopes=set(), has_topics=False,
    )
    scopes_with_rows = dict(rows)
    assert scopes_with_rows.get("board_seats") == "found"
    assert "career" not in scopes_with_rows


def test_employment_role_history_goes_to_career_scope():
    rows = lib.reconcile_research_log_for_person(
        candidate_kinds=["role_history"], candidate_role_types=["employment"],
        prod_kinds=[], declared_not_found_scopes=set(), has_topics=False,
    )
    assert dict(rows).get("career") == "found"


# ---------------------------------------------------------------------------
# role_type: conservador, nunca forçado
# ---------------------------------------------------------------------------
def test_executive_title_classifies_as_employment():
    rtype, reason = lib.classify_role_type("CEO")
    assert rtype == "employment"
    assert reason is None


def test_non_executive_classifies_as_board_advisory():
    rtype, reason = lib.classify_role_type("Administrador não executivo")
    assert rtype == "board_advisory"


def test_supervisory_board_classifies_as_board_advisory():
    rtype, reason = lib.classify_role_type("Conselho Fiscal")
    assert rtype == "board_advisory"


def test_ambiguous_board_title_is_never_forced():
    """'Vogal do Conselho de Administração' sem qualificador -> ambiguous, nunca employment/board_advisory forçado."""
    rtype, reason = lib.classify_role_type("Vogal do Conselho de Administração")
    assert rtype == "ambiguous"
    assert reason is not None


def test_compound_multi_role_field_is_ambiguous_not_forced():
    rtype, reason = lib.classify_role_type("Administrador; Diretor; Presidente de outra empresa")
    assert rtype == "ambiguous"


def test_empty_title_is_ambiguous():
    rtype, reason = lib.classify_role_type("")
    assert rtype == "ambiguous"


# ---------------------------------------------------------------------------
# Datas ambíguas: nunca adivinhadas
# ---------------------------------------------------------------------------
def test_full_date_parses_exactly():
    d, extra = lib.normalize_published_at("2024-03-15")
    assert d == "2024-03-15"
    assert extra == {}


def test_month_precision_date_gets_explicit_flag():
    d, extra = lib.normalize_published_at("2024-03")
    assert d == "2024-03-01"
    assert extra["date_parse_status"] == "month_precision_day_assumed_01"


def test_year_only_date_gets_explicit_flag():
    d, extra = lib.normalize_published_at("2024")
    assert d == "2024-01-01"
    assert extra["date_parse_status"] == "year_precision_day_month_assumed_01_01"


def test_date_range_is_never_guessed():
    d, extra = lib.normalize_published_at("2024/current")
    assert d is None
    assert extra["date_parse_status"] == "ambiguous_not_parsed"
    assert extra["raw_publication_date"] == "2024/current"


def test_relative_or_undated_text_is_never_guessed():
    for raw in ["current", "historical", "undated", "undated (c.2020)"]:
        d, extra = lib.normalize_published_at(raw)
        assert d is None, f"{raw!r} should never produce a guessed date"


def test_period_from_to_never_guesses_unparseable_string():
    f_date, f_prec, is_cur, t_date, t_prec = lib.parse_period("sometime in the 2010s", "present")
    assert f_date is None
    assert f_prec == "approximate"
    assert is_cur is True
    assert t_date is None and t_prec is None


def test_orphaned_precision_dropped_when_date_absent():
    date_v, prec_v, dropped = lib.drop_orphaned_precision(None, "approximate")
    assert date_v is None
    assert prec_v is None
    assert dropped == "approximate"


def test_precision_kept_when_date_present():
    date_v, prec_v, dropped = lib.drop_orphaned_precision("2024-01-01", "year")
    assert date_v == "2024-01-01"
    assert prec_v == "year"
    assert dropped is None


# ---------------------------------------------------------------------------
# Deduplicação
# ---------------------------------------------------------------------------
def test_dedup_key_same_person_same_url_collides():
    k1 = lib.dedup_key("Marco Neves", "bio", "https://example.com/bio/", "T1", "E1")
    k2 = lib.dedup_key("Marco Neves", "bio", "https://www.example.com/bio", "T2", "E2")
    assert k1 == k2  # normalização de URL (www./esquema/barra final) faz colidir


def test_dedup_key_different_person_same_url_does_not_collide():
    k1 = lib.dedup_key("Marco Neves", "bio", "https://example.com/bio", "T", "E")
    k2 = lib.dedup_key("Ana Terra", "bio", "https://example.com/bio", "T", "E")
    assert k1 != k2


def test_dedup_vs_production_by_person_and_normalized_url():
    existing = {"person-123": {"example.com/press"}}
    assert lib.is_duplicate_of_production("person-123", "https://www.example.com/press/", existing) is True
    assert lib.is_duplicate_of_production("person-123", "https://example.com/other", existing) is False
    assert lib.is_duplicate_of_production("person-999", "https://example.com/press", existing) is False


def test_dedup_vs_production_requires_url_present():
    assert lib.is_duplicate_of_production("person-123", None, {"person-123": {"x"}}) is False


# ---------------------------------------------------------------------------
# Exclusões obrigatórias
# ---------------------------------------------------------------------------
def test_relevance_to_sherlock_demo_is_in_never_import_fields():
    assert "relevance_to_sherlock_demo" in lib.NEVER_IMPORT_FIELDS


def test_role_conflict_is_never_importable_as_fact():
    kind, role_type, importable, reason = lib.resolve_evidence_kind("role_conflict")
    assert importable is False
    assert kind is None
    assert "role_conflict" in reason


def test_unmapped_source_type_is_excluded_not_guessed():
    kind, role_type, importable, reason = lib.resolve_evidence_kind("algum_tipo_novo_desconhecido")
    assert importable is False
    assert kind is None


# ---------------------------------------------------------------------------
# source_type -> evidence_kind: mapeamentos directos e condicionais
# ---------------------------------------------------------------------------
def test_board_role_maps_to_role_history_board_advisory():
    kind, role_type, importable, reason = lib.resolve_evidence_kind("board_role")
    assert kind == "role_history"
    assert role_type == "board_advisory"
    assert importable is True


def test_leadership_announcement_first_party_is_press_release():
    kind, _, importable, _ = lib.resolve_evidence_kind("leadership_announcement", source_first_party="true")
    assert kind == "press_release"
    assert importable is True


def test_leadership_announcement_third_party_is_article_about():
    kind, _, importable, _ = lib.resolve_evidence_kind("leadership_announcement", source_first_party="false")
    assert kind == "article_about"


def test_portfolio_pitch_without_companies_falls_back_to_talk_event():
    kind, _, importable, _ = lib.resolve_evidence_kind("portfolio_pitch", companies_mentioned="")
    assert kind == "talk_event"


def test_portfolio_pitch_with_companies_is_portfolio_relationship():
    kind, _, importable, _ = lib.resolve_evidence_kind("portfolio_pitch", companies_mentioned="Acme Startup")
    assert kind == "portfolio_relationship"


def test_direct_map_covers_interview_and_podcast():
    assert lib.resolve_evidence_kind("interview")[0] == "interview"
    assert lib.resolve_evidence_kind("podcast")[0] == "podcast"


# ---------------------------------------------------------------------------
# content_hash: excerpt de desambiguação nunca inventa conteúdo, só reusa o
# title real da própria linha.
# ---------------------------------------------------------------------------
def test_excerpt_backfilled_from_title_when_empty():
    final, flag = lib.disambiguate_excerpt("Empresa X — CEO", "")
    assert final == "Empresa X — CEO"
    assert flag == "excerpt_backfilled_from_title"


def test_excerpt_disambiguated_when_boilerplate_shared():
    final, flag = lib.disambiguate_excerpt("Empresa Y — Board", "Nota genérica partilhada")
    assert final == "Nota genérica partilhada — Empresa Y — Board"
    assert flag == "excerpt_disambiguated_with_title"


def test_excerpt_untouched_when_title_already_present():
    final, flag = lib.disambiguate_excerpt("Empresa Z", "Empresa Z fez isto e aquilo")
    assert final == "Empresa Z fez isto e aquilo"
    assert flag is None


# ---------------------------------------------------------------------------
# relation_kind / current para portfolio_relationship
# ---------------------------------------------------------------------------
def test_relation_kind_direct_keyword_is_professional_experience():
    assert lib.classify_relation_kind("Investment Manager responsável pelo investimento") == "professional_experience"


def test_relation_kind_unrelated_text_is_indirect_responsibility():
    assert lib.classify_relation_kind("Menção informal em evento") == "indirect_responsibility"


def test_classify_current_from_estado():
    assert lib.classify_current("CURRENT") is True
    assert lib.classify_current("HISTORICAL") is False
    assert lib.classify_current("") is None
