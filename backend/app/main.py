"""FastAPI app: evaluation settings, imports, and per-query scoring."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import db, demo, services
from .scoring import METRICS, METRIC_LABELS


class EvaluationIn(BaseModel):
    name: str = "评测"
    k: int = Field(default=10, ge=1, le=1000)


class EvaluationPatch(BaseModel):
    name: str | None = None
    k: int | None = Field(default=None, ge=1, le=1000)


class QueryIn(BaseModel):
    qid: str
    text: str = ""
    grp: str = ""
    weight: float = 1.0


class QuerySetIn(BaseModel):
    queries: list[QueryIn]


class QueryPatch(BaseModel):
    grp: str | None = None
    weight: float | None = None


class JudgmentIn(BaseModel):
    qid: str
    doc_id: str
    grade: int = Field(ge=0, le=3)


class JudgmentSetIn(BaseModel):
    judgments: list[JudgmentIn]


class RankingIn(BaseModel):
    label: str
    results: list[dict]
    covered_qids: list[str] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = db.connect()
    db.init_db(conn)
    demo.ensure_demo(conn)
    conn.close()
    yield


app = FastAPI(title="检索排序评测", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _conn():
    conn = db.connect()
    db.init_db(conn)
    try:
        yield conn
    finally:
        conn.close()


def get_conn(conn=Depends(_conn)):
    return conn


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    return {
        "metrics": list(METRICS),
        "metric_labels": METRIC_LABELS,
        "grade_labels": services.GRADE_LABELS,
        "slots": list(services.SLOTS),
    }


@app.get("/api/evaluations")
def list_evaluations(conn=Depends(get_conn)):
    items = services.list_evaluations(conn)
    return {"evaluations": items}


@app.post("/api/evaluations", status_code=201)
def create_evaluation(payload: EvaluationIn, conn=Depends(get_conn)):
    return services.create_evaluation(conn, name=payload.name, k=payload.k)


@app.get("/api/evaluations/{evaluation_id}")
def get_evaluation(evaluation_id: int, conn=Depends(get_conn)):
    return services._get_evaluation(conn, evaluation_id)


@app.patch("/api/evaluations/{evaluation_id}")
def patch_evaluation(
    evaluation_id: int, payload: EvaluationPatch, conn=Depends(get_conn)
):
    return services.update_evaluation(
        conn, evaluation_id, name=payload.name, k=payload.k
    )


@app.delete("/api/evaluations/{evaluation_id}", status_code=204)
def delete_evaluation(evaluation_id: int, conn=Depends(get_conn)):
    services.delete_evaluation(conn, evaluation_id)


@app.get("/api/evaluations/{evaluation_id}/queries")
def get_queries(evaluation_id: int, conn=Depends(get_conn)):
    return {"queries": services.list_queries(conn, evaluation_id)}


@app.put("/api/evaluations/{evaluation_id}/queries")
def put_queries(evaluation_id: int, payload: QuerySetIn, conn=Depends(get_conn)):
    return {
        "queries": services.set_queries(
            conn, evaluation_id, [item.model_dump() for item in payload.queries]
        )
    }


@app.patch("/api/evaluations/{evaluation_id}/queries/{qid}")
def patch_query(
    evaluation_id: int, qid: str, payload: QueryPatch, conn=Depends(get_conn)
):
    return services.update_query(
        conn, evaluation_id, qid, grp=payload.grp, weight=payload.weight
    )


@app.get("/api/evaluations/{evaluation_id}/judgments")
def get_judgments(evaluation_id: int, conn=Depends(get_conn)):
    return {"judgments": services.list_judgments(conn, evaluation_id)}


@app.put("/api/evaluations/{evaluation_id}/judgments")
def put_judgments(evaluation_id: int, payload: JudgmentSetIn, conn=Depends(get_conn)):
    return {
        "judgments": services.set_judgments(
            conn, evaluation_id, [item.model_dump() for item in payload.judgments]
        )
    }


@app.get("/api/evaluations/{evaluation_id}/ranking/{slot}")
def get_ranking(evaluation_id: int, slot: str, conn=Depends(get_conn)):
    return services.get_ranking(conn, evaluation_id, slot)


@app.put("/api/evaluations/{evaluation_id}/ranking/{slot}")
def put_ranking(
    evaluation_id: int, slot: str, payload: RankingIn, conn=Depends(get_conn)
):
    return services.set_ranking(
        conn,
        evaluation_id,
        slot,
        label=payload.label,
        rows=payload.results,
        covered_qids=payload.covered_qids,
    )


@app.post("/api/evaluations/{evaluation_id}/import/queries")
async def import_queries(
    evaluation_id: int, file: UploadFile, conn=Depends(get_conn)
):
    text = (await file.read()).decode("utf-8-sig")
    queries = services.parse_query_import(text)
    return {"queries": services.set_queries(conn, evaluation_id, queries)}


@app.post("/api/evaluations/{evaluation_id}/import/judgments")
async def import_judgments(
    evaluation_id: int, file: UploadFile, conn=Depends(get_conn)
):
    text = (await file.read()).decode("utf-8-sig")
    judgments = services.parse_judgment_import(text)
    return {"judgments": services.set_judgments(conn, evaluation_id, judgments)}


@app.post("/api/evaluations/{evaluation_id}/import/ranking/{slot}")
async def import_ranking(
    evaluation_id: int, slot: str, file: UploadFile, conn=Depends(get_conn)
):
    text = (await file.read()).decode("utf-8-sig")
    rows, covered = services.parse_ranking_import(text)
    label = file.filename.rsplit(".", 1)[0] if file.filename else f"版本 {slot.upper()}"
    return services.set_ranking(
        conn,
        evaluation_id,
        slot,
        label=label,
        rows=rows,
        covered_qids=covered,
    )


@app.get("/api/evaluations/{evaluation_id}/report")
def report(evaluation_id: int, conn=Depends(get_conn)):
    return services.compute_evaluation(conn, evaluation_id)


@app.post("/api/evaluations/{evaluation_id}/seed-demo")
def seed_demo(evaluation_id: int, conn=Depends(get_conn)):
    demo.seed_into(conn, evaluation_id)
    return {"ok": True}
