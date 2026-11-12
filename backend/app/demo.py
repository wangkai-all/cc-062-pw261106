"""A worked demo evaluation that exercises every edge case the UI explains."""

from __future__ import annotations

from typing import Any

from . import services

DEMO_NAME = "示例：两版检索排序对比"
DEMO_K = 5

DEMO_QUERIES: list[dict[str, Any]] = [
    {"qid": "q01", "text": "蓝牙耳机 降噪", "grp": "数码", "weight": 1},
    {"qid": "q02", "text": "机械键盘 轴体", "grp": "数码", "weight": 1},
    {"qid": "q03", "text": "保温杯 不锈钢", "grp": "家居", "weight": 2},
    {"qid": "q04", "text": "儿童绘本 3-6 岁", "grp": "图书", "weight": 1},
    {"qid": "q05", "text": "跑步鞋 缓震", "grp": "运动", "weight": 0},
    {"qid": "q06", "text": "投影仪 4K", "grp": "数码", "weight": 1},
    {"qid": "q07", "text": "咖啡机 全自动", "grp": "家居", "weight": 1},
    {"qid": "q08", "text": "无线鼠标 静音", "grp": "数码", "weight": 1},
    {"qid": "q09", "text": "空气净化器 除甲醛", "grp": "家居", "weight": 1},
]

DEMO_JUDGMENTS: list[dict[str, Any]] = [
    # q01 — 有相关文档，两版都覆盖
    {"qid": "q01", "doc_id": "P01", "grade": 3},
    {"qid": "q01", "doc_id": "P02", "grade": 2},
    {"qid": "q01", "doc_id": "P03", "grade": 1},
    {"qid": "q01", "doc_id": "P04", "grade": 0},
    {"qid": "q01", "doc_id": "P05", "grade": 2},
    {"qid": "q01", "doc_id": "P06", "grade": 1},
    # q02 — 并列名次
    {"qid": "q02", "doc_id": "P07", "grade": 3},
    {"qid": "q02", "doc_id": "P08", "grade": 2},
    {"qid": "q02", "doc_id": "P09", "grade": 2},
    {"qid": "q02", "doc_id": "P10", "grade": 0},
    # q03 — 重复结果（权重 2）
    {"qid": "q03", "doc_id": "P14", "grade": 2},
    {"qid": "q03", "doc_id": "P15", "grade": 1},
    {"qid": "q03", "doc_id": "P16", "grade": 3},
    # q04 — 不足 K 条
    {"qid": "q04", "doc_id": "P19", "grade": 2},
    {"qid": "q04", "doc_id": "P20", "grade": 3},
    {"qid": "q04", "doc_id": "P21", "grade": 0},
    {"qid": "q04", "doc_id": "P22", "grade": 1},
    # q05 — 权重 0，只进普通平均
    {"qid": "q05", "doc_id": "P25", "grade": 2},
    {"qid": "q05", "doc_id": "P26", "grade": 1},
    {"qid": "q05", "doc_id": "P27", "grade": 3},
    # q06 — 两版都是空结果
    {"qid": "q06", "doc_id": "P29", "grade": 2},
    {"qid": "q06", "doc_id": "P30", "grade": 1},
    # q07 — 完全没有标注 → Recall / nDCG 不适用
    # q08 — 只有版本 A 覆盖
    {"qid": "q08", "doc_id": "P35", "grade": 2},
    {"qid": "q08", "doc_id": "P36", "grade": 1},
    # q09 — 只有版本 B 覆盖
    {"qid": "q09", "doc_id": "P38", "grade": 3},
    {"qid": "q09", "doc_id": "P39", "grade": 1},
]

DEMO_A_LABEL = "版本 A：BM25 基线"
DEMO_B_LABEL = "版本 B：语义召回混合"

