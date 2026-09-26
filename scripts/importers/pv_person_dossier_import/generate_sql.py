#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Passo 2 do importador: lê candidates.json + research_log_rows.json +
person_id_map.json (produzidos por build_candidates.py) e escreve SQL
INSERT em chunks. NÃO EXECUTA NADA NA BASE DE DADOS — escreve ficheiros .sql
para serem corridos manualmente (via mcp__Supabase__execute_sql, psql, ou
supabase db) por quem tem autorização/acesso à produção. Ver README.md,
secção "Como executar a importação real".

Uso:
    python3 generate_sql.py --in-dir /caminho/saida --entity-id <uuid> \\
        --out-dir /caminho/sql --chunk-size 40

Regra de identidade (content_hash de produção):
  content_hash = md5(person_id || '|' || entity_id || '|' || url || '|' ||
                      md5(excerpt))
  — NÃO inclui title nem kind. Um candidato sem excerpt próprio (usa só o
  title) ou com excerpt partilhado/boilerplate colidiria com outro candidato
  genuinamente distinto da mesma pessoa. Corrigido por disambiguate_excerpt()
  em lib.py: nunca inventa conteúdo, só reusa o title real dessa linha.

Regra das constraints de precisão de data:
  catalog_evidence_period_from_precision_pair / _to_precision_pair exigem
  (data IS NULL) == (precisão IS NULL). Nunca adivinhamos uma data; quando a
  data está ausente, a etiqueta de precisão órfã é largada (drop_orphaned_precision
  em lib.py) em vez de violar a constraint.
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


def normalize_published_at_field(c):
    pub_date, pub_extra = lib.normalize_published_at(c.get("published_at"))
    if pub_extra:
        c["provenance"] = dict(c.get("provenance") or {})
        c["provenance"].update(pub_extra)
    return pub_date


def fix_precision_pairs(c):
    pf, pfp, dropped_f = lib.drop_orphaned_precision(c.get("period_from"), c.get("period_from_precision"))
    c["period_from"], c["period_from_precision"] = pf, pfp
    if dropped_f:
        c["provenance"] = dict(c.get("provenance") or {})
        c["provenance"]["period_from_precision_dropped"] = dropped_f

    pt, ptp, dropped_t = lib.drop_orphaned_precision(c.get("period_to"), c.get("period_to_precision"))
    c["period_to"], c["period_to_precision"] = pt, ptp
    if dropped_t:
        c["provenance"] = dict(c.get("provenance") or {})
        c["provenance"]["period_to_precision_dropped"] = dropped_t


def fix_excerpt(c):
    final_excerpt, flag = lib.disambiguate_excerpt(c.get("title"), c.get("excerpt"))
    c["excerpt"] = final_excerpt
    if flag:
        c["provenance"] = dict(c.get("provenance") or {})
        c["provenance"][flag] = True


def member_page_for(showcase_people, person_name, fallback_url):
    sp = showcase_people.get(person_name)
    if sp and sp.get("member_page") and not sp.get("member_page_is_placeholder", False):
        return sp["member_page"]
    return fallback_url


