"""SQLite persistence: schema, connection helpers and demo seeding."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "eval.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS evaluations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    k           INTEGER NOT NULL CHECK (k > 0),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queries (
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    qid           TEXT NOT NULL,
    text          TEXT NOT NULL DEFAULT '',
    grp           TEXT NOT NULL DEFAULT '',
    weight        REAL NOT NULL DEFAULT 1 CHECK (weight >= 0),
    seq           INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (evaluation_id, qid)
);

CREATE TABLE IF NOT EXISTS judgments (
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    qid           TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    grade         INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 3),
    PRIMARY KEY (evaluation_id, qid, doc_id),
    FOREIGN KEY (evaluation_id, qid) REFERENCES queries(evaluation_id, qid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rankings (
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    slot          TEXT NOT NULL CHECK (slot IN ('a', 'b')),
    label         TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (evaluation_id, slot)
);

CREATE TABLE IF NOT EXISTS results (
    evaluation_id INTEGER NOT NULL,
    slot          TEXT NOT NULL,
    qid           TEXT NOT NULL,
    doc_id        TEXT NOT NULL,
    rank          INTEGER NOT NULL CHECK (rank > 0),
    seq           INTEGER NOT NULL,
    PRIMARY KEY (evaluation_id, slot, qid, seq),
    FOREIGN KEY (evaluation_id, slot) REFERENCES rankings(evaluation_id, slot) ON DELETE CASCADE,
    FOREIGN KEY (evaluation_id, qid) REFERENCES queries(evaluation_id, qid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ranking_queries (
    evaluation_id INTEGER NOT NULL,
    slot          TEXT NOT NULL,
    qid           TEXT NOT NULL,
    PRIMARY KEY (evaluation_id, slot, qid),
    FOREIGN KEY (evaluation_id, slot) REFERENCES rankings(evaluation_id, slot) ON DELETE CASCADE,
    FOREIGN KEY (evaluation_id, qid) REFERENCES queries(evaluation_id, qid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_results_q ON results (evaluation_id, slot, qid, rank);
"""


def db_path() -> Path:
    return Path(os.environ.get("EVAL_DB_PATH", str(DEFAULT_DB)))


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    target = Path(path) if path is not None else db_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(target, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return None if row is None else dict(row)
