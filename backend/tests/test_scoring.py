"""Unit tests for the ranking normalisation and metric rules."""

from __future__ import annotations

import math

import pytest

from app.scoring import (
    RawResult,
    aggregate_scores,
    evaluate_query,
    normalize_rankings,
)


def metrics_of(block):
    return {name: block["metrics"][name]["value"] for name in
            ("precision", "recall", "mrr", "ndcg")}


def test_rank_sort_dedup_and_renumber():
    norm = normalize_rankings(
        [
            RawResult("d2", 2, 0),
            RawResult("d1", 1, 1),
            RawResult("d2", 3, 2),
            RawResult("d3", 2, 3),
        ],
        k=5,
    )
    assert [entry["doc_id"] for entry in norm["kept"]] == ["d1", "d2", "d3"]
    assert [entry["rank"] for entry in norm["kept"]] == [1, 2, 3]
    assert norm["duplicates"] == [
        {"doc_id": "d2", "rank": 3, "seq": 2, "tie": True}
    ]
    assert norm["ties"] == [{"rank": 2, "doc_ids": ["d2", "d3"]}]
    assert norm["counts"]["scored"] == 3


def test_rank_tie_broken_by_doc_id_not_input_order():
    first = normalize_rankings([RawResult("b", 1, 0), RawResult("a", 1, 1)], k=2)
    second = normalize_rankings([RawResult("a", 1, 0), RawResult("b", 1, 1)], k=2)
    assert [e["doc_id"] for e in first["kept"]] == ["a", "b"]
    assert [e["doc_id"] for e in second["kept"]] == ["a", "b"]


def test_precision_divides_by_k_even_when_fewer_returned():
    evaluation = evaluate_query(
        raw_results=[RawResult("d1", 1), RawResult("d2", 2)],
        judgments={"d1": 3, "d2": 0},
        k=5,
    )
    assert metrics_of(evaluation["standard"])["precision"] == pytest.approx(0.2)
    assert evaluation["standard"]["flags"]["insufficient"] is True


def test_recall_divides_by_all_known_relevant_documents():
    evaluation = evaluate_query(
        raw_results=[RawResult("d1", 1), RawResult("d2", 2), RawResult("d3", 3)],
        judgments={"d1": 2, "d2": 3, "d4": 1, "d5": 0},
        k=3,
    )
    assert metrics_of(evaluation["standard"])["recall"] == pytest.approx(2 / 3)


def test_mrr_is_zero_when_no_relevant_in_top_k():
    evaluation = evaluate_query(
        raw_results=[RawResult("x1", 1), RawResult("x2", 2), RawResult("d1", 3)],
        judgments={"d1": 3},
        k=2,
    )
    assert metrics_of(evaluation["standard"])["mrr"] == 0.0


def test_mrr_uses_first_relevant_position():
    evaluation = evaluate_query(
        raw_results=[RawResult("a", 1), RawResult("b", 2), RawResult("c", 3)],
        judgments={"b": 1, "c": 3},
        k=3,
    )
    assert metrics_of(evaluation["standard"])["mrr"] == pytest.approx(1 / 2)


def test_no_known_relevant_marks_recall_and_ndcg_inapplicable_but_mrr_zero():
    evaluation = evaluate_query(
        raw_results=[RawResult("a", 1), RawResult("b", 2)],
        judgments={},
        k=3,
    )
    standard = evaluation["standard"]
    assert standard["metrics"]["precision"]["value"] == 0.0
    assert standard["metrics"]["recall"]["applicable"] is False
    assert standard["metrics"]["recall"]["value"] is None
    assert standard["metrics"]["ndcg"]["applicable"] is False
    assert standard["metrics"]["ndcg"]["value"] is None
    assert standard["metrics"]["mrr"]["value"] == 0.0


def test_ndcg_gain_and_discount_formula():
    evaluation = evaluate_query(
        raw_results=[
            RawResult("high", 1),
            RawResult("low", 2),
        ],
        judgments={"high": 3, "low": 1},
        k=2,
    )
    standard = evaluation["standard"]
    dcg = 7 / math.log2(2) + 1 / math.log2(3)
    idcg = 7 / math.log2(2) + 1 / math.log2(3)
    assert standard["dcg"] == pytest.approx(dcg)
    assert standard["metrics"]["ndcg"]["value"] == pytest.approx(min(1.0, dcg / idcg))
    # Swap order: the low-graded doc first must score lower.
    swapped = evaluate_query(
        raw_results=[RawResult("low", 1), RawResult("high", 2)],
        judgments={"high": 3, "low": 1},
        k=2,
    )
    assert (
        swapped["standard"]["metrics"]["ndcg"]["value"]
        < standard["metrics"]["ndcg"]["value"]
    )


