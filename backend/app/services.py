"""Business logic: evaluation settings, imports, and per-query computation."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import HTTPException

from .scoring import (
    METRICS,
    METRIC_LABELS,
    RawResult,
    aggregate_scores,
    evaluate_query,
    normalize_weight,
)

GRADE_LABELS = {0: "不相关", 1: "部分相关", 2: "相关", 3: "高度相关"}
SLOTS = ("a", "b")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _get_evaluation(conn, evaluation_id: int) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, name, k, created_at, updated_at FROM evaluations WHERE id = ?",
        (evaluation_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="评测不存在")
    return dict(row)


def list_evaluations(conn) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, name, k, created_at, updated_at FROM evaluations ORDER BY id"
    ).fetchall()
    return [dict(row) for row in rows]


def create_evaluation(conn, *, name: str, k: int) -> dict[str, Any]:
    if not isinstance(k, int) or k < 1:
        raise HTTPException(status_code=422, detail="K 必须是正整数")
    stamp = now_iso()
    cur = conn.execute(
        "INSERT INTO evaluations (name, k, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (name.strip() or "未命名评测", k, stamp, stamp),
    )
    conn.commit()
    return _get_evaluation(conn, int(cur.lastrowid))


def update_evaluation(
    conn,
    evaluation_id: int,
    *,
    name: str | None = None,
    k: int | None = None,
) -> dict[str, Any]:
    evaluation = _get_evaluation(conn, evaluation_id)
    new_name = evaluation["name"] if name is None else (name.strip() or evaluation["name"])
    new_k = evaluation["k"] if k is None else k
    if not isinstance(new_k, int) or new_k < 1:
        raise HTTPException(status_code=422, detail="K 必须是正整数")
    conn.execute(
        "UPDATE evaluations SET name = ?, k = ?, updated_at = ? WHERE id = ?",
        (new_name, new_k, now_iso(), evaluation_id),
    )
    conn.commit()
    return _get_evaluation(conn, evaluation_id)


def delete_evaluation(conn, evaluation_id: int) -> None:
    _get_evaluation(conn, evaluation_id)
    conn.execute("DELETE FROM evaluations WHERE id = ?", (evaluation_id,))
    conn.commit()


def list_queries(conn, evaluation_id: int) -> list[dict[str, Any]]:
    _get_evaluation(conn, evaluation_id)
    rows = conn.execute(
        "SELECT qid, text, grp, weight, seq FROM queries "
        "WHERE evaluation_id = ? ORDER BY seq, qid",
        (evaluation_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def set_queries(
    conn, evaluation_id: int, queries: Iterable[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Replace the whole query set. Duplicate qids keep their first occurrence."""
    _get_evaluation(conn, evaluation_id)
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, entry in enumerate(queries):
        qid = str(entry.get("qid", "")).strip()
        if not qid or qid in seen:
            continue
        seen.add(qid)
        cleaned.append(
            {
                "qid": qid,
                "text": str(entry.get("text") or ""),
                "grp": str(entry.get("grp") or ""),
                "weight": normalize_weight(entry.get("weight", 1)),
                "seq": index,
            }
        )
    with conn:
        conn.execute("DELETE FROM queries WHERE evaluation_id = ?", (evaluation_id,))
        conn.executemany(
            "INSERT INTO queries (evaluation_id, qid, text, grp, weight, seq) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                (evaluation_id, q["qid"], q["text"], q["grp"], q["weight"], q["seq"])
                for q in cleaned
            ],
        )
    _prune_orphans(conn, evaluation_id)
    return list_queries(conn, evaluation_id)


def update_query(
    conn, evaluation_id: int, qid: str, *, grp: str | None, weight: float | None
) -> dict[str, Any]:
    _get_evaluation(conn, evaluation_id)
    row = conn.execute(
        "SELECT qid FROM queries WHERE evaluation_id = ? AND qid = ?",
        (evaluation_id, qid),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="查询不存在")
    if grp is not None:
        conn.execute(
            "UPDATE queries SET grp = ? WHERE evaluation_id = ? AND qid = ?",
            (grp, evaluation_id, qid),
        )
    if weight is not None:
        conn.execute(
            "UPDATE queries SET weight = ? WHERE evaluation_id = ? AND qid = ?",
            (normalize_weight(weight), evaluation_id, qid),
        )
    conn.execute(
        "UPDATE evaluations SET updated_at = ? WHERE id = ?",
        (now_iso(), evaluation_id),
    )
    conn.commit()
    return get_query(conn, evaluation_id, qid)


