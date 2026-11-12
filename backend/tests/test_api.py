"""API-level tests covering imports, coverage rules and the report payload."""

from __future__ import annotations

import io
import os
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import db, demo  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    path = tmp_path / "test.db"
    os.environ["EVAL_DB_PATH"] = str(path)
    # Build the schema + demo before the app's lifespan runs; the lifespan will
    # see an existing evaluation and leave it alone.
    conn = db.connect(path)
    db.init_db(conn)
    demo.ensure_demo(conn)
    conn.close()
    with TestClient(app) as test_client:
        yield test_client


def test_meta_exposes_metric_rules(client):
    body = client.get("/api/meta").json()
    assert body["metrics"] == ["precision", "recall", "mrr", "ndcg"]
    assert body["grade_labels"]["0"] == "不相关"


def test_report_compares_only_shared_coverage(client):
    report = client.get("/api/evaluations/1/report").json()
    assert report["comparison"]["only_a"] == ["q08"]
    assert report["comparison"]["only_b"] == ["q09"]
    assert report["comparison"]["query_count"] == 7
    for query in report["queries"]:
        if query["qid"] in {"q08", "q09"}:
            assert query["comparable"] is False
            assert query["status"].startswith("仅由")


def test_empty_result_queries_survive(client):
    report = client.get("/api/evaluations/1/report").json()
    q06 = next(q for q in report["queries"] if q["qid"] == "q06")
    assert q06["covered"] == {"a": True, "b": True}
    assert q06["versions"]["a"]["standard"]["flags"]["empty"] is True
    assert q06["versions"]["a"]["standard"]["metrics"]["precision"]["value"] == 0.0


def test_weighted_average_excludes_zero_weight_and_inapplicable(client):
    report = client.get("/api/evaluations/1/report").json()
    recall_b = report["aggregates"]["b"]["recall"]["standard"]["weighted"]
    # q05 has weight 0; q07 has no judgments so recall is inapplicable.
    included = {item["qid"] for item in recall_b["contributions"]}
    assert "q05" not in included
    assert "q07" not in included
    assert recall_b["weight_sum"] == pytest.approx(1 + 1 + 2 + 1 + 1)


def test_import_queries_from_csv_keeps_first_duplicate(client):
    csv_text = "qid,text,group,weight\nn1,alpha,组一,1\nn1,dup,组一,1\nn2,beta,组二,3\n"
    response = client.post(
        "/api/evaluations/1/import/queries",
        files={"file": ("queries.csv", csv_text, "text/csv")},
    )
    assert response.status_code == 200
    queries = response.json()["queries"]
    assert [q["qid"] for q in queries] == ["n1", "n2"]
    assert queries[1]["weight"] == 3


def test_import_judgments_rejects_out_of_range_grade(client):
    response = client.post(
        "/api/evaluations/1/import/judgments",
        files={"file": ("j.csv", "qid,doc_id,grade\nn1,d1,4\n", "text/csv")},
    )
    assert response.status_code == 422


def test_import_ranking_supports_declared_empty_query(client):
    payload = (
        '{"results": [{"qid": "q01", "doc_id": "P01", "rank": 1},'
        ' {"qid": "q06", "results": []}]}'
    )
    response = client.post(
        "/api/evaluations/1/import/ranking/a",
        files={"file": ("rank.json", payload, "application/json")},
    )
    assert response.status_code == 200
    ranking = response.json()
    assert ranking["queries"] == ["q01", "q06"]
    assert ranking["results"]["q01"][0]["doc_id"] == "P01"


def test_import_ranking_rejects_unknown_query(client):
    response = client.post(
        "/api/evaluations/1/import/ranking/a",
        files={
            "file": ("rank.csv", "qid,doc_id,rank\nzzz,d1,1\n", "text/csv")
        },
    )
    assert response.status_code == 422


def test_k_change_recomputes_precision_denominator(client):
    before = client.get("/api/evaluations/1/report").json()["queries"][0]
    assert before["versions"]["a"]["standard"]["k"] == 5
    client.patch("/api/evaluations/1", json={"k": 10})
    after = client.get("/api/evaluations/1/report").json()["queries"][0]
    assert after["versions"]["a"]["standard"]["k"] == 10
    assert after["versions"]["a"]["standard"]["metrics"]["precision"]["denominator"] == 10


def test_report_requires_a_ranking(client):
    created = client.post("/api/evaluations", json={"name": "空白", "k": 3}).json()
    response = client.get(f"/api/evaluations/{created['id']}/report")
    assert response.status_code == 409
