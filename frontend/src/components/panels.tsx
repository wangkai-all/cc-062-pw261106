import { useEffect, useMemo, useState } from "react";
import { api, type EvaluationSummary, type MetricKey, type QueryRow, type Report, type ViewKey } from "../lib/api";
import { FLAG_LABELS, FLAG_ORDER, metricValue } from "../lib/aggregate";
import { fmt, gradeLabel } from "../lib/format";
import { Tabs } from "./ui";

interface Props {
  report: Report;
  rows: QueryRow[];
  onChanged: () => void;
}

interface Draft {
  grp: string;
  weight: string;
}

export function GroupWeightEditor({ report, rows, onChanged }: Props) {
  const [groupFilter, setGroupFilter] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const groups = useMemo(
    () => [...new Set(rows.map((row) => row.grp).filter(Boolean))].sort(),
    [rows],
  );

  const visible = report.queries.filter((row) => !groupFilter || row.grp === groupFilter);

  const commit = async (qid: string) => {
    const row = report.queries.find((item) => item.qid === qid);
    const draft = drafts[qid];
    if (!row || !draft) return;
    const weight = Number(draft.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      alert("权重必须是非负数");
      return;
    }
    const body: { grp?: string; weight?: number } = {};
    if (draft.grp !== row.grp) body.grp = draft.grp;
    if (weight !== row.weight) body.weight = weight;
    if (Object.keys(body).length === 0) return;
    setSaving(qid);
    try {
      await api.patchQuery(report.evaluation.id, qid, body);
      setDrafts((current) => {
        const next = { ...current };
        delete next[qid];
        return next;
      });
      onChanged();
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">分组与权重</h2>
        <span className="eyebrow">Weights</span>
      </div>
      <div className="rail-section">
        <div className="field">
          <label htmlFor="group-filter">筛选分组</label>
          <input
            id="group-filter"
            className="input"
            list="group-options"
            placeholder="全部"
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
          />
          <datalist id="group-options">
            {groups.map((group) => (
              <option key={group} value={group} />
            ))}
          </datalist>
        </div>
        <div className="group-edit">
          {visible.map((row) => {
            const draft = drafts[row.qid] ?? {
              grp: row.grp,
              weight: String(row.weight),
            };
            return (
              <div className="group-edit-row" key={row.qid}>
                <span className="qid" title={`${row.qid} ${row.text}`}>
                  {row.qid}
                </span>
                <input
                  className="input group-input"
                  aria-label={`${row.qid} 分组`}
                  placeholder="分组"
                  value={draft.grp}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.qid]: { ...draft, grp: event.target.value },
                    }))
                  }
                  onBlur={() => void commit(row.qid)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commit(row.qid);
                  }}
                />
                <input
                  className="input weight-input"
                  aria-label={`${row.qid} 权重`}
                  type="number"
                  min={0}
                  step={"any" as unknown as number}
                  value={draft.weight}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [row.qid]: { ...draft, weight: event.target.value },
                    }))
                  }
                  onBlur={() => void commit(row.qid)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void commit(row.qid);
                  }}
                  title={saving === row.qid ? "保存中…" : "非负权重"}
                />
              </div>
            );
          })}
        </div>
        <div className="hint">
          回车或离开输入框即保存。权重 0 仍参与普通平均，但不进入权重平均。
        </div>
      </div>
    </div>
  );
}

export function MetricSwitcher({
  value,
  onChange,
  labels,
}: {
  value: MetricKey;
  onChange: (metric: MetricKey) => void;
  labels: Record<MetricKey, string>;
}) {
  return (
    <Tabs
      ariaLabel="图表指标"
      value={value}
      onChange={onChange}
      options={(["precision", "recall", "mrr", "ndcg"] as MetricKey[]).map((metric) => ({
        value: metric,
        label: labels[metric],
      }))}
    />
  );
}

export function ViewSwitcher({
  value,
  onChange,
}: {
  value: ViewKey;
  onChange: (view: ViewKey) => void;
}) {
  return (
    <Tabs
      ariaLabel="分数视图"
      value={value}
      onChange={onChange}
      options={[
        { value: "standard" as ViewKey, label: "标准分数" },
        { value: "auxiliary" as ViewKey, label: "辅助分数" },
      ]}
    />
  );
}