def get_query(conn, evaluation_id: int, qid: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT qid, text, grp, weight, seq FROM queries "
        "WHERE evaluation_id = ? AND qid = ?",
        (evaluation_id, qid),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="查询不存在")
    return dict(row)


def _prune_orphans(conn, evaluation_id: int) -> None:
    """After the query set changes, drop rankings/judgments for removed queries."""
    with conn:
        conn.execute(
            "DELETE FROM judgments WHERE evaluation_id = ? AND qid NOT IN "
            "(SELECT qid FROM queries WHERE evaluation_id = ?)",
            (evaluation_id, evaluation_id),
        )
        conn.execute(
            "DELETE FROM results WHERE evaluation_id = ? AND qid NOT IN "
            "(SELECT qid FROM queries WHERE evaluation_id = ?)",
            (evaluation_id, evaluation_id),
        )
        conn.execute(
            "DELETE FROM ranking_queries WHERE evaluation_id = ? AND qid NOT IN "
            "(SELECT qid FROM queries WHERE evaluation_id = ?)",
            (evaluation_id, evaluation_id),
        )


def set_judgments(
    conn, evaluation_id: int, rows: Iterable[dict[str, Any]]
) -> list[dict[str, Any]]:
    _get_evaluation(conn, evaluation_id)
    valid_qids = {
        row["qid"]
        for row in conn.execute(
            "SELECT qid FROM queries WHERE evaluation_id = ?", (evaluation_id,)
        ).fetchall()
    }
    cleaned: list[tuple[str, str, int]] = []
    seen: set[tuple[str, str]] = set()
    for entry in rows:
        qid = str(entry.get("qid", "")).strip()
        doc_id = str(entry.get("doc_id", "")).strip()
        grade = entry.get("grade")
        if not qid or not doc_id:
            continue
        if qid not in valid_qids:
            raise HTTPException(
                status_code=422, detail=f"标注引用了查询集中不存在的查询: {qid}"
            )
        if not isinstance(grade, int) or grade < 0 or grade > 3:
            raise HTTPException(
                status_code=422, detail=f"{qid}/{doc_id} 的相关性必须是 0-3 的整数"
            )
        key = (qid, doc_id)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append((qid, doc_id, grade))
    with conn:
        conn.execute("DELETE FROM judgments WHERE evaluation_id = ?", (evaluation_id,))
        conn.executemany(
            "INSERT INTO judgments (evaluation_id, qid, doc_id, grade) VALUES (?, ?, ?, ?)",
            [(evaluation_id, *row) for row in cleaned],
        )
    return list_judgments(conn, evaluation_id)


