import { useCallback, useState } from "react";
import type { MetricKey, QueryRow } from "../lib/api";
import { fmt } from "../lib/format";
import { metricValue } from "../lib/aggregate";

interface Props {
  rows: QueryRow[];
  metric: MetricKey;
  labels: { a: string; b: string };
  currentQid: string | null;
  onSelect: (qid: string) => void;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export function DeltaChart({ rows, metric, labels, currentQid, onSelect }: Props) {
  const [hover, setHover] = useState<{ qid: string; x: number; y: number } | null>(null);

  const show = useCallback((qid: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setHover({ qid, x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const sorted = [...rows]
    .map((row) => {
      const a = metricValue(row, "a", metric, "standard");
      const b = metricValue(row, "b", metric, "standard");
      return { row, a, b, delta: a !== null && b !== null ? b - a : null };
    })
    .sort((left, right) => {
      const dl = left.delta;
      const dr = right.delta;
      if (dl === null && dr === null) return left.row.qid.localeCompare(right.row.qid);
      if (dl === null) return 1;
      if (dr === null) return -1;
      return dr - dl;
    });

  const hovered = hover ? sorted.find((item) => item.row.qid === hover.qid) : null;

  if (sorted.length === 0) {
    return <div className="chart-empty">没有共同覆盖的查询可比较。</div>;
  }

  return (
    <div className="chart-card">
      <div className="chart-legend">
        <span className="legend-item">
          <span className="legend-line" style={{ background: "var(--series-a)" }} />
          {labels.a}
        </span>
        <span className="legend-item">
          <span className="legend-line" style={{ background: "var(--series-b)" }} />
          {labels.b}
        </span>
        <span className="micro">按 B−A 从高到低排列 · 点一行进入该查询计算</span>

      </div>

      <div className="axis-row" style={{ marginTop: 4 }} aria-hidden="true">
        <span />
        <div className="axis-track">
          {TICKS.map((tick) => (
            <span
              key={tick}
              className="axis-tick"
              style={{
                left: tick === 0 ? 5 : tick === 1 ? "calc(100% - 5px)" : `calc(5px + ${tick} * (100% - 10px))`,
                transform: tick === 0 ? "none" : tick === 1 ? "translateX(-100%)" : "translateX(-50%)",
              }}
            >
              {tick.toFixed(2)}
            </span>
          ))}
        </div>
        <span />
      </div>

      <div className="dumbbell" role="list" aria-label={`${metric} 逐查询两版分数`}>
        {sorted.map((item) => {
          const { row, a, b } = item;
          const delta = item.delta ?? 0;
          const isCurrent = row.qid === currentQid;
          if (a === null || b === null) {
            return (
              <div className="dumbbell-row" key={row.qid} aria-current={isCurrent}>
                <div className="dumbbell-label">
                  <span className="dumbbell-qid">{row.qid}</span>
                  <span className="dumbbell-text">{row.text}</span>
                </div>
                <div className="dumbbell-hit" style={{ cursor: "default" }}>
                  <span className="micro">该指标不适用于此查询</span>
                </div>
                <span />
              </div>
            );
          }
          const left = Math.min(a, b);
          const right = Math.max(a, b);

          return (
            <div className="dumbbell-row" key={row.qid} aria-current={isCurrent}>
              <div className="dumbbell-label">
                <span className="dumbbell-qid">{row.qid}</span>
                <span className="dumbbell-text">{row.text}</span>
              </div>
              <button
                type="button"
                className="dumbbell-hit"
                aria-label={`${row.qid} ${row.text}：版本 A ${fmt(a)}，版本 B ${fmt(b)}，差值 ${fmt(
                  delta,
                )}`}
                title={`版本 A ${fmt(a)} · 版本 B ${fmt(b)} · 差值 ${fmt(delta)}`}
                onClick={() => onSelect(row.qid)}
                onMouseEnter={(event) => show(row.qid, event.currentTarget)}
                onMouseLeave={() => setHover(null)}
                onFocus={(event) => show(row.qid, event.currentTarget)}
                onBlur={() => setHover(null)}
              >
                <span className="dumbbell-track" />
                {Math.abs(b - a) > 0.001 && (
                  <span
                    className="dumbbell-segment"
                    style={{
                      left: `calc(5px + ${left} * (100% - 10px))`,
                      width: `calc(${right - left} * (100% - 10px))`,
                    }}
                  />
                )}
                <span className="dumbbell-dot a" style={{ left: `calc(5px + ${a} * (100% - 10px))` }} />
                <span className="dumbbell-dot b" style={{ left: `calc(5px + ${b} * (100% - 10px))` }} />
              </button>
              <span className="dumbbell-value">
                {delta >= 0 ? "+" : "−"}
                {Math.abs(delta).toFixed(3)}

              </span>
            </div>
          );
        })}
      </div>

      {hover && hovered && hovered.a !== null && hovered.b !== null && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: Math.max(8, Math.min(hover.x + 14, window.innerWidth - 230)),
            top: hover.y - 12,
            transform: "translateY(-100%)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            boxShadow: "var(--shadow)",
            padding: "9px 11px",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 60,
            minWidth: 190,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{hovered.row.qid}</div>
          <div className="micro" style={{ marginBottom: 6, whiteSpace: "normal", maxWidth: 240 }}>
            {hovered.row.text}
          </div>
          <TooltipRow color="var(--series-a)" name="版本 A" value={fmt(hovered.a)} />
          <TooltipRow color="var(--series-b)" name="版本 B" value={fmt(hovered.b)} />
          <div className="micro" style={{ marginTop: 4 }}>
            权重 {hovered.row.weight} · 差值 {fmt(hovered.delta)}
          </div>
        </div>
      )}
    </div>
  );
}

function TooltipRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 0" }}>
      <span style={{ width: 12, height: 2, background: color, borderRadius: 2, flex: "none" }} />
      <span className="micro" style={{ flex: 1 }}>
        {name}
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</span>
    </div>
  );
}
