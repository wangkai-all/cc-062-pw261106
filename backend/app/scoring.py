"""Deterministic retrieval-evaluation primitives.

All ranking normalisation and metric maths live here, free of database or HTTP
concerns, so the rules can be unit-tested in isolation.

Rules implemented (and mirrored in the UI copy):

* Rankings are ordered by ``(rank, doc_id)``.  The document id is the stable
  tie-breaker.  The first occurrence of a doc id survives; later duplicates are
  dropped.  Surviving documents are renumbered 1..N, then the first K are scored.
* Relevance comes from 0..3 graded judgments.  Grade >= 1 is relevant.  Documents
  with no judgment are unlabeled and contribute gain 0.
* Precision@K divides by K even when fewer than K results were returned.
* Recall@K divides by every labeled document with grade >= 1 for that query.
* MRR uses the reciprocal position of the first relevant result inside top K,
  and is 0 when none is present (including queries with no known relevant docs).
* nDCG uses gain ``2^grade - 1`` and discount ``log2(position + 1)``.  The ideal
  ordering is every labeled document sorted by grade, truncated to K.  With no
  known relevant document, Recall and nDCG are not applicable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

METRICS: tuple[str, ...] = ("precision", "recall", "mrr", "ndcg")

METRIC_LABELS = {
    "precision": "Precision@K",
    "recall": "Recall@K",
    "mrr": "MRR@K",
    "ndcg": "nDCG@K",
}

PRECISION_FORMULA = "前 K 名中相关性 ≥ 1 的结果数 ÷ K"
RECALL_FORMULA = "前 K 名中相关性 ≥ 1 的结果数 ÷ 该查询全部已知相关文档数"
MRR_FORMULA = "1 ÷ 前 K 名中首个相关结果的名次；没有相关结果则记 0"
NDCG_FORMULA = "Σ(2^相关性 − 1) ÷ log2(名次 + 1)，再除以同一公式下理想顺序前 K 的值"
GAIN_FORMULA = "2^相关性 − 1"
DISCOUNT_FORMULA = "log2(名次 + 1)"


@dataclass(frozen=True)
class RawResult:
    """One imported result row. ``seq`` only preserves input order for display."""

    doc_id: str
    rank: int
    seq: int = 0


def _fmt(value: float | None, digits: int = 3) -> str:
    if value is None:
        return "—"
    return f"{value:.{digits}f}"


def normalize_rankings(
    raw_results: Sequence[RawResult], k: int
) -> dict[str, Any]:
    """Sort, de-duplicate and renumber a ranking, then cut it at K."""
    if not isinstance(k, int) or k <= 0:
        raise ValueError("K 必须是正整数")

    ordered = sorted(raw_results, key=lambda item: (item.rank, item.doc_id))
    seen: set[str] = set()
    kept: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    for item in ordered:
        if item.doc_id in seen:
            duplicates.append(
                {"doc_id": item.doc_id, "rank": item.rank, "seq": item.seq}
            )
            continue
        seen.add(item.doc_id)
        kept.append(
            {
                "doc_id": item.doc_id,
                "original_rank": item.rank,
                "seq": item.seq,
                "rank": len(kept) + 1,
            }
        )

    # A tie is any input rank shared by more than one row.  The doc id decides
    # the order, so these are stable rather than arbitrary.
    ranked_groups: dict[int, list[str]] = {}
    for item in ordered:
        ranked_groups.setdefault(item.rank, []).append(item.doc_id)
    ties = [
        {"rank": rank, "doc_ids": doc_ids}
        for rank, doc_ids in sorted(ranked_groups.items())
        if len(doc_ids) > 1
    ]
    tie_doc_ids = {doc_id for tie in ties for doc_id in tie["doc_ids"]}

    for index, entry in enumerate(kept, start=1):
        entry["scored"] = index <= k
        entry["tie"] = entry["doc_id"] in tie_doc_ids
    for entry in duplicates:
        entry["tie"] = entry["doc_id"] in tie_doc_ids

    return {
        "raw": [
            {"doc_id": item.doc_id, "rank": item.rank, "seq": item.seq}
            for item in raw_results
        ],
        "ordered": [
            {"doc_id": item.doc_id, "rank": item.rank, "seq": item.seq}
            for item in ordered
        ],
        "kept": kept,
        "top": [entry["doc_id"] for entry in kept[:k]],
        "beyond_k": [entry["doc_id"] for entry in kept[k:]],
        "duplicates": duplicates,
        "ties": ties,
        "flags": {
            "duplicates": bool(duplicates),
            "ties": bool(ties),
            "insufficient": len(kept) < k,
            "empty": len(kept) == 0,
        },
        "counts": {
            "raw": len(raw_results),
            "unique": len(kept),
            "dropped": len(duplicates),
            "scored": len(kept[:k]),
            "beyond_k": len(kept[k:]),
        },
    }


def _ideal_terms(judgments: Mapping[str, int], k: int) -> list[dict[str, Any]]:
    """Ideal ordering = all labeled docs by grade desc, first K, doc id stable."""
    labeled = sorted(
        judgments.items(), key=lambda item: (-item[1], item[0])
    )[:k]
    terms: list[dict[str, Any]] = []
    for position, (doc_id, grade) in enumerate(labeled, start=1):
        gain = float(2**grade - 1)
        discount = math.log2(position + 1)
        terms.append(
            {
                "rank": position,
                "doc_id": doc_id,
                "grade": grade,
                "gain": gain,
                "discount": discount,
                "term": gain / discount,
            }
        )
    return terms


def _annotate_rows(
    kept: Sequence[Mapping[str, Any]], judgments: Mapping[str, int], k: int
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for entry in kept:
        doc_id = str(entry["doc_id"])
        grade = judgments.get(doc_id)
        rank = int(entry["rank"])
        scored = rank <= k
        row: dict[str, Any] = {
            "doc_id": doc_id,
            "rank": rank,
            "original_rank": int(entry["original_rank"]),
            "seq": int(entry.get("seq", 0)),
            "grade": grade,
            "unlabeled": grade is None,
            "relevant": grade is not None and grade >= 1,
            "scored": scored,
            "tie": bool(entry.get("tie", False)),
        }
        if grade is None:
            row.update({"gain": None, "discount": None, "term": 0.0})
        else:
            row["gain"] = float(2**grade - 1)
            row["discount"] = math.log2(rank + 1)
            row["term"] = row["gain"] / row["discount"] if scored else 0.0
        rows.append(row)
    return rows


def _build_block(
    *,
    rows: Sequence[Mapping[str, Any]],
    judgments: Mapping[str, int],
    k: int,
    auxiliary: bool,
    dropped_unlabeled: Sequence[str] = (),
) -> dict[str, Any]:
    """Score one already-ordered, already-renumbered document list."""
    top = [row for row in rows if row["scored"]]
    known_relevant_grades = sorted(
        (grade for grade in judgments.values() if grade >= 1), reverse=True
    )
    known_relevant = len(known_relevant_grades)
    relevant_in_top = sum(1 for row in top if row["relevant"])

    precision = relevant_in_top / k
    recall = relevant_in_top / known_relevant if known_relevant else None

    first_relevant = next((row for row in top if row["relevant"]), None)
    mrr = 0.0 if first_relevant is None else 1.0 / int(first_relevant["rank"])

    dcg = sum(float(row["term"]) for row in top)
    ideal_terms = _ideal_terms(judgments, k)
    idcg = sum(float(term["term"]) for term in ideal_terms)
    ndcg = dcg / idcg if idcg > 0 else None

    labeled_in_top = sum(1 for row in top if not row["unlabeled"])
    unlabeled_in_top = len(top) - labeled_in_top
    unlabeled_share = unlabeled_in_top / len(top) if top else None

    metrics: dict[str, Any] = {
        "precision": {
            "value": precision,
            "applicable": True,
            "numerator": relevant_in_top,
            "denominator": k,
            "formula": PRECISION_FORMULA,
            "explain": (
                f"相关结果 {relevant_in_top} 个 ÷ K={k} = {_fmt(precision)}"
                + ("" if len(top) >= k else f"；只返回 {len(top)} 条，分母仍为 K")
            ),
        },
        "recall": {
            "value": recall,
            "applicable": recall is not None,
            "numerator": relevant_in_top,
            "denominator": known_relevant,
            "formula": RECALL_FORMULA,
            "explain": (
                f"相关结果 {relevant_in_top} 个 ÷ 已知相关文档 {known_relevant} 个"
                f" = {_fmt(recall)}"
                if recall is not None
                else "该查询没有已知相关文档，Recall 不适用"
            ),
        },
        "mrr": {
            "value": mrr,
            "applicable": True,
            "first_relevant_rank": int(first_relevant["rank"]) if first_relevant else None,
            "formula": MRR_FORMULA,
            "explain": (
                f"首个相关结果名次 {int(first_relevant['rank'])} → 1 ÷ "
                f"{int(first_relevant['rank'])} = {_fmt(mrr)}"
                if first_relevant
                else "前 K 名没有相关结果（或没有已知相关文档），MRR 记 0"
            ),
        },
        "ndcg": {
            "value": ndcg,
            "applicable": ndcg is not None,
            "dcg": dcg,
            "idcg": idcg,
            "formula": NDCG_FORMULA,
            "explain": (
                f"DCG = {_fmt(dcg)}；理想顺序前 {len(ideal_terms)} 条 DCG = "
                f"{_fmt(idcg)}；nDCG = {_fmt(dcg)} ÷ {_fmt(idcg)} = {_fmt(ndcg)}"
                if ndcg is not None
                else "该查询没有已知相关文档，nDCG 不适用"
            ),
        },
    }

    return {
        "auxiliary": auxiliary,
        "k": k,
        "rows": list(rows),
        "docs": top,
        "beyond": [row for row in rows if not row["scored"]],
        "metrics": metrics,
        "dcg": dcg,
        "idcg": idcg,
        "ideal_terms": ideal_terms,
        "known_relevant_docs": [
            {"doc_id": doc_id, "grade": grade}
            for doc_id, grade in sorted(
                ((doc_id, grade) for doc_id, grade in judgments.items() if grade >= 1),
                key=lambda item: (-item[1], item[0]),
            )
        ],
        "known_relevant_grades": known_relevant_grades,
        "relevant_in_top": relevant_in_top,
        "known_relevant": known_relevant,
        "judged_count": len(judgments),
        "unlabeled": {
            "count": unlabeled_in_top,
            "retrieved": len(top),
            "share": unlabeled_share,
            "doc_ids": [row["doc_id"] for row in top if row["unlabeled"]],
            "explain": (
                f"前 K 名共 {len(top)} 条，其中未标注 {unlabeled_in_top} 条 → "
                f"{unlabeled_in_top} ÷ {len(top)} = {_fmt(unlabeled_share)}"
                if top
                else "前 K 名为空，未标注占比不适用"
            ),
        },
        "dropped_unlabeled": list(dropped_unlabeled),
        "flags": {
            "empty": not top,
            "insufficient": len(top) < k,
            "unlabeled": unlabeled_in_top > 0,
            "no_relevant": known_relevant == 0,
            "missing_relevant": known_relevant > relevant_in_top,
            "duplicates": False,
            "ties": False,
        },
    }


def evaluate_query(
    *,
    raw_results: Sequence[RawResult],
    judgments: Mapping[str, int],
    k: int,
) -> dict[str, Any]:
    """Normalise a ranking and compute standard and auxiliary scores."""
    norm = normalize_rankings(raw_results, k)

    standard_rows = _annotate_rows(norm["kept"], judgments, k)
    standard = _build_block(
        rows=standard_rows, judgments=judgments, k=k, auxiliary=False
    )
    standard["duplicates"] = norm["duplicates"]
    standard["ties"] = norm["ties"]
    standard["flags"].update(
        {
            "empty": norm["counts"]["unique"] == 0,
            "insufficient": norm["counts"]["unique"] < k,
            "duplicates": norm["flags"]["duplicates"],
            "ties": norm["flags"]["ties"],
        }
    )

    # Auxiliary ranking: drop every unlabeled document first, renumber, then K.
    labeled_kept = [
        entry for entry in norm["kept"] if entry["doc_id"] in judgments
    ]
    dropped = [entry["doc_id"] for entry in norm["kept"] if entry["doc_id"] not in judgments]
    aux_renumbered: list[dict[str, Any]] = []
    for index, entry in enumerate(labeled_kept, start=1):
        aux_renumbered.append(
            {
                "doc_id": str(entry["doc_id"]),
                "original_rank": int(entry["original_rank"]),
                "seq": int(entry["seq"]),
                "rank": index,
                "tie": bool(entry["tie"]),
            }
        )
    auxiliary = _build_block(
        rows=_annotate_rows(aux_renumbered, judgments, k),
        judgments=judgments,
        k=k,
        auxiliary=True,
        dropped_unlabeled=dropped,
    )
    auxiliary["duplicates"] = norm["duplicates"]
    auxiliary["ties"] = norm["ties"]
    auxiliary["flags"].update(
        {
            "duplicates": norm["flags"]["duplicates"],
            "ties": norm["flags"]["ties"],
        }
    )

    return {
        "normalization": norm,
        "standard": standard,
        "auxiliary": auxiliary,
    }


def normalize_weight(weight: Any) -> float:
    try:
        value = float(weight)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(value) or value < 0:
        return 0.0
    return value


def aggregate_scores(
    *,
    rows: Iterable[Mapping[str, Any]],
    metric: str,
    value_getter,
    weight_getter,
) -> dict[str, Any]:
    """Macro (equal) and weighted averages over applicable queries.

    ``rows`` is already restricted to the desired comparison scope.  Macro
    includes every applicable query; weighted includes applicable queries whose
    weight is > 0 and divides by exactly the sum of those weights.
    """
    if metric not in METRICS:
        raise ValueError(f"未知指标: {metric}")

    scoped = list(rows)
    applicable: list[dict[str, Any]] = []
    not_applicable = 0
    for row in scoped:
        value = value_getter(row)
        if value is None:
            not_applicable += 1
            continue
        applicable.append(
            {
                "qid": row["qid"],
                "value": float(value),
                "weight": normalize_weight(weight_getter(row)),
            }
        )

    macro_count = len(applicable)
    macro_value = (
        sum(item["value"] for item in applicable) / macro_count
        if macro_count
        else None
    )
    macro_contributions = [
        {
            "qid": item["qid"],
            "value": item["value"],
            "weight": item["weight"],
            "contribution": item["value"] / macro_count,
        }
        for item in applicable
    ]

    positive = [item for item in applicable if item["weight"] > 0]
    weight_sum = sum(item["weight"] for item in positive)
    weighted_value = (
        sum(item["value"] * item["weight"] for item in positive) / weight_sum
        if weight_sum > 0
        else None
    )
    weighted_contributions = [
        {
            "qid": item["qid"],
            "value": item["value"],
            "weight": item["weight"],
            "contribution": item["value"] * item["weight"] / weight_sum,
        }
        for item in positive
    ]

    return {
        "metric": metric,
        "macro": {
            "value": macro_value,
            "applicable_count": macro_count,
            "not_applicable_count": not_applicable,
            "scoped_count": len(scoped),
            "contributions": macro_contributions,
        },
        "weighted": {
            "value": weighted_value,
            "applicable_count": len(positive),
            "not_applicable_count": not_applicable,
            "zero_weight_count": len(applicable) - len(positive),
            "scoped_count": len(scoped),
            "weight_sum": weight_sum,
            "contributions": weighted_contributions,
        },
    }


def format_metric(value: float | None, digits: int = 3) -> str | None:
    return None if value is None else f"{value:.{digits}f}"