def list_judgments(conn, evaluation_id: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT qid, doc_id, grade FROM judgments "
        "WHERE evaluation_id = ? ORDER BY qid, grade DESC, doc_id",
        (evaluation_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def judgments_by_query(conn, evaluation_id: int) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for row in conn.execute(
        "SELECT qid, doc_id, grade FROM judgments WHERE evaluation_id = ?",
        (evaluation_id,),
    ).fetchall():
        result.setdefault(row["qid"], {})[row["doc_id"]] = int(row["grade"])
    return result


def set_ranking(
    conn,
    evaluation_id: int,
    slot: str,
    *,
    label: str,
    rows: Iterable[dict[str, Any]],
    covered_qids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Replace one version's ranking.

    ``covered_qids`` is the set of queries the imported file declares, so an
    empty query stays in the set instead of vanishing from coverage.
    """
    _get_evaluation(conn, evaluation_id)
    if slot not in SLOTS:
        raise HTTPException(status_code=422, detail="版本只能是 a 或 b")
    valid_qids = {
        row["qid"]
        for row in conn.execute(
            "SELECT qid FROM queries WHERE evaluation_id = ?", (evaluation_id,)
        ).fetchall()
    }
    cleaned: list[tuple[str, str, int, int]] = []
    covered: list[str] = []
    seq_by_query: dict[str, int] = {}
    for qid in covered_qids or ():
        qid = str(qid)
        if qid in valid_qids and qid not in covered:
            covered.append(qid)
    for entry in rows:
        qid = str(entry.get("qid", "")).strip()
        doc_id = str(entry.get("doc_id", "")).strip()
        if not qid or not doc_id:
            continue
        if qid not in valid_qids:
            raise HTTPException(
                status_code=422, detail=f"排序引用了查询集中不存在的查询: {qid}"
            )
        rank = entry.get("rank")
        if not isinstance(rank, int) or rank < 1:
            raise HTTPException(
                status_code=422, detail=f"{qid}/{doc_id} 的名次必须是正整数"
            )
        if qid not in seq_by_query:
            seq_by_query[qid] = 0
        if qid not in covered:
            covered.append(qid)
        cleaned.append((slot, qid, doc_id, rank, seq_by_query[qid]))
        seq_by_query[qid] += 1

    stamp = now_iso()
    with conn:
        # Upsert first: results and coverage rows carry an FK to this row.
        conn.execute(
            "INSERT INTO rankings (evaluation_id, slot, label, updated_at) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT (evaluation_id, slot) DO UPDATE SET "
            "label = excluded.label, updated_at = excluded.updated_at",
            (evaluation_id, slot, label.strip() or f"版本 {slot.upper()}", stamp),
        )
        conn.execute(
            "DELETE FROM results WHERE evaluation_id = ? AND slot = ?",
            (evaluation_id, slot),
        )
        conn.execute(
            "DELETE FROM ranking_queries WHERE evaluation_id = ? AND slot = ?",
            (evaluation_id, slot),
        )
        conn.executemany(
            "INSERT INTO ranking_queries (evaluation_id, slot, qid) VALUES (?, ?, ?)",
            [(evaluation_id, slot, qid) for qid in covered],
        )
        conn.executemany(
            "INSERT INTO results (evaluation_id, slot, qid, doc_id, rank, seq) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            [(evaluation_id, *row) for row in cleaned],
        )
    return get_ranking(conn, evaluation_id, slot)


def get_ranking(conn, evaluation_id: int, slot: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT label, updated_at FROM rankings WHERE evaluation_id = ? AND slot = ?",
        (evaluation_id, slot),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"版本 {slot.upper()} 的排序尚未导入")
    covered = [
        dict(r)
        for r in conn.execute(
            "SELECT qid FROM ranking_queries WHERE evaluation_id = ? AND slot = ? "
            "ORDER BY qid",
            (evaluation_id, slot),
        ).fetchall()
    ]
    result_rows = conn.execute(
        "SELECT qid, doc_id, rank, seq FROM results "
        "WHERE evaluation_id = ? AND slot = ? ORDER BY qid, seq",
        (evaluation_id, slot),
    ).fetchall()
    by_query: dict[str, list[dict[str, Any]]] = {}
    for r in result_rows:
        by_query.setdefault(r["qid"], []).append(
            {"doc_id": r["doc_id"], "rank": int(r["rank"]), "seq": int(r["seq"])}
        )
    return {
        "slot": slot,
        "label": row["label"],
        "updated_at": row["updated_at"],
        "queries": [entry["qid"] for entry in covered],
        "results": by_query,
        "result_count": len(result_rows),
    }


def _metric_value(block: dict[str, Any], metric: str) -> float | None:
    entry = block["metrics"][metric]
    return entry["value"] if entry["applicable"] else None


def compute_evaluation(conn, evaluation_id: int) -> dict[str, Any]:
    evaluation = _get_evaluation(conn, evaluation_id)
    k = int(evaluation["k"])
    queries = list_queries(conn, evaluation_id)
    judgment_map = judgments_by_query(conn, evaluation_id)

    ranking_a = _try_get_ranking(conn, evaluation_id, "a")
    ranking_b = _try_get_ranking(conn, evaluation_id, "b")
    if ranking_a is None and ranking_b is None:
        raise HTTPException(status_code=409, detail="请先导入至少一个版本的排序")

    labels = {
        "a": ranking_a["label"] if ranking_a else "版本 A（未导入）",
        "b": ranking_b["label"] if ranking_b else "版本 B（未导入）",
    }

    results_by_slot: dict[str, dict[str, list[dict[str, Any]]]] = {"a": {}, "b": {}}
    for slot, ranking in (("a", ranking_a), ("b", ranking_b)):
        if ranking is None:
            continue
        for qid, entries in ranking["results"].items():
            results_by_slot[slot][qid] = entries
    covered_qids = {
        "a": set(ranking_a["queries"]) if ranking_a else set(),
        "b": set(ranking_b["queries"]) if ranking_b else set(),
    }

    # Coverage is determined by the queries the ranking file declares, so a
    # query with zero results still counts as covered.
    query_rows: list[dict[str, Any]] = []
    for query in queries:
        qid = query["qid"]
        judgments = judgment_map.get(qid, {})
        coverage = {slot: qid in covered_qids[slot] for slot in SLOTS}
        both = coverage["a"] and coverage["b"]

        row: dict[str, Any] = {
            "qid": qid,
            "text": query["text"],
            "grp": query["grp"],
            "weight": query["weight"],
            "judged": len(judgments),
            "known_relevant": sum(1 for g in judgments.values() if g >= 1),
            "covered": coverage,
            "comparable": both,
            "versions": {},
            "status": None,
        }

        for slot in SLOTS:
            if not coverage[slot]:
                row["versions"][slot] = None
                continue
            raw = [
                RawResult(doc_id=entry["doc_id"], rank=entry["rank"], seq=entry["seq"])
                for entry in results_by_slot[slot].get(qid, [])
            ]
            row["versions"][slot] = evaluate_query(
                raw_results=raw, judgments=judgments, k=k
            )

        if not both:
            missing = [slot.upper() for slot in SLOTS if not coverage[slot]]
            row["status"] = f"仅由 {('、'.join(s for s in SLOTS if coverage[s]).upper() or '无')} 覆盖，缺少 {('、'.join(missing))}，不参与比较"
        elif coverage["a"] and coverage["b"]:
            row["status"] = "两版共同覆盖"
        query_rows.append(row)

    comparison_rows = [row for row in query_rows if row["comparable"]]

    aggregates: dict[str, Any] = {}
    for slot in SLOTS:
        aggregates[slot] = {}
        for metric in METRICS:
            aggregates[slot][metric] = {
                "standard": aggregate_scores(
                    rows=comparison_rows,
                    metric=metric,
                    value_getter=lambda row, s=slot, m=metric: (
                        None
                        if row["versions"][s] is None
                        else _metric_value(row["versions"][s]["standard"], m)
                    ),
                    weight_getter=lambda row: row["weight"],
                ),
                "auxiliary": aggregate_scores(
                    rows=comparison_rows,
                    metric=metric,
                    value_getter=lambda row, s=slot, m=metric: (
                        None
                        if row["versions"][s] is None
                        else _metric_value(row["versions"][s]["auxiliary"], m)
                    ),
                    weight_getter=lambda row: row["weight"],
                ),
            }

    deltas: dict[str, Any] = {}
    for metric in METRICS:
        deltas[metric] = {}
        for view in ("standard", "auxiliary"):
            a = aggregates["a"][metric][view]
            b = aggregates["b"][metric][view]
            deltas[metric][view] = {
                "macro": _delta(a["macro"]["value"], b["macro"]["value"]),
                "weighted": _delta(a["weighted"]["value"], b["weighted"]["value"]),
            }

    # Per-query deltas drive the "where do the versions differ" ranking.
    for row in comparison_rows:
        version_a = row["versions"]["a"]
        version_b = row["versions"]["b"]
        row["diffs"] = {}
        for metric in METRICS:
            row["diffs"][metric] = {
                view: _delta(
                    _metric_value(version_a[view], metric),
                    _metric_value(version_b[view], metric),
                )
                for view in ("standard", "auxiliary")
            }
            row["diffs"][metric]["absolute"] = _delta(
                _metric_value(version_a["standard"], metric),
                _metric_value(version_b["standard"], metric),
            )

    # Queries only one version covered, or which are otherwise excluded.
    excluded = [row for row in query_rows if not row["comparable"]]
    only_a = [row["qid"] for row in query_rows if row["covered"]["a"] and not row["covered"]["b"]]
    only_b = [row["qid"] for row in query_rows if row["covered"]["b"] and not row["covered"]["a"]]

    groups: dict[str, dict[str, Any]] = {}
    for row in comparison_rows:
        bucket = groups.setdefault(
            row["grp"] or "未分组", {"group": row["grp"] or "未分组", "count": 0, "weights": 0.0}
        )
        bucket["count"] += 1
        bucket["weights"] += row["weight"]

    # Count queries (not version-slot pairs) that show a flag in either version.
    flags_summary: dict[str, int] = {}
    for row in comparison_rows:
        for view in ("standard", "auxiliary"):
            present: set[str] = set()
            for slot in SLOTS:
                version = row["versions"][slot]
                if version is None:
                    continue
                present.update(
                    flag for flag, active in version[view]["flags"].items() if active
                )
            for flag in present:
                key = f"{view}.{flag}"
                flags_summary[key] = flags_summary.get(key, 0) + 1

    return {
        "evaluation": evaluation,
        "k": k,
        "labels": labels,
        "versions_present": {"a": ranking_a is not None, "b": ranking_b is not None},
        "queries": query_rows,
        "comparison": {
            "query_count": len(comparison_rows),
            "excluded_count": len(excluded),
            "only_a": only_a,
            "only_b": only_b,
            "groups": sorted(groups.values(), key=lambda g: g["group"]),
        },
        "aggregates": aggregates,
        "deltas": deltas,
        "flags_summary": flags_summary,
        "metric_labels": METRIC_LABELS,
    }


def _try_get_ranking(conn, evaluation_id: int, slot: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT 1 FROM rankings WHERE evaluation_id = ? AND slot = ?",
        (evaluation_id, slot),
    ).fetchone()
    if row is None:
        return None
    return get_ranking(conn, evaluation_id, slot)


def _delta(a: float | None, b: float | None) -> dict[str, Any]:
    if a is None or b is None:
        return {"a": a, "b": b, "delta": None, "applicable": False}
    return {"a": a, "b": b, "delta": b - a, "applicable": True}


# ---------------------------------------------------------------------------
# Import parsing


def _detect(text: str) -> str:
    stripped = text.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        return "json"
    return "csv"


def parse_query_import(text: str) -> list[dict[str, Any]]:
    """Queries: JSON [{qid,text,group,weight}] or CSV with qid/text/group/weight."""
    kind = _detect(text)
    if kind == "json":
        payload = json.loads(text)
        if isinstance(payload, dict):
            payload = payload.get("queries", [])
        if not isinstance(payload, list):
            raise HTTPException(status_code=422, detail="查询集 JSON 必须是数组")
        entries = payload
    else:
        reader = csv.DictReader(io.StringIO(text))
        entries = list(reader)
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        qid = str(entry.get("qid") or entry.get("query_id") or "").strip()
        if not qid:
            continue
        rows.append(
            {
                "qid": qid,
                "text": str(entry.get("text") or entry.get("query") or ""),
                "grp": str(entry.get("group") or entry.get("grp") or ""),
                "weight": normalize_weight(entry.get("weight", 1)),
            }
        )
    if not rows:
        raise HTTPException(status_code=422, detail="没有解析到任何查询")
    return rows


def parse_judgment_import(text: str) -> list[dict[str, Any]]:
    """Judgments: JSON [{qid,doc_id,grade}] or CSV with those columns."""
    kind = _detect(text)
    if kind == "json":
        payload = json.loads(text)
        if isinstance(payload, dict):
            payload = payload.get("judgments", [])
        entries = payload if isinstance(payload, list) else []
    else:
        entries = list(csv.DictReader(io.StringIO(text)))
    rows: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        qid = str(entry.get("qid") or "").strip()
        doc_id = str(entry.get("doc_id") or entry.get("doc") or "").strip()
        try:
            grade = int(entry.get("grade"))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=422, detail=f"{qid}/{doc_id} 的相关性必须是 0-3 的整数"
            )
        if not qid or not doc_id:
            continue
        rows.append({"qid": qid, "doc_id": doc_id, "grade": grade})
    if not rows:
        raise HTTPException(status_code=422, detail="没有解析到任何标注")
    return rows


def parse_ranking_import(text: str) -> tuple[list[dict[str, Any]], list[str]]:
    """Rankings: JSON [{qid,doc_id,rank}] or CSV with those columns.

    Returns ``(rows, covered_qids)``.  A query present in the file with zero
    rows is still declared: JSON supports ``{"qid": "...", "results": []}``.
    """
    kind = _detect(text)
    if kind == "json":
        payload = json.loads(text)
        if isinstance(payload, dict):
            payload = payload.get("results", payload.get("rankings", []))
        if not isinstance(payload, list):
            raise HTTPException(status_code=422, detail="排序 JSON 必须是数组")
        entries = payload
    else:
        entries = list(csv.DictReader(io.StringIO(text)))

    rows: list[dict[str, Any]] = []
    seen_queries: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        qid = str(entry.get("qid") or "").strip()
        if not qid:
            continue
        seen_queries.add(qid)
        nested = entry.get("results")
        if isinstance(nested, list):
            for item in nested:
                doc_id = str(item.get("doc_id") or "").strip()
                rank = item.get("rank")
                if not doc_id or not isinstance(rank, int) or rank < 1:
                    raise HTTPException(
                        status_code=422, detail=f"{qid} 里有无效的名次或文档编号"
                    )
                rows.append({"qid": qid, "doc_id": doc_id, "rank": rank})
            continue
        doc_id = str(entry.get("doc_id") or "").strip()
        if not doc_id:
            continue
        rank = entry.get("rank")
        if not isinstance(rank, int) or rank < 1:
            raise HTTPException(
                status_code=422, detail=f"{qid}/{doc_id} 的名次必须是正整数"
            )
        rows.append({"qid": qid, "doc_id": doc_id, "rank": rank})

    if not rows and not seen_queries:
        raise HTTPException(status_code=422, detail="没有解析到任何排序结果")
    return rows, sorted(seen_queries)
