import { useState } from "react";
import type { MetricKey, Report, Slot, ViewKey } from "../lib/api";
import { fmt } from "../lib/format";
import { DeltaPill } from "./ui";

interface Props {
  report: Report;
  view: ViewKey;
  onOpen: (metric: MetricKey) => void;
}

const METRIC_ORDER: MetricKey[] = ["precision", "recall", "mrr", "ndcg"];

export function SummaryMetrics({ report, view, onOpen }: Props) {
  return (
    <div className="metrics-grid">
      {METRIC_ORDER.map((metric) => {
        const a = report.aggregates.a[metric][view];
        const b = report.aggregates.b[metric][view];
        const macroDelta = report.deltas[metric][view].macro;
        const weightedDelta = report.deltas[metric][view].weighted;
        return (
          <div className="metric-block" key={metric}>
            <div className="metric-block-head">
              <span className="metric-name">{report.metric_labels[metric]}</span>
              <span className="metric-formula-hint">{FORMULA_HINT[metric]}</span>
            </div>
            <div className="score-lines">
              <div className="score-line score-line-head">
                <span />
                <span style={{ textAlign: "right" }}>普通平均</span>
                <span style={{ textAlign: "right" }}>权重平均</span>
              </div>
              <ScoreLine slot="a" aggregate={a} />
              <ScoreLine slot="b" aggregate={b} />
              <div className="score-line">
                <span className="score-basis">B − A</span>
                <span className="score-cell">
                  <DeltaPill value={macroDelta.delta} />
                </span>
                <span className="score-cell">
                  <DeltaPill value={weightedDelta.delta} />
                </span>
              </div>
            </div>
            <div className="basis-row">
              <span className="basis-pill">
                普通：{a.macro.applicable_count}/{a.macro.scoped_count} 适用
              </span>
              <span className="basis-pill">
                加权：{a.weighted.applicable_count} 查询 · Σ权重 {fmt(a.weighted.weight_sum ?? 0)}
              </span>
            </div>
            <button className="btn" onClick={() => onOpen(metric)}>
              展开计算
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ScoreLine({
  slot,
  aggregate,
}: {
  slot: Slot;
  aggregate: {
    macro: { value: number | null };
    weighted: { value: number | null };
  };
}) {
  const key = slot === "a" ? "key-a" : "key-b";
  return (
    <div className="score-line">
      <span className="score-basis">
        <span className={`score-key ${key}`} style={{ display: "inline-block", marginRight: 5 }} />
        版本 {slot.toUpperCase()}
      </span>
      <span className="score-cell">
        <span className={`score-value ${aggregate.macro.value === null ? "null" : ""}`}>
          {fmt(aggregate.macro.value)}
        </span>
      </span>
      <span className="score-cell">
        <span className={`score-value ${aggregate.weighted.value === null ? "null" : ""}`}>
          {fmt(aggregate.weighted.value)}
        </span>
      </span>
    </div>
  );
}

export const FORMULA_HINT: Record<MetricKey, string> = {
  precision: "相关@K ÷ K",
  recall: "相关@K ÷ 已知相关",
  mrr: "1 ÷ 首个相关名次",
  ndcg: "DCG ÷ 理想 DCG",
};

export function useExpanded() {
  const [expanded, setExpanded] = useState<MetricKey | null>(null);
  return { expanded, setExpanded };
}