def generate_evidence_sql(candidates, entity_id, chunk_size, fallback_url, showcase_people=None):
    showcase_people = showcase_people or {}
    value_rows = []
    for c in candidates:
        c = dict(c)
        c["provenance"] = dict(c.get("provenance") or {})
        fix_precision_pairs(c)
        pub_date = normalize_published_at_field(c)
        fix_excerpt(c)

        url = c.get("url")
        if not url:
            url = member_page_for(showcase_people, c["person"], fallback_url)
            c["provenance"]["url_is_fallback"] = True
            c["provenance"]["url_fallback_reason"] = "sem URL específico na fonte para este item; usado a página institucional pública como âncora"
        if c.get("note"):
            c["provenance"]["note"] = c["note"]

        strength = 3 if c.get("provenance_source") in ("showcase_structured", "relacoes_pessoa_portfolio_curated") else 2

        row = "(" + ", ".join([
            sql_str(c["person_id"]),
            sql_str(entity_id),
            sql_enum(c["kind"], "evidence_kind"),
            sql_str((c.get("title") or "")[:500]),
            sql_str(url),
            sql_date(pub_date),
            sql_str((c.get("excerpt") or "")[:600] or None),
            sql_enum("neutral", "evidence_polarity"),
            str(strength),
            "false",
            sql_enum("import", "evidence_origin"),
            sql_enum("found", "evidence_status"),
            "NULL",  # created_by_org_id
            sql_jsonb(c["provenance"]),
            sql_enum(c.get("role_type"), "role_type_kind"),
            sql_date(c.get("period_from")),
            sql_enum(c.get("period_from_precision"), "date_precision"),
            sql_date(c.get("period_to")),
            sql_enum(c.get("period_to_precision"), "date_precision"),
            sql_bool(c.get("period_is_current")),
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


def generate_research_log_sql(research_rows, person_id_map, entity_id, chunk_size, import_label):
    rl_value_rows = []
    for r in research_rows:
        pid = person_id_map[r["person"]]
        scope = r["scope"]
        result = r["result"]
        sources_checked = [f"{import_label}:{r['person']}:{scope}"] if result != "found" else []
        row = "(" + ", ".join([
            sql_str(pid),
            sql_str(entity_id),
            sql_enum(scope, "research_scope"),
            sql_enum(result, "research_result"),
            sql_jsonb(sources_checked),
            sql_enum("system", "research_performed_by_kind"),
            "NULL",  # performed_by_user_id
            "NULL",  # requested_by_org_id
            sql_str(f"Importação {import_label} — evidência actual > declaração antiga de ausência."),
        ]) + ")"
        rl_value_rows.append(row)

    rl_cols = ("(person_id, entity_id, scope, result, sources_checked, performed_by_kind, "
               "performed_by_user_id, requested_by_org_id, notes)")
    statements = []
    for i in range(0, len(rl_value_rows), chunk_size):
        chunk = rl_value_rows[i:i + chunk_size]
        statements.append(f"INSERT INTO catalog_person_research_log {rl_cols} VALUES\n" + ",\n".join(chunk) + ";\n")
    return statements


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--in-dir", required=True, help="pasta com candidates.json/research_log_rows.json/person_id_map.json")
    ap.add_argument("--entity-id", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--chunk-size", type=int, default=40)
    ap.add_argument("--fallback-url", default=None, help="URL institucional pública a usar quando um candidato não tem URL próprio")
    ap.add_argument("--showcase-json", default=None, help="opcional: para preferir o member_page de cada pessoa como fallback de URL")
    ap.add_argument("--import-label", default="importacao", help="rótulo curto usado em sources_checked/notes do research_log")
    args = ap.parse_args()

    with open(os.path.join(args.in_dir, "candidates.json")) as f:
        candidates = json.load(f)
    with open(os.path.join(args.in_dir, "research_log_rows.json")) as f:
        research_rows = json.load(f)
    with open(os.path.join(args.in_dir, "person_id_map.json")) as f:
        person_id_map = json.load(f)

    showcase_people = {}
    if args.showcase_json:
        with open(args.showcase_json) as f:
            showcase = json.load(f)
        showcase_people = {p["display_name"]: p for p in showcase["people"]}

    os.makedirs(args.out_dir, exist_ok=True)

    evidence_statements = generate_evidence_sql(
        candidates, args.entity_id, args.chunk_size, args.fallback_url, showcase_people
    )
    with open(os.path.join(args.out_dir, "import_evidence.sql"), "w") as f:
        f.write("\n".join(evidence_statements))
    print(f"Wrote {len(candidates)} evidence rows in {len(evidence_statements)} statement(s) -> import_evidence.sql")

    rl_statements = generate_research_log_sql(
        research_rows, person_id_map, args.entity_id, args.chunk_size, args.import_label
    )
    with open(os.path.join(args.out_dir, "import_research_log.sql"), "w") as f:
        f.write("\n".join(rl_statements))
    print(f"Wrote {len(research_rows)} research_log rows in {len(rl_statements)} statement(s) -> import_research_log.sql")


if __name__ == "__main__":
    main()
