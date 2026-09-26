#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Passo 1 do importador de dossiê de pessoa: lê Excel + showcase JSON +
evidência já existente em produção, aplica as regras de lib.py, e escreve
candidatos de evidência + linhas de research_log em JSON. NÃO ESCREVE NADA NA
BASE DE DADOS — é sempre um dry-run de preparação de dados; quem grava é o
generate_sql.py + a aplicação manual/mcp do SQL gerado (ver README.md).

Uso:
    python3 build_candidates.py \\
        --excel /caminho/enriquecimento_<fundo>_showcase.xlsx \\
        --showcase-json /caminho/showcase_dados.json \\
        --existing-evidence-json /caminho/existing_evidence.json \\
        --entity-id <uuid-da-entidade-no-catalog_entities> \\
        --out-dir /caminho/saida \\
        [--preview-people "Marco Neves,Ana Terra,Filipa Ferreira"]

Inputs esperados:
  --excel: workbook com as folhas EQUIPA_COMPLETA, DOSSIER_PESSOAS,
    CONTEUDO_PESSOAS, RELACOES_PESSOA_PORTFOLIO, FONTES (mesmo layout usado
    para a Portugal Ventures).
  --showcase-json: {"people": [{"display_name", "catalog_person_id",
    "official_title", "career": [...], "boards": [...], "education": [...],
    "statements": [...], "topics": [...], "not_found": [...],
    "portfolio_tags_on_pv_site": [...], "member_page",
    "member_page_is_placeholder"}]}
  --existing-evidence-json: dump de
    `select person_id, entity_id, kind, url from catalog_evidence where
    entity_id = '<entity-id>' and origin = 'import'` em produção — usado só
    para deduplicação vs. produção, nunca para decidir o que importar.

Regras Excel vs showcase: quando o showcase tem a lista estruturada
(career/boards/education), essa é a fonte de verdade e o texto livre
correspondente do Excel (DOSSIER_PESSOAS.carreira_resumo / .formacao) é
ignorado; só quando o showcase NÃO tem a lista estruturada é que o bloco de
texto livre do Excel é usado, e nesse caso entra sempre como kind='other'
(nunca role_history/education com estrutura assumida), porque um bloco de
texto livre não decomposto não permite atribuir período nem role_type com
confiança.

Saídas em --out-dir:
  candidates.json       — candidatos de evidência novos (após dedup)
  research_log_rows.json — linhas de catalog_person_research_log
  person_id_map.json    — display_name -> catalog_person_id
  dry_run_report.md     — relatório humano (contagens, QA, previews)