DEMO_RANKINGS: dict[str, list[dict[str, Any]]] = {
    "a": [
        # q01
        {"qid": "q01", "doc_id": "P01", "rank": 1},
        {"qid": "q01", "doc_id": "P04", "rank": 2},
        {"qid": "q01", "doc_id": "P90", "rank": 3},
        {"qid": "q01", "doc_id": "P02", "rank": 4},
        {"qid": "q01", "doc_id": "P03", "rank": 5},
        {"qid": "q01", "doc_id": "P05", "rank": 6},
        {"qid": "q01", "doc_id": "P06", "rank": 7},
        # q02 — P08 与 P09 并列第 2
        {"qid": "q02", "doc_id": "P07", "rank": 1},
        {"qid": "q02", "doc_id": "P09", "rank": 2},
        {"qid": "q02", "doc_id": "P08", "rank": 2},
        {"qid": "q02", "doc_id": "P91", "rank": 4},
        {"qid": "q02", "doc_id": "P10", "rank": 5},
        # q03 — P14 在第 1、2 名重复
        {"qid": "q03", "doc_id": "P14", "rank": 1},
        {"qid": "q03", "doc_id": "P14", "rank": 2},
        {"qid": "q03", "doc_id": "P16", "rank": 3},
        {"qid": "q03", "doc_id": "P15", "rank": 4},
        # q04 — 只有 4 条，不足 K
        {"qid": "q04", "doc_id": "P20", "rank": 1},
        {"qid": "q04", "doc_id": "P22", "rank": 2},
        {"qid": "q04", "doc_id": "P19", "rank": 3},
        {"qid": "q04", "doc_id": "P92", "rank": 4},
        # q05
        {"qid": "q05", "doc_id": "P25", "rank": 1},
        {"qid": "q05", "doc_id": "P26", "rank": 2},
        {"qid": "q05", "doc_id": "P27", "rank": 3},
        # q06 — 空结果
        # q07 — 没有标注
        {"qid": "q07", "doc_id": "P31", "rank": 1},
        {"qid": "q07", "doc_id": "P32", "rank": 2},
        # q08 — 只有 A 覆盖
        {"qid": "q08", "doc_id": "P36", "rank": 1},
        {"qid": "q08", "doc_id": "P35", "rank": 2},
        {"qid": "q08", "doc_id": "P93", "rank": 3},
    ],
    "b": [
        # q01
        {"qid": "q01", "doc_id": "P94", "rank": 1},
        {"qid": "q01", "doc_id": "P05", "rank": 2},
        {"qid": "q01", "doc_id": "P03", "rank": 3},
        {"qid": "q01", "doc_id": "P01", "rank": 4},
        {"qid": "q01", "doc_id": "P04", "rank": 5},
        {"qid": "q01", "doc_id": "P02", "rank": 6},
        {"qid": "q01", "doc_id": "P06", "rank": 7},
        # q02 — 大量未标注
        {"qid": "q02", "doc_id": "P08", "rank": 1},
        {"qid": "q02", "doc_id": "P07", "rank": 2},
        {"qid": "q02", "doc_id": "P95", "rank": 3},
        {"qid": "q02", "doc_id": "P96", "rank": 4},
        {"qid": "q02", "doc_id": "P97", "rank": 5},
        # q03 — P14 在第 3、4 名重复
        {"qid": "q03", "doc_id": "P16", "rank": 1},
        {"qid": "q03", "doc_id": "P98", "rank": 2},
        {"qid": "q03", "doc_id": "P14", "rank": 3},
        {"qid": "q03", "doc_id": "P14", "rank": 4},
        {"qid": "q03", "doc_id": "P15", "rank": 5},
        {"qid": "q03", "doc_id": "P99", "rank": 6},
        # q04 — 只有 3 条，全不相关 / 未标注
        {"qid": "q04", "doc_id": "P21", "rank": 1},
        {"qid": "q04", "doc_id": "P9A", "rank": 2},
        {"qid": "q04", "doc_id": "P9B", "rank": 3},
        # q05
        {"qid": "q05", "doc_id": "P26", "rank": 1},
        {"qid": "q05", "doc_id": "P9C", "rank": 2},
        {"qid": "q05", "doc_id": "P25", "rank": 3},
        {"qid": "q05", "doc_id": "P27", "rank": 4},
        # q06 — 空结果
        # q07 — 没有标注
        {"qid": "q07", "doc_id": "P33", "rank": 1},
        {"qid": "q07", "doc_id": "P34", "rank": 2},
        # q09 — 只有 B 覆盖
        {"qid": "q09", "doc_id": "P38", "rank": 1},
        {"qid": "q09", "doc_id": "P39", "rank": 2},
    ],
}

DEMO_COVERED = {
    "a": ["q01", "q02", "q03", "q04", "q05", "q06", "q07", "q08"],
    "b": ["q01", "q02", "q03", "q04", "q05", "q06", "q07", "q09"],
}


def seed_into(conn, evaluation_id: int) -> None:
    services.set_queries(conn, evaluation_id, DEMO_QUERIES)
    services.set_judgments(conn, evaluation_id, DEMO_JUDGMENTS)
    for slot, label in (("a", DEMO_A_LABEL), ("b", DEMO_B_LABEL)):
        services.set_ranking(
            conn,
            evaluation_id,
            slot,
            label=label,
            rows=DEMO_RANKINGS[slot],
            covered_qids=DEMO_COVERED[slot],
        )


def ensure_demo(conn) -> None:
    if services.list_evaluations(conn):
        return
    evaluation = services.create_evaluation(conn, name=DEMO_NAME, k=DEMO_K)
    seed_into(conn, evaluation["id"])
