import { useEffect, useState } from "react";
import type { AggregateView, MetricKey, QueryRow, Report, Slot, ViewKey } from "../lib/api";
import { aggregate } from "../lib/aggregate";
import { fmt, fmtWeight } from "../lib/format";
import { Tabs } from "./ui";

interface Props {
  report: Report;
  rows: QueryRow[];
  metric: MetricKey;
  view: ViewKey;
  onClose: () => void;
  onOpenQuery: (qid: string) => void;
}

type Basis = "macro" | "weighted";

export function ContributionSheet({
  report,
  rows,
  metric,
  view,
  onClose,
  onOpenQuery,
}: Props) {
  const [basis, setBasis] = useState<Basis>("macro");

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const a = aggregate(rows, "a", metric, view);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${report.metric_labels[metric]} 计算展开`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h3 className="sheet-title">{report.metric_labels[metric]} · 平均计算</h3>
            <p className="sheet-sub">
              只统计两版共同覆盖的 {rows.length} 个查询 ·{" "}
              {view === "auxiliary" ? "辅助分数（先剔除未标注）" : "标准分数"}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <Tabs
            ariaLabel="平均方式"
            value={basis}
            onChange={setBasis}
            options={[
              { value: "macro" as Basis, label: "普通平均" },
              { value: "weighted" as Basis, label: "权重平均" },
            ]}
          />
          <div className="sheet-formula">{FORMULAS[metric]}</div>
          <div className="micro">
            {basis === "macro"
              ? "普通平均：每个适用查询等权，分母为适用查询数。权重为 0 的查询照常计入。"
              : "权重平均：仅纳入适用且权重 > 0 的查询，分母为这些查询的权重之和。"}
          </div>
          {(["a", "b"] as Slot[]).map((slot) => (
            <SlotBlock
              key={slot}
              slot={slot}
              label={report.labels[slot]}
              data={basis === "macro" ? a.macro : a.weighted}
              basis={basis}
              onOpenQuery={onOpenQuery}
            />
          ))}
          <div className="hint">点查询编号可跳到该查询逐名次的完整计算。</div>
        </div>
      </div>
    </div>
  );
}

function SlotBlock({
  slot,
  label,
  data,
  basis,
  onOpenQuery,
}: {
  slot: Slot;
  label: string;
  data: AggregateView;
  basis: Basis;
  onOpenQuery: (qid: string) => void;
}) {
  const total = data.contributions.reduce((acc, item) => acc + item.contribution, 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span
          className={`score-key ${slot === "a" ? "key-a" : "key-b"}`}
          style={{ display: "inline-block" }}
        />
        <span style={{ fontWeight: 650, fontSize: 13 }}>{label}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 20,
            fontWeight: 650,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmt(data.value)}
        </span>
      </div>
      <div className="micro" style={{ marginBottom: 6 }}>
        {basis === "macro"
          ? `适用 ${data.applicable_count} 个查询；不适用 ${data.not_applicable_count} 个 · 分母 ${data.applicable_count}`
          : `纳入 ${data.applicable_count} 个查询；权重为 0 或不适用的 ${data.zero_weight_count ?? 0} 个不计 · 分母（权重和）${fmtWeight(data.weight_sum ?? 0)}`}
      </div>
      <table className="contrib-table">
        <thead>
          <tr>
            <th>查询</th>
            <th>分数</th>
            <th>权重</th>
            <th>系数</th>
            <th>贡献</th>
          </tr>
        </thead>
        <tbody>
          {data.contributions.map((item) => {
            const coefficient =
              basis === "macro"
                ? 1 / (data.applicable_count || 1)
                : item.weight / (data.weight_sum || 1);
            return (
              <tr key={item.qid}>
                <td>
                  <button className="contrib-link" onClick={() => onOpenQuery(item.qid)}>
                    {item.qid}
                  </button>
                </td>
                <td>{fmt(item.value)}</td>
                <td>{fmtWeight(item.weight)}</td>
                <td>{coefficient.toFixed(4)}</td>
                <td>{item.contribution.toFixed(4)}</td>
              </tr>
            );
          })}
          {data.contributions.length === 0 && (
            <tr>
              <td colSpan={5} className="micro">
                {basis === "weighted"
                  ? "没有「适用且权重大于 0」的查询，权重平均不适用。"
                  : "没有适用查询。"}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {data.contributions.length > 0 && (
        <div className="sum-row">
          <span className="micro">
            贡献 = 分数 × 系数
            {basis === "weighted" ? `；Σ权重 = ${fmtWeight(data.weight_sum ?? 0)}` : ""}
          </span>
          <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="micro">合计</span>
            <b>{total.toFixed(4)}</b>
          </span>
        </div>
      )}
    </div>
  );
}

const FORMULAS: Record<MetricKey, string> = {
  precision: "Precision@K = 前 K 名中相关性 ≥ 1 的结果数 ÷ K（不足 K 条时分母仍为 K）",
  recall: "Recall@K = 前 K 名中相关性 ≥ 1 的结果数 ÷ 该查询全部已知相关文档数（无相关文档时不适用）",
  mrr: "MRR@K = 1 ÷ 前 K 名中首个相关结果的名次；前 K 没有相关结果时记 0",
  ndcg: "nDCG@K = Σ(2^相关性 − 1)/log2(名次+1) ÷ 理想顺序前 K 的同一合计；无相关文档时不适用",
};
