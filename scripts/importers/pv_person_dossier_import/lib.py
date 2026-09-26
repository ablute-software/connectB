#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Funções puras do importador de dossiê de pessoa (Portugal Ventures e futuros
fundos). Sem I/O — só regras. build_candidates.py e generate_sql.py importam
daqui; test_lib.py testa isto isoladamente, sem precisar de Excel/JSON reais.

Duas regras absolutas do Nuno, corrigidas aqui (bugs originais do importador):
  1. research_log nunca fabrica found/not_found para um scope sem evidência
     real; not_public só com sinal explícito de não-publicidade numa fonte
     real; evidência actual vence sempre uma declaração antiga de ausência.
  2. role_type é conservador: executivo/operacional -> employment;
     não-executivo/supervisão/consultivo -> board_advisory; não classificável
     com confiança -> nunca forçar role_history, devolver kind='other' sem
     role_type.
"""
import re
from collections import defaultdict

# ---------------------------------------------------------------------------
# source_type -> evidence_kind (dicionário do Nuno, verbatim + regras condicionais)
# ---------------------------------------------------------------------------
DIRECT_MAP = {
    "press_release_quote": "statement",
    "press_release": "press_release",
    "interview": "interview",
    "podcast": "podcast",
    "talk_event": "talk_event",
    "article_authored": "article_authored",
    "article_about": "article_about",
    "bio": "bio",
    "social_post": "social_post",
    "event": "talk_event",
    "investment": "investment",
    "fund_announcement": "fund_announcement",
    "photo": "photo",
    "portfolio_assignment": "portfolio_relationship",
    "panel": "talk_event",
    "professional_profile": "bio",
    "jury": "talk_event",
    "workshop": "talk_event",
    "feedback_committee": "talk_event",
    "LinkedIn_post": "social_post",
    "portfolio_visit": "portfolio_relationship",
    "conference": "talk_event",
    "jury_panel": "talk_event",
    "article_interview": "interview",
    "webinar": "talk_event",
    "judging_panel": "talk_event",
    "moderator": "talk_event",
    "speaker_profile": "bio",
    "ecosystem_meeting": "talk_event",
    "accelerator_panel": "talk_event",
    "mentoring_session": "talk_event",
    "portfolio_outcome": "portfolio_relationship",
    "portfolio_outcome_testimonial": "portfolio_relationship",
}

# Campos que nunca podem ser importados como facto de evidência, mesmo que
# apareçam numa linha fonte candidata a outra coisa. Exclusão obrigatória.
NEVER_IMPORT_FIELDS = {"relevance_to_sherlock_demo"}


def resolve_evidence_kind(source_type, source_first_party=None, companies_mentioned=None):
    """
    Mapeia um source_type do Excel/showcase para (evidence_kind, role_type,
    import_as_evidence: bool, reason_if_excluded).

    role_conflict nunca é importado como facto — fica só como nota de
    auditoria/curadoria (regra explícita do Nuno).
    """
    st = str(source_type or "").strip()
    if st in DIRECT_MAP:
        return DIRECT_MAP[st], None, True, None
    if st == "board_role":
        return "role_history", "board_advisory", True, None
    if st == "leadership_announcement":
        first_party = str(source_first_party or "").strip().lower() in ("true", "sim", "yes", "1")
        return ("press_release" if first_party else "article_about"), None, True, None
    if st == "portfolio_pitch":
        companies = str(companies_mentioned or "").strip()
        linked = companies not in ("", "nan", "none")
        return ("portfolio_relationship" if linked else "talk_event"), None, True, None
    if st == "founder_testimonial":
        companies = str(companies_mentioned or "").strip()
        proves_relation = companies not in ("", "nan", "none")
        return ("portfolio_relationship" if proves_relation else "article_about"), None, True, None
    if st == "role_conflict":
        return None, None, False, "role_conflict — não importado como facto; conservado apenas como nota de auditoria/conflito"
    return None, None, False, f"source_type '{st}' sem entrada no dicionário — não deveria acontecer nesta versão"


# ---------------------------------------------------------------------------
# role_type — classificador conservador, aplicado uniformemente a todo
# candidato de role_history (carreira e boards). Nunca força role_history:
# devolve "ambiguous" quando não há confiança, e quem chama tem de tratar
# isso como kind='other' sem role_type (nunca role_history).
# ---------------------------------------------------------------------------
NON_EXEC_PATTERNS = ["não executivo", "nao executivo", "non-executive", "non executive"]
OVERSIGHT_BOARD_PATTERNS = ["conselho fiscal", "supervisory board", "advisory board", "conselho consultivo"]
GENERAL_SUPERVISORY_PATTERNS = ["conselho geral e de supervisão", "conselho geral"]
EXECUTIVE_SIGNALS = ["executivo", "executiva", "ceo", "diretor", "director", "gestor", "gestora", "analista", "vice-presidente executiv"]
AMBIGUOUS_BOARD_PATTERNS = ["conselho de administração", "vogal", "board member"]


def classify_role_type(title_text):
    """Returns (role_type_or_'ambiguous', reason_or_None)."""
    t = str(title_text).lower()
    if ";" in str(title_text) and str(title_text).count(";") >= 1 and any(
        k in t for k in ["administrador", "diretor", "vogal", "presidente"]
    ):
        return "ambiguous", "entrada composta mistura vários cargos/empresas no mesmo campo de texto"
    if any(p in t for p in NON_EXEC_PATTERNS):
        return "board_advisory", None
    if any(p in t for p in OVERSIGHT_BOARD_PATTERNS):
        return "board_advisory", None
    if any(p in t for p in GENERAL_SUPERVISORY_PATTERNS):
        return "board_advisory", None
    if any(p in t for p in EXECUTIVE_SIGNALS):
        return "employment", None
    if any(p in t for p in AMBIGUOUS_BOARD_PATTERNS):
        return "ambiguous", "\"conselho de administração\"/\"vogal\" sem qualificador executivo/não-executivo — não classificável com confiança"
    if not t.strip():
        return "ambiguous", "título vazio"
    return "employment", None  # default: título operacional sem vocabulário de board/supervisão


# ---------------------------------------------------------------------------
# Datas — nunca adivinhar. Ranges, "current"/"historical" textual, ou
# qualquer string não-reconhecida -> (None, "approximate"/None), nunca uma
# data exacta inventada.
# ---------------------------------------------------------------------------
def parse_period(from_s, to_s):
    """From 'YYYY-MM' / 'YYYY' / 'present' / vazio -> (from_date, from_precision, is_current, to_date, to_precision)."""

    def parse_one(s):
        if not s:
            return None, None
        s = str(s).strip().lower()
        if s in ("present", "atual", "current", ""):
            return None, None
        m = re.match(r"^(\d{4})-(\d{2})$", s)
        if m:
            return f"{m.group(1)}-{m.group(2)}-01", "month"
        m = re.match(r"^(\d{4})$", s)
        if m:
            return f"{m.group(1)}-01-01", "year"
        return None, "approximate"  # string não reconhecida -> guarda só o marcador, nunca uma data

    from_date, from_prec = parse_one(from_s)
    to_raw = str(to_s).strip().lower() if to_s else ""
    is_current = to_raw in ("present", "atual", "current")
    to_date, to_prec = (None, None) if is_current else parse_one(to_s)
    return from_date, from_prec, is_current, to_date, to_prec


def normalize_published_at(raw):
    """Returns (date_str_or_None, extra_provenance_dict). Nunca adivinha ranges/valores relativos."""
    if not raw:
        return None, {}
    s = str(raw).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return s, {}
    m = re.match(r"^(\d{4})-(\d{2})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-01", {"raw_publication_date": s, "date_parse_status": "month_precision_day_assumed_01"}
    m = re.match(r"^(\d{4})$", s)
    if m:
        return f"{m.group(1)}-01-01", {"raw_publication_date": s, "date_parse_status": "year_precision_day_month_assumed_01_01"}
    # ranges, "current", "historical", "undated", "undated (c.2020)", "2024/current", etc. -> nunca adivinhar
    return None, {"raw_publication_date": s, "date_parse_status": "ambiguous_not_parsed"}


# ---------------------------------------------------------------------------
# Deduplicação
# ---------------------------------------------------------------------------
def norm_url(u):
    if u is None:
        return None
    s = str(u).strip().lower()
    s = re.sub(r"^https?://(www\.)?", "", s)
    s = s.rstrip("/")
    return s or None


def norm_text(t, n=60):
    s = re.sub(r"\s+", " ", str(t)).strip().lower()
    return s[:n]


def dedup_key(person, kind, url, title, excerpt):
    """Chave determinística usada para deduplicar candidatos entre si (Excel <-> showcase)."""
    u = norm_url(url)
    if u:
        return (person, u)
    return (person, kind, norm_text((title or "") + (excerpt or "")))


def is_duplicate_of_production(person_id, url, existing_by_person_url):
    """
    Regra de deduplicação vs. catalog_evidence já em produção: chave
    determinística (person_id, url_normalizado). Quando o candidato e uma
    linha já existente em produção partilham essa chave para a mesma pessoa,
    o candidato é descartado (não recriado).
    """
    u = norm_url(url)
    if not (person_id and u):
        return False
    return u in existing_by_person_url.get(person_id, set())


# ---------------------------------------------------------------------------
# research_log — regras de reconciliação (bug 1, corrigido)
# ---------------------------------------------------------------------------
SCOPE_KEYWORDS = {
    "career": ["employer", "empregador", "carreira", "prior employer"],
    "education": ["education", "formação", "degree"],
    "board_seats": ["board"],
    "statements": ["quote", "statement", "declaraç", "opinion"],
    "interviews": ["interview", "entrevista"],
    "articles": ["article", "artigo", "opinion article"],
    "podcasts": ["podcast"],
    "events": ["panel", "conference", "appearance", "talk", "event"],
    "topics": ["topic", "tema"],
    "portfolio": ["portfolio"],
    "personal_signals": ["personal", "pessoal"],
}

CONTENT_KIND_TO_SCOPE = {
    "statement": "statements", "press_release": "statements", "social_post": "statements",
    "interview": "interviews", "article_authored": "articles", "article_about": "articles",
    "podcast": "podcasts", "talk_event": "events", "bio": None,
    "portfolio_relationship": "portfolio", "role_history": "career", "education": "education",
    "investment": "portfolio", "fund_announcement": "portfolio", "photo": None, "other": None,
}


def scopes_from_not_found_text(text):
    t = str(text).lower()
    matched = set()
    for scope, kws in SCOPE_KEYWORDS.items():
        if any(kw in t for kw in kws):
            matched.add(scope)
    return matched


def reconcile_research_log_for_person(candidate_kinds, candidate_role_types, prod_kinds, declared_not_found_scopes, has_topics):
    """
    Regra central (bug 1 corrigido): para cada scope,
      - se há evidência actual (candidata nova OU já em produção) nesse scope -> 'found'
        (evidência actual vence SEMPRE uma declaração antiga de ausência);
      - senão, se o material fonte declarou explicitamente que este scope foi
        pesquisado e nada foi encontrado -> 'not_found';
      - senão (sem evidência E sem prova explícita de pesquisa) -> NENHUMA
        linha (nunca inventar not_found por omissão; not_public só é usado por quem
        chama quando uma fonte real diz explicitamente que o dado não é público).

    candidate_kinds: lista de evidence_kind dos candidatos novos desta pessoa.
    candidate_role_types: lista paralela de role_type (ou None) dos candidatos
      cujo kind é 'role_history', para desviar boards para o scope 'board_seats'.
    prod_kinds: lista de evidence_kind já existentes em produção para esta pessoa.
    declared_not_found_scopes: set de scopes com prova explícita de pesquisa
      sem resultado (ex.: um "not_found" declarado no material fonte).
    has_topics: bool — a pessoa tem temas/tópicos identificados.

    Returns: list of (scope, result) pairs.
    """
    scope_has_evidence = defaultdict(bool)
    for kind, rtype in zip(candidate_kinds, candidate_role_types):
        sc = CONTENT_KIND_TO_SCOPE.get(kind)
        if kind == "role_history" and rtype == "board_advisory":
            sc = "board_seats"
        if sc:
            scope_has_evidence[sc] = True
    for kind in prod_kinds:
        sc = CONTENT_KIND_TO_SCOPE.get(kind)
        if sc:
            scope_has_evidence[sc] = True
    if has_topics:
        scope_has_evidence["topics"] = True

    rows = []
    for scope in SCOPE_KEYWORDS:
        if scope_has_evidence[scope]:
            rows.append((scope, "found"))
        elif scope in declared_not_found_scopes:
            rows.append((scope, "not_found"))
        # senão: nenhuma linha
    return rows


# ---------------------------------------------------------------------------
# relation_kind para portfolio_relationship (RELACOES_PESSOA_PORTFOLIO)
# ---------------------------------------------------------------------------
DIRECT_KEYWORDS = ["investment manager", "gestor de investimento", "responsible for", "responsável por", "lead", "líder"]
PROFESSIONAL_KEYWORDS = ["board", "conselho", "advisor", "administrador", "director", "diretor", "manager", "gestor"]


def classify_relation_kind(tipo_relacao):
    t = str(tipo_relacao).lower()
    if any(k in t for k in DIRECT_KEYWORDS) or any(k in t for k in PROFESSIONAL_KEYWORDS):
        return "professional_experience"
    return "indirect_responsibility"


def classify_current(estado):
    s = str(estado).strip().upper()
    if s == "CURRENT":
        return True
    if s == "HISTORICAL":
        return False
    return None


# ---------------------------------------------------------------------------
# content_hash de produção = md5(person_id|entity_id|url|md5(excerpt)) — não
# inclui title/kind. Candidatos sem excerpt próprio (usam só o title) ou com
# excerpt partilhado/boilerplate colidiriam entre si mesmo sendo factos
# distintos. Corrigido sem inventar conteúdo: backfill/disambiguação a partir
# do próprio title real da linha.
# ---------------------------------------------------------------------------
def disambiguate_excerpt(title, excerpt):
    """Returns (final_excerpt, provenance_flag_or_None)."""
    orig = excerpt or ""
    title = title or ""
    if not orig:
        return title, "excerpt_backfilled_from_title"
    if title not in orig:
        return orig + " — " + title, "excerpt_disambiguated_with_title"
    return orig, None


def drop_orphaned_precision(date_value, precision_value):
    """
    catalog_evidence_period_from_precision_pair / _to_precision_pair exigem
    (data IS NULL) == (precisão IS NULL). Nunca adivinhamos uma data, por
    isso, quando a data está ausente, a etiqueta de precisão órfã
    ('approximate' associada a uma data não confirmada) é largada em vez de
    violar a constraint — fica só como facto em provenance, nunca como campo
    estruturado.
    Returns (date_value, precision_value_or_None, dropped_precision_or_None).
    """
    if date_value is None and precision_value is not None:
        return None, None, precision_value
    return date_value, precision_value, None