export function CoverageCard({ report }: { report: Report }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">覆盖与分组</h2>
        <span className="micro">比较只用两版共同覆盖的查询</span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="chip-row">
          <span className="chip good">共同覆盖 {report.comparison.query_count}</span>
          {report.comparison.only_a.length > 0 && (
            <span className="chip warn">
              仅 A：{report.comparison.only_a.join("、")}
            </span>
          )}
          {report.comparison.only_b.length > 0 && (
            <span className="chip warn">
              仅 B：{report.comparison.only_b.join("、")}
            </span>
          )}
          {report.comparison.query_count === 0 && (
            <span className="chip bad">没有两版共同覆盖的查询</span>
          )}
        </div>
        {report.comparison.groups.length > 0 && (
          <div className="chip-row">
            {report.comparison.groups.map((group) => (
              <span className="chip" key={group.group}>
                {group.group} · {group.count} 查询 · 权重和 {group.weights}
              </span>
            ))}
          </div>
        )}
        {Object.keys(report.flags_summary).length > 0 && (
          <div className="chip-row">
            {FLAG_ORDER.filter((flag) => (`standard.${flag}` in report.flags_summary) || (`auxiliary.${flag}` in report.flags_summary)).map((flag) => {
              const standard = report.flags_summary[`standard.${flag}`] ?? 0;
              const auxiliary = report.flags_summary[`auxiliary.${flag}`] ?? 0;
              return (
                <span className="chip" key={flag} title="标准视图 / 辅助视图下的查询数">
                  {FLAG_LABELS[flag] ?? flag} {standard}
                  {auxiliary > 0 && ` / 辅助 ${auxiliary}`}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function QueryJumpList({
  report,
  onSelect,
}: {
  report: Report;
  onSelect: (qid: string) => void;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">全部查询</h2>
        <span className="micro">{report.queries.length} 个（含空结果与未覆盖）</span>
      </div>
      <div className="card-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {report.queries.map((row) => {
          const value = metricValue(row, "b", "ndcg", "standard");
          const valueA = metricValue(row, "a", "ndcg", "standard");
          return (
            <button
              key={row.qid}
              className="jump-row"
              onClick={() => onSelect(row.qid)}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "baseline",
                gap: 8,
                padding: "6px 0",
                border: "none",
                borderBottom: "1px solid var(--grid)",
                background: "transparent",
                textAlign: "left",
              }}
            >
              <span className="qid">{row.qid}</span>
              <span className="qtext" style={{ flex: 1 }}>
                {row.text}
              </span>
              {row.judged === 0 && <span className="chip bad">无相关文档</span>}
              {!row.comparable && <span className="chip warn">未比较</span>}
              <span className="micro" style={{ fontVariantNumeric: "tabular-nums" }}>
                nDCG {fmt(valueA)} / {fmt(value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FlagDrill({
  report,
  rows,
  onSelect,
}: {
  report: Report;
  rows: QueryRow[];
  onSelect: (qid: string) => void;
}) {
  const examples = useMemo(() => {
    const wanted = ["duplicates", "unlabeled", "no_relevant", "insufficient", "ties", "empty"];
    return wanted.map((flag) => ({
      flag,
      queries: report.queries.filter((row) =>
        ["a", "b"].some((slot) => {
          const version = row.versions[slot as "a" | "b"];
          return version ? version.standard.flags[flag as keyof typeof version.standard.flags] : false;
        }),
      ),
    }));
  }, [report.queries]);

  const rowCount = rows.length;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">样例索引</h2>
        <span className="micro">共 {rowCount} 个比较查询 · 点查询进入计算</span>
      </div>
      <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {examples.map(({ flag, queries }) => (
          <div key={flag} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="micro" style={{ minWidth: 84 }}>
              {FLAG_LABELS[flag] ?? flag}
            </span>
            {queries.length === 0 ? (
              <span className="micro">无</span>
            ) : (
              queries.slice(0, 8).map((row) => (
                <button className="chip" key={row.qid} onClick={() => onSelect(row.qid)}>
                  {row.qid}
                </button>
              ))
            )}
            {queries.length > 8 && <span className="micro">+{queries.length - 8}</span>}
          </div>
        ))}
        <div className="micro">
          标注等级：{Object.entries(report.metric_labels).length > 0 && [0, 1, 2, 3].map((grade) => `${grade} ${gradeLabel(grade)}`).join(" · ")}
        </div>
      </div>
    </div>
  );
}

export function useReportLoader(id: number | null) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (id === null) {
      setReport(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api.report(id);
      setReport(data);
    } catch (loadError) {
      setReport(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { report, error, busy, reload: load };
}

export function evaluationTitle(item: EvaluationSummary | null): string {
  return item ? `${item.name} · K=${item.k}` : "未选择评测";
}