"""
import argparse
import json
import re
from collections import Counter, defaultdict

import pandas as pd

import lib


def norm_url(u):
    return lib.norm_url(u)


def load_inputs(excel_path, showcase_json_path, existing_evidence_path):
    xl = pd.ExcelFile(excel_path)
    equipa = xl.parse("EQUIPA_COMPLETA")
    dossier = xl.parse("DOSSIER_PESSOAS")
    conteudo = xl.parse("CONTEUDO_PESSOAS")
    relacoes = xl.parse("RELACOES_PESSOA_PORTFOLIO")

    with open(showcase_json_path) as f:
        showcase = json.load(f)
    with open(existing_evidence_path) as f:
        existing_evidence = json.load(f)

    return equipa, dossier, conteudo, relacoes, showcase, existing_evidence


def build(entity_id, excel_path, showcase_json_path, existing_evidence_path, preview_people):
    _equipa, dossier, conteudo, relacoes, showcase, existing_evidence = load_inputs(
        excel_path, showcase_json_path, existing_evidence_path
    )

    showcase_people = {p["display_name"]: p for p in showcase["people"]}
    dossier_by_name = {r["pessoa"]: r for _, r in dossier.iterrows()}

    existing_by_person_url = defaultdict(set)
    existing_by_person_id = defaultdict(list)
    for row in existing_evidence:
        pid = row["person_id"]
        u = norm_url(row.get("url"))
        if u:
            existing_by_person_url[pid].add(u)
        existing_by_person_id[pid].append(row)

    candidates = []
    excluded = []
    pending_later = []
    audit_only = []
    role_type_qa_board_advisory = []
    role_type_qa_ambiguous = []

    # --- career / boards / education / statements, a partir do showcase estruturado ---
    for person_name, sp in showcase_people.items():
        pid = sp["catalog_person_id"]
        drow = dossier_by_name.get(person_name)

        career_list = sp.get("career", [])
        if career_list:
            for c in career_list:
                f_date, f_prec, is_cur, t_date, t_prec = lib.parse_period(c.get("from"), c.get("to"))
                role_text = f"{c.get('org')} — {c.get('role')}"
                rtype, ambig_reason = lib.classify_role_type(c.get("role", ""))
                if rtype == "ambiguous":
                    role_type_qa_ambiguous.append({"person": person_name, "title": role_text, "reason": ambig_reason})
                    candidates.append({
                        "person": person_name, "person_id": pid, "kind": "other", "role_type": None,
                        "title": role_text,
                        "excerpt": f"Cargo não classificável com confiança entre employment/board_advisory: {ambig_reason}",
                        "url": c.get("source") if str(c.get("source", "")).startswith("http") else None,
                        "provenance_source": "showcase_structured_ambiguous_role", "source": "showcase.career",
                    })
                    continue
                if rtype == "board_advisory":
                    role_type_qa_board_advisory.append({"person": person_name, "title": role_text})
                candidates.append({
                    "person": person_name, "person_id": pid, "kind": "role_history", "role_type": rtype,
                    "title": role_text, "url": c.get("source") if str(c.get("source", "")).startswith("http") else None,
                    "period_from": f_date, "period_from_precision": f_prec,
                    "period_to": t_date, "period_to_precision": t_prec, "period_is_current": is_cur,
                    "provenance_source": "showcase_structured", "source": "showcase.career",
                })
        elif drow is not None and str(drow.get("carreira_resumo", "")).strip() not in ("", "nan"):
            candidates.append({
                "person": person_name, "person_id": pid, "kind": "other", "role_type": None,
                "title": "Resumo de carreira (Excel, bloco não decomposto)",
                "excerpt": str(drow["carreira_resumo"])[:600], "url": None,
                "provenance_source": "excel_dossier_fallback", "source": "excel.carreira_resumo",
                "note": "kind='other' porque o bloco de texto não permite atribuir role_type com confiança",
            })

        for b in sp.get("boards", []):
            company = str(b.get("company", "")).strip()
            role_text = str(b.get("role", "")).strip()
            if not company or "none declared" in company.lower():
                continue
            if "portfolio-page tag" in role_text.lower() or ";" in company:
                pending_later.append({
                    "person": person_name, "item": f"{company} — {role_text}",
                    "reason": "mal classificado como 'board' na fonte — é na verdade tag de portfolio, não um lugar de conselho; não importado",
                })
                continue
            board_title = f"{company} — {role_text}".strip(" —")
            rtype, ambig_reason = lib.classify_role_type(role_text)
            if rtype == "ambiguous":
                role_type_qa_ambiguous.append({"person": person_name, "title": board_title, "reason": ambig_reason})
                candidates.append({
                    "person": person_name, "person_id": pid, "kind": "other", "role_type": None,
                    "title": board_title,
                    "excerpt": f"Cargo não classificável com confiança entre employment/board_advisory: {ambig_reason}",
                    "url": b.get("source") if str(b.get("source", "")).startswith("http") else None,
                    "provenance_source": "showcase_structured_ambiguous_role", "source": "showcase.boards",
                })
                continue
            if rtype == "board_advisory":
                role_type_qa_board_advisory.append({"person": person_name, "title": board_title})
            candidates.append({
                "person": person_name, "person_id": pid, "kind": "role_history", "role_type": rtype,
                "title": board_title, "url": b.get("source") if str(b.get("source", "")).startswith("http") else None,
                "provenance_source": "showcase_structured", "source": "showcase.boards",
            })

        education_list = sp.get("education", [])
        if education_list:
            for e in education_list:
                candidates.append({
                    "person": person_name, "person_id": pid, "kind": "education", "role_type": None,
                    "title": str(e)[:200], "url": None,
                    "provenance_source": "showcase_structured", "source": "showcase.education",
                })
        elif drow is not None and str(drow.get("formacao", "")).strip() not in ("", "nan"):
            candidates.append({
                "person": person_name, "person_id": pid, "kind": "education", "role_type": None,
                "title": "Formação (Excel, bloco não decomposto)",
                "excerpt": str(drow["formacao"])[:600], "url": None,
                "provenance_source": "excel_dossier_fallback", "source": "excel.formacao",
            })

        for s in sp.get("statements", []):
            candidates.append({
                "person": person_name, "person_id": pid, "kind": "statement", "role_type": None,
                "title": str(s.get("text", ""))[:200], "url": s.get("source"),
                "published_at": s.get("date"),
                "provenance_source": "showcase_structured", "source": "showcase.statements",
            })

    # --- CONTEUDO_PESSOAS -> mapeado via dicionário ---
    for _, row in conteudo.iterrows():
        person_name = row.get("person_name")
        sp = showcase_people.get(person_name)
        pid = sp["catalog_person_id"] if sp else None
        kind, role_type, importable, excl_reason = lib.resolve_evidence_kind(
            row.get("source_type"), row.get("source_first_party"), row.get("companies_mentioned")
        )
        provenance = {"source_type_original": str(row.get("source_type"))}

        pub_date_raw = row.get("publication_date")
        pub_date_str = str(pub_date_raw) if pub_date_raw is not None else None
        ambiguous_date = bool(pub_date_str and re.search(r"\d{4}-\d{2}/\d{4}", pub_date_str))
        published_at = None if (ambiguous_date or not pub_date_str or pub_date_str == "nan") else pub_date_str
        if ambiguous_date:
            provenance["raw_publication_date"] = pub_date_str
            provenance["date_parse_status"] = "ambiguous"

        if not importable:
            excluded.append({"person": person_name, "source_type": row.get("source_type"), "reason": excl_reason,
                              "detail": str(row.get("factual_summary", ""))[:150]})
            if str(row.get("source_type")) == "role_conflict":
                audit_only.append({"person": person_name, "note": str(row.get("notes") or row.get("factual_summary", ""))[:300]})
            continue

        candidates.append({
            "person": person_name, "person_id": pid, "kind": kind, "role_type": role_type,
            "title": str(row.get("source_title") or row.get("factual_summary", ""))[:200],
            "url": row.get("source_url"), "published_at": published_at,
            "excerpt": str(row.get("factual_summary") or row.get("direct_quote_short") or "")[:600],
            "provenance_source": "conteudo_pessoas", "provenance_extra": provenance,
            "source": "excel.conteudo_pessoas",
        })

    # --- RELACOES_PESSOA_PORTFOLIO -> portfolio_relationship ---
    for _, row in relacoes.iterrows():
        person_name = row["pessoa"]
        sp = showcase_people.get(person_name)
        pid = sp["catalog_person_id"] if sp else None
        current = lib.classify_current(row["estado_relacao"])
        candidates.append({
            "person": person_name, "person_id": pid, "kind": "portfolio_relationship", "role_type": None,
            "title": f"{row['empresa']} — {row['tipo_relacao']}",
            "url": row.get("source_url"),
            "relation_kind": lib.classify_relation_kind(row["tipo_relacao"]),
            "period_is_current": current,
            "provenance_extra": {"raw_relationship_status": str(row["estado_relacao"]), "relation_type_original": str(row["tipo_relacao"])},
            "provenance_source": "relacoes_pessoa_portfolio_curated",
            "source": "excel.relacoes_pessoa_portfolio",
        })

    # --- sinais brutos de portfolio (não importados agora) ---
    total_raw_portfolio_tags = 0
    for person_name, sp in showcase_people.items():
        tags = sp.get("portfolio_tags_on_pv_site", [])
        total_raw_portfolio_tags += len(tags)
        for t in tags:
            pending_later.append({"person": person_name, "item": str(t)[:150],
                                   "reason": "sinal bruto de portfolio — reconciliar em fase posterior, não importar agora"})

    # --- dedup candidato <-> candidato (Excel/showcase entre si) ---
    seen_keys = {}
    deduped_candidates = []
    dupes_excel_showcase = []
    for c in candidates:
        key = lib.dedup_key(c["person"], c["kind"], c.get("url"), c.get("title"), c.get("excerpt"))
        if key in seen_keys:
            dupes_excel_showcase.append({"person": c["person"], "kind": c["kind"], "title": c.get("title"),
                                          "duplicate_of_source": seen_keys[key]["source"], "this_source": c["source"]})
            continue
        seen_keys[key] = c
        deduped_candidates.append(c)

    # --- dedup candidato <-> produção ---
    final_new_candidates = []
    dupes_vs_production = []
    for c in deduped_candidates:
        if lib.is_duplicate_of_production(c.get("person_id"), c.get("url"), existing_by_person_url):
            dupes_vs_production.append({"person": c["person"], "kind": c["kind"], "url": c.get("url")})
            continue
        final_new_candidates.append(c)

    kind_counts = Counter(c["kind"] for c in final_new_candidates)

    # --- research_log reconciliado ---
    research_log_rows = []
    for person_name, sp in showcase_people.items():
        pid = sp["catalog_person_id"]
        person_candidates = [c for c in final_new_candidates if c["person"] == person_name]
        prod_evidence = existing_by_person_id.get(pid, [])

        declared_not_found_scopes = set()
        for nf in sp.get("not_found", []):
            declared_not_found_scopes |= lib.scopes_from_not_found_text(nf)

        rows = lib.reconcile_research_log_for_person(
            candidate_kinds=[c["kind"] for c in person_candidates],
            candidate_role_types=[c.get("role_type") for c in person_candidates],
            prod_kinds=[e["kind"] for e in prod_evidence],
            declared_not_found_scopes=declared_not_found_scopes,
            has_topics=bool(sp.get("topics")),
        )
        for scope, result in rows:
            research_log_rows.append({"person": person_name, "scope": scope, "result": result})

    # sanity checks
    by_person_scope = defaultdict(set)
    for r in research_log_rows:
        by_person_scope[(r["person"], r["scope"])].add(r["result"])
    conflicting = {k: v for k, v in by_person_scope.items() if len(v) > 1}

    person_id_map = {p["display_name"]: p["catalog_person_id"] for p in showcase["people"]}

    report = {
        "candidates": final_new_candidates,
        "research_log_rows": research_log_rows,
        "person_id_map": person_id_map,
        "kind_counts": dict(kind_counts),
        "excluded": excluded,
        "pending_later": pending_later,
        "audit_only": audit_only,
        "dupes_excel_showcase": dupes_excel_showcase,
        "dupes_vs_production": dupes_vs_production,
        "role_type_qa_board_advisory": role_type_qa_board_advisory,
        "role_type_qa_ambiguous": role_type_qa_ambiguous,
        "conflicting_research_log": conflicting,
        "total_raw_portfolio_tags": total_raw_portfolio_tags,
        "preview_people": preview_people,
    }
    return report


def write_outputs(report, out_dir):
    import os
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "candidates.json"), "w") as f:
        json.dump(report["candidates"], f, ensure_ascii=False)
    with open(os.path.join(out_dir, "research_log_rows.json"), "w") as f:
        json.dump(report["research_log_rows"], f, ensure_ascii=False)
    with open(os.path.join(out_dir, "person_id_map.json"), "w") as f:
        json.dump(report["person_id_map"], f, ensure_ascii=False)

    lines = ["# Dry-run report\n"]
    lines.append(f"Candidatos novos (após dedup): **{len(report['candidates'])}**\n")
    lines.append("\n## Por evidence_kind\n")
    for k, v in sorted(report["kind_counts"].items()):
        lines.append(f"- {k}: {v}\n")
    lines.append(f"\nDuplicados Excel<->showcase: {len(report['dupes_excel_showcase'])}\n")
    lines.append(f"Duplicados vs. produção: {len(report['dupes_vs_production'])}\n")
    lines.append(f"Excluídas com razão: {len(report['excluded'])}\n")
    lines.append(f"Pendentes p/ enriquecimento posterior: {len(report['pending_later'])}\n")
    lines.append(f"\nresearch_log rows: {len(report['research_log_rows'])}\n")
    lines.append(f"Conflitos found+not_found no mesmo (pessoa, scope) — deve ser 0: **{len(report['conflicting_research_log'])}**\n")
    lines.append(f"\nrole_type=board_advisory: {len(report['role_type_qa_board_advisory'])}\n")
    lines.append(f"role_type ambíguo (kind='other', não forçado): {len(report['role_type_qa_ambiguous'])}\n")
    with open(os.path.join(out_dir, "dry_run_report.md"), "w") as f:
        f.writelines(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--excel", required=True)
    ap.add_argument("--showcase-json", required=True)
    ap.add_argument("--existing-evidence-json", required=True)
    ap.add_argument("--entity-id", required=True, help="uuid de catalog_entities para este fundo/entidade")
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--preview-people", default="", help="lista separada por vírgulas para o relatório")
    args = ap.parse_args()

    preview_people = [p.strip() for p in args.preview_people.split(",") if p.strip()]
    report = build(args.entity_id, args.excel, args.showcase_json, args.existing_evidence_json, preview_people)
    write_outputs(report, args.out_dir)

    print("OK — candidatos:", len(report["candidates"]))
    print("kind_counts:", report["kind_counts"])
    print("research_log rows:", len(report["research_log_rows"]))
    print("conflitos found+not_found (deve ser 0):", len(report["conflicting_research_log"]))
    if report["conflicting_research_log"]:
        print("!!! CONFLITOS ENCONTRADOS, NÃO PROSSEGUIR PARA generate_sql.py:", report["conflicting_research_log"])


if __name__ == "__main__":
    main()
