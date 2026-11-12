import { useEffect, useMemo, useRef, useState } from "react";
import { api, type EvaluationSummary, type MetricKey, type ViewKey } from "./lib/api";
import { DeltaChart } from "./components/DeltaChart";
import { ContributionSheet } from "./components/ContributionSheet";
import { QueryTable } from "./components/QueryTable";
import { SettingsRail } from "./components/SettingsRail";
import { SummaryMetrics } from "./components/SummaryMetrics";
import {
  CoverageCard,
  FlagDrill,
  MetricSwitcher,
  QueryJumpList,
  ViewSwitcher,
  useReportLoader,
} from "./components/panels";
import { Tabs } from "./components/ui";

type Scope = "shared" | "all";

export default function App() {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [view, setView] = useState<ViewKey>("standard");
  const [metric, setMetric] = useState<MetricKey>("ndcg");
  const [scope, setScope] = useState<Scope>("shared");
  const [expandedQid, setExpandedQid] = useState<string | null>(null);
  const [sheet, setSheet] = useState<MetricKey | null>(null);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const [notice, setNotice] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const loadEvaluations = async () => {
    const data = await api.evaluations();
    setEvaluations(data.evaluations);
    if (data.evaluations.length === 0) {
      setCurrentId(null);
      return;
    }
    setCurrentId((existing) => {
      if (existing !== null && data.evaluations.some((item) => item.id === existing)) {
        return existing;
      }
      return data.evaluations[0].id;
    });
  };

  useEffect(() => {
    void loadEvaluations();
  }, []);

  useEffect(() => {
    if (theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  const { report, error, busy, reload } = useReportLoader(currentId);

  const current = useMemo(
    () => evaluations.find((item) => item.id === currentId) ?? null,
    [evaluations, currentId],
  );

  const allRows = report?.queries ?? [];
  const sharedRows = useMemo(
    () => allRows.filter((row) => row.comparable),
    [allRows],
  );
  const rows = scope === "shared" ? sharedRows : allRows;

  const comparableForChart = sharedRows;

  const importError = (async (kind: "queries" | "judgments" | "ranking/a" | "ranking/b", file: File) => {
    if (!currentId) return;
    setNotice(null);
    try {
      await api.importFile(currentId, kind, file);
      setNotice(`已导入 ${file.name}`);
      await reload();
      await loadEvaluations();
    } catch (importFailure) {
      setNotice(importFailure instanceof Error ? importFailure.message : String(importFailure));
    }
  }) as (kind: "queries" | "judgments" | "ranking/a" | "ranking/b", file: File) => void;

  const openQuery = (qid: string) => {
    setExpandedQid(qid);
    setScope("all");
    requestAnimationFrame(() => {
      document.getElementById(`detail-${qid}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  return (
    <div className="app">
      <SettingsRail
        evaluations={evaluations}
        current={current}
        report={report}
        busy={busy}
        error={error ?? notice}
        onSelect={(id: number) => {
          setCurrentId(id);
          setExpandedQid(null);
        }}
        onCreated={async (id: number) => {
          await loadEvaluations();
          setCurrentId(id);
        }}
        onRefresh={async () => {
          await loadEvaluations();
          await reload();
        }}
        onSeedDemo={async () => {
          if (!currentId) return;
          await api.seedDemo(currentId);
          await reload();
        }}
        onImport={importError}
      />

      <main className="main">
        <header className="page-head">
          <div>
            <div className="eyebrow">Retrieval Evaluation</div>
            <h1 className="page-title">{report ? report.evaluation.name : "检索排序对比评测"}</h1>
            <p className="page-sub">
              {report
                ? `两版排序在同一查询集上的逐查询差异；K=${report.k}，比较 ${report.comparison.query_count} 个共同覆盖查询。`
                : "导入查询集、0–3 级相关性标注和两版排序，保存本次评测设置。"}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {report && (
              <Tabs
                ariaLabel="比较范围"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "shared" as Scope, label: "共同覆盖", count: sharedRows.length },
                  { value: "all" as Scope, label: "全部查询", count: allRows.length },
                ]}
              />
            )}
            <div className="theme-toggle" aria-label="主题">
              {(["auto", "light", "dark"] as const).map((option) => (
                <button
                  key={option}
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                  title={option === "auto" ? "跟随系统" : option === "light" ? "浅色" : "深色"}
                >
                  {option === "auto" ? "自动" : option === "light" ? "浅" : "深"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {notice && <div className="status-banner">{notice}</div>}
        {error && <div className="status-banner error">{error}</div>}

        {report && (
          <>
            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">总分对比</h2>
                  <div className="micro" style={{ marginTop: 2 }}>
                    普通平均对适用查询等权；权重平均只用适用且权重 &gt; 0 的查询
                  </div>
                </div>
                <ViewSwitcher value={view} onChange={setView} />
              </div>
              <SummaryMetrics
                report={report}
                view={view}
                onOpen={(m: MetricKey) => setSheet(m)}
              />
            </section>

            <section className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">逐查询差值</h2>
                  <div className="micro" style={{ marginTop: 2 }}>
                    {view === "standard"
                      ? "标准分数：未标注文档按 0 贡献"
                      : "辅助分数：先剔除未标注文档再编号计分"}
                  </div>
                </div>
                <MetricSwitcher value={metric} onChange={setMetric} labels={report.metric_labels} />
              </div>
              {scope === "all" && (
                <div className="view-note">
                  当前展示全部查询；差值与平均只对共同覆盖的查询成立，未覆盖的在表格里单列。
                </div>
              )}
              <DeltaChart
                rows={comparableForChart}
                metric={metric}
                labels={{ a: report.labels.a, b: report.labels.b }}
                currentQid={expandedQid}
                onSelect={openQuery}
              />
            </section>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 20, alignItems: "start" }}>
              <div>
                <CoverageCard report={report} />
              </div>
              <FlagDrill report={report} rows={sharedRows} onSelect={openQuery} />
            </div>

            <section className="card" ref={tableRef}>
              <div className="card-header">
                <div>
                  <h2 className="card-title">逐查询得分</h2>
                  <div className="micro" style={{ marginTop: 2 }}>
                    {view === "standard"
                      ? "标准分数：未标注文档按 0 贡献；展开任一查询看排序归一化 → 增益 → 指标合成"
                      : "辅助分数：先剔除未标注文档再编号计分；展开任一查询看剔除与合成过程"}
                  </div>
                </div>
                <div className="micro">
                  {scope === "shared" ? "共同覆盖" : "全部"} {rows.length} 条
                </div>
              </div>
              <QueryTable
                report={report}
                rows={rows}
                view={view}
                activeQid={expandedQid}
                onActivate={setExpandedQid}
              />
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">评测口径</h2>
                <span className="micro">与后端计算逐条对应</span>
              </div>
              <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, fontSize: 12.5 }}>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>排序归一化</div>
                  <ul className="rule-list">
                    <li>按 (名次, 文档编号) 排序；并列用文档编号稳定决定先后。</li>
                    <li>同一文档只保留首次出现，其余标为重复并剔除。</li>
                    <li>剔除后连续编号 1..N，取前 K 条计分。</li>
                    <li>空结果查询保留，各项均计 0（Recall / nDCG 视标注情况可不适用）。</li>
                  </ul>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>相关性</div>
                  <ul className="rule-list">
                    <li>0–3 级标注；一级以上算相关。</li>
                    <li>未标注文档不参与增益，按 0 贡献，并单列未标注占比。</li>
                    <li>辅助视图先剔除未标注再编号、再截断 K，与标准分数分开展示。</li>
                  </ul>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>指标</div>
                  <ul className="rule-list">
                    <li>Precision@K 除以 K；Recall@K 除以该查询全部已知相关文档数。</li>
                    <li>MRR 取前 K 内首个相关结果名次的倒数，没有则 0。</li>
                    <li>nDCG 增益 2^g−1、折损 log2(名次+1)；理想顺序为全部已标注文档前 K。</li>
                    <li>没有已知相关文档时 Recall 与 nDCG 不适用；MRR 记 0。</li>
                  </ul>
                </div>
                <div>
                  <div className="eyebrow" style={{ marginBottom: 6 }}>平均与比较</div>
                  <ul className="rule-list">
                    <li>比较只用两版共同覆盖的查询；某版未覆盖的单列。</li>
                    <li>普通平均对适用查询等权；权重平均只纳入适用且权重 &gt; 0 的查询，分母为这些权重之和。</li>
                    <li>点任一分数可展开贡献明细，再点查询编号进入逐名次计算。</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">查询列表</h2>
                <span className="micro">含空结果、未标注、未覆盖查询</span>
              </div>
              <div className="card-body" style={{ padding: 0 }}>
                <QueryJumpList report={report} onSelect={openQuery} />
              </div>
            </section>
          </>
        )}

        {!report && !busy && (
          <div className="card">
            <div className="card-body">
              <h2 className="card-title" style={{ marginBottom: 8 }}>
                开始
              </h2>
              <p className="hint">
                左侧选择或新建评测，导入查询集、相关性标注与两版排序。首次启动已自动生成一个包含全部样例的示例评测。
              </p>
            </div>
          </div>
        )}
      </main>

      {report && sheet && (
        <ContributionSheet
          report={report}
          rows={sharedRows}
          metric={sheet}
          view={view}
          onClose={() => setSheet(null)}
          onOpenQuery={openQuery}
        />
      )}
    </div>
  );
}