def test_ndcg_ideal_uses_all_labeled_docs_not_only_retrieved():
    evaluation = evaluate_query(
        raw_results=[RawResult("a", 1)],
        judgments={"a": 1, "b": 3, "c": 2},
        k=2,
    )
    # Retrieved DCG = 1; ideal top-2 = grades 3, 2.
    assert evaluation["standard"]["idcg"] == pytest.approx(
        7 / math.log2(2) + 3 / math.log2(3)
    )
    assert evaluation["standard"]["metrics"]["ndcg"]["value"] < 0.15


def test_unlabeled_docs_contribute_zero_and_share_is_reported():
    evaluation = evaluate_query(
        raw_results=[RawResult("a", 1), RawResult("u1", 2), RawResult("u2", 3), RawResult("b", 4)],
        judgments={"a": 3, "b": 1},
        k=4,
    )
    standard = evaluation["standard"]
    assert standard["unlabeled"]["count"] == 2
    assert standard["unlabeled"]["share"] == pytest.approx(0.5)
    # Gain from the two labeled docs only.
    assert standard["dcg"] == pytest.approx(7 / math.log2(2) + 1 / math.log2(5))
    # Precision counts only relevant labeled docs.
    assert standard["metrics"]["precision"]["value"] == pytest.approx(2 / 4)


def test_auxiliary_drops_unlabeled_then_renumbers_then_cuts_at_k():
    evaluation = evaluate_query(
        raw_results=[
            RawResult("u1", 1),
            RawResult("d1", 2),
            RawResult("u2", 3),
            RawResult("d2", 4),
            RawResult("d3", 5),
        ],
        judgments={"d1": 3, "d2": 1, "d3": 2},
        k=2,
    )
    auxiliary = evaluation["auxiliary"]
    assert [row["doc_id"] for row in auxiliary["docs"]] == ["d1", "d2"]
    assert [row["rank"] for row in auxiliary["docs"]] == [1, 2]
    assert auxiliary["dropped_unlabeled"] == ["u1", "u2"]
    assert metrics_of(evaluation["standard"])["mrr"] == pytest.approx(1 / 2)
    assert metrics_of(auxiliary)["mrr"] == pytest.approx(1 / 1)
    assert evaluation["standard"]["unlabeled"]["share"] == pytest.approx(0.5)
    assert auxiliary["unlabeled"]["share"] == 0.0


def test_duplicate_doc_kept_once_at_first_occurrence():
    evaluation = evaluate_query(
        raw_results=[
            RawResult("dup", 1),
            RawResult("other", 2),
            RawResult("dup", 3),
        ],
        judgments={"dup": 3},
        k=3,
    )
    assert [row["doc_id"] for row in evaluation["standard"]["docs"]] == ["dup", "other"]
    assert evaluation["standard"]["duplicates"][0]["rank"] == 3
    assert metrics_of(evaluation["standard"])["mrr"] == 1.0


def test_empty_results_are_scored_as_zero_but_kept():
    evaluation = evaluate_query(raw_results=[], judgments={"d": 2}, k=3)
    assert evaluation["standard"]["docs"] == []
    assert evaluation["standard"]["flags"]["empty"] is True
    assert metrics_of(evaluation["standard"])["precision"] == 0.0
    assert metrics_of(evaluation["standard"])["recall"] == 0.0
    assert metrics_of(evaluation["standard"])["ndcg"] == 0.0


def test_invalid_k_rejected():
    with pytest.raises(ValueError):
        normalize_rankings([], k=0)


def test_weighted_average_only_includes_positive_weights_and_applicable():
    rows = [
        {"qid": "a", "value": 0.5, "weight": 2.0},
        {"qid": "b", "value": 1.0, "weight": 1.0},
        {"qid": "c", "value": None, "weight": 3.0},
        {"qid": "d", "value": 0.0, "weight": 0.0},
    ]
    result = aggregate_scores(
        rows=rows,
        metric="precision",
        value_getter=lambda row: row["value"],
        weight_getter=lambda row: row["weight"],
    )
    assert result["macro"]["value"] == pytest.approx(0.5)
    assert result["macro"]["applicable_count"] == 3
    assert result["macro"]["not_applicable_count"] == 1
    assert result["weighted"]["applicable_count"] == 2
    assert result["weighted"]["weight_sum"] == pytest.approx(3.0)
    assert result["weighted"]["value"] == pytest.approx((0.5 * 2 + 1.0 * 1) / 3)
    assert result["weighted"]["zero_weight_count"] == 1


def test_negative_weight_is_clamped_to_zero():
    result = aggregate_scores(
        rows=[{"qid": "a", "value": 1.0, "weight": -2}],
        metric="precision",
        value_getter=lambda row: row["value"],
        weight_getter=lambda row: row["weight"],
    )
    assert result["weighted"]["value"] is None
    assert result["weighted"]["weight_sum"] == 0.0
