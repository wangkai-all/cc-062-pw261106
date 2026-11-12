import { Fragment, useState } from "react";
import type { Block, MetricKey, QueryRow, Report, Slot, ViewKey } from "../lib/api";
import { FLAG_LABELS, queryFlags } from "../lib/aggregate";
import { fmtDelta, fmt } from "../lib/format";
import { Chip, GradeBadge } from "./ui";

interface Props {
  report: Report;
  rows: QueryRow[];
  view: ViewKey;
  activeQid: string | null;
  onActivate: (qid: string | null) => void;
}

const METRICS: MetricKey[] = ["precision", "recall", "mrr", "ndcg"];

const SHORT_FORMULA: Record<MetricKey, string> = {
  precision: "相关@K ÷ K",
  recall: "相关@K ÷ 已知相关",
  mrr: "1 ÷ 首个相关名次",
  ndcg: "DCG ÷ 理想 DCG",
};

export function QueryTable({ report, rows, view, activeQid, onActivate }: Props) {
  const [flagFilter, setFlagFilter] = useState<string | null>(null);

  const availableFlags = [...new Set(rows.flatMap((row) => [...queryFlags(row, "standard"), ...queryFlags(row, "auxiliary")]))];

  const filtered = flagFilter
    ? rows.filter((row) => [...queryFlags(row, "standard"), ...queryFlags(row, "auxiliary")].includes(flagFilter))
    : rows;

  return (
    <div>
      <div className="flag-filter-row">
        <span className="micro">按样例筛选</span>
        <button
          className={`chip ${flagFilter === null ? "active" : ""}`}
          onClick={() => setFlagFilter(null)}
        >
          全部 {rows.length}
        </button>
        {availableFlags.map((flag) => (
          <button
            key={flag}
            className={`chip ${flagFilter === flag ? "active" : ""}`}
            onClick={() => setFlagFilter(flagFilter === flag ? null : flag)}
          >
            {FLAG_LABELS[flag] ?? flag}
            {rows.filter((row) => [...queryFlags(row, "standard"), ...queryFlags(row, "auxiliary")].includes(flag)).length}
          </button>
        ))}
        <span className="micro" style={{ marginLeft: "auto" }}>
          点开任意查询，逐名次、逐增益展开计算
        </span>
      </div>
      <div className="table-wrap">
        <table className="grid-table">
          <thead>
            <tr>
              <th />
              <th>查询</th>
              <th>分组</th>
              <th className="num">权重</th>
              <th>覆盖</th>
              {METRICS.map((metric) => (
                <th key={metric} className="num col-score">
                  {report.metric_labels[metric]}
                </th>
              ))}
              <th className="num">四指标差值和</th>
              <th>样例</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const open = row.qid === activeQid;
              const flags = queryFlags(row, view);
              return (
                <Fragment key={row.qid}>
                  <tr>
                    <td style={{ width: 22 }}>
                      <button
                        className="row-toggle"
                        aria-expanded={open}
                        aria-controls={`detail-${row.qid}`}
                        onClick={() => onActivate(open ? null : row.qid)}
                        title={open ? "收起计算" : "展开计算"}
                      >
                        <span className="caret" data-open={open} aria-hidden="true" />
                      </button>
                    </td>
                    <td>
                      <span className="qid">{row.qid}</span>
                      <span className="qtext">{row.text || <span className="micro">（无查询文本）</span>}</span>
                    </td>
                    <td>{row.grp ? <span className="q-group">{row.grp}</span> : <span className="micro">—</span>}</td>
                    <td className="num">{row.weight}</td>
                    <td>
                      <div className="chip-row">
                        {row.comparable ? (
                          <Chip tone="good">A + B</Chip>
                        ) : (
                          <Chip tone="warn">{row.covered.a ? "仅 A" : row.covered.b ? "仅 B" : "未覆盖"}</Chip>
                        )}
                      </div>
                    </td>
                    {METRICS.map((metric) => {
                      const a = scoreOf(row, "a", metric, view);
                      const b = scoreOf(row, "b", metric, view);
                      return (
                        <td key={metric} className="num col-score">
                          {a.value === null && b.value === null ? (
                            <span className="micro">—</span>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-end" }}>
                              <span style={{ fontSize: 11.5 }}>
                                <span className="score-key key-a" style={{ display: "inline-block", marginRight: 4 }} />
                                {a.value === null ? "不适用" : fmt(a.value)}
                              </span>
                              <span style={{ fontSize: 11.5 }}>
                                <span className="score-key key-b" style={{ display: "inline-block", marginRight: 4 }} />
                                {b.value === null ? "不适用" : fmt(b.value)}
                              </span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="num">
                      <MultiDelta row={row} view={view} />
                    </td>
                    <td>
                      <div className="chip-row">
                        {flags.length === 0 && <span className="micro">常规</span>}
                        {flags.slice(0, 2).map((flag) => (
                          <Chip key={flag} tone={flag === "excluded" ? "warn" : "neutral"}>
                            {FLAG_LABELS[flag] ?? flag}
                          </Chip>
                        ))}
                        {flags.length > 2 && <span className="micro">+{flags.length - 2}</span>}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={12} style={{ padding: 0, borderBottom: "1px solid var(--grid)" }}>
                        <div id={`detail-${row.qid}`}>
                          <QueryDetail report={report} row={row} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <div className="chart-empty">该样例筛选下没有查询。</div>}
    </div>
  );
}

function scoreOf(
  row: QueryRow,
  slot: Slot,
  metric: MetricKey,
  view: ViewKey,
): { value: number | null; block: Block | null } {
  const version = row.versions[slot];
  if (!version) return { value: null, block: null };
  const entry = version[view].metrics[metric];
  return { value: entry.applicable ? entry.value : null, block: version[view] };
}

function MultiDelta({ row, view }: { row: QueryRow; view: ViewKey }) {
  const deltas = METRICS.map((metric) => {
    const a = scoreOf(row, "a", metric, view).value;
    const b = scoreOf(row, "b", metric, view).value;
    return a === null || b === null ? null : b - a;
  }).filter((value): value is number => value !== null);
  if (deltas.length === 0) return <span className="micro">—</span>;
  const sum = deltas.reduce((acc, value) => acc + value, 0);
  return (
    <span
      className="micro"
      style={{ fontVariantNumeric: "tabular-nums" }}
      title={`四项指标差值合计 ${fmtDelta(sum)}（仅计两版都适用的指标）`}
    >
      {fmtDelta(sum)}
    </span>
  );
}

export function QueryDetail({ report, row }: { report: Report; row: QueryRow }) {
  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <div className="qid">{row.qid}</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{row.text || "（无查询文本）"}</div>
        </div>
        <div className="detail-meta">
          {row.grp && <span className="q-group">{row.grp}</span>}
          <span>权重 {row.weight}</span>
          <span>已标注 {row.judged} 个文档</span>
          <span>已知相关 {row.known_relevant} 个</span>
          {!row.comparable && <Chip tone="warn">{row.status}</Chip>}
        </div>
      </div>

      {row.comparable ? (
        <div className="versions-grid">
          <VersionPanel report={report} row={row} slot="a" />
          <VersionPanel report={report} row={row} slot="b" />
        </div>
      ) : (
        <div className="versions-grid">
          {row.covered.a && <VersionPanel report={report} row={row} slot="a" />}
          {row.covered.b && <VersionPanel report={report} row={row} slot="b" />}
          {!row.covered.a && (
            <MissingPanel label={report.labels.a} slot="a" />
          )}
          {!row.covered.b && (
            <MissingPanel label={report.labels.b} slot="b" />
          )}
        </div>
      )}
    </div>
  );
}

function MissingPanel({ label, slot }: { label: string; slot: Slot }) {
  return (
    <div className="version-panel" style={{ opacity: 0.75 }}>
      <div className="version-head">
        <span className={`dot ${slot === "a" ? "key-a" : "key-b"}`} style={{ background: slot === "a" ? "var(--series-a)" : "var(--series-b)" }} />
        <span className="name">{label}</span>
      </div>
      <div className="version-empty">该版本未覆盖此查询，不参与比较。</div>
    </div>
  );
}

function VersionPanel({ report, row, slot }: { report: Report; row: QueryRow; slot: Slot }) {
  const [active, setActive] = useState<{ view: ViewKey; metric: MetricKey } | null>(null);
  const version = row.versions[slot];
  if (!version) {
    return null;
  }
  const color = slot === "a" ? "var(--series-a)" : "var(--series-b)";
  return (
    <div className="version-panel">
      <div className="version-head">
        <span className="dot" style={{ background: color }} />
        <span className="name">{report.labels[slot]}</span>
        <span className="sub">
          {version.standard.unlabeled.retrieved} 条计分 · K={version.standard.k}
        </span>
      </div>

      <Pipeline block={version.standard} />

      {(["standard", "auxiliary"] as ViewKey[]).map((view) => (
        <div key={view}>
          <div
            className="version-head"
            style={{ borderTop: view === "auxiliary" ? "1px solid var(--grid)" : undefined, background: view === "auxiliary" ? "color-mix(in srgb, var(--series-a) 3%, transparent)" : undefined }}
          >
            <span className="eyebrow">{view === "standard" ? "标准分数" : "辅助分数"}</span>
            <span className="sub">
              {view === "standard" ? "未标注贡献 0" : "先剔除未标注再算"}
            </span>
          </div>
          {(view === "auxiliary" || version.standard.unlabeled.count > 0) && (
            <UnlabeledStrip block={version[view]} />
          )}
          <div className="metric-row">
            {METRICS.map((metric) => {
              const entry = version[view].metrics[metric];
              const isOpen = active?.view === view && active.metric === metric;
              return (
                <button
                  key={metric}
                  className="metric-card"
                  aria-expanded={isOpen}
                  onClick={() => setActive(isOpen ? null : { view, metric })}
                >
                  <span className="k">{report.metric_labels[metric]}</span>
                  <span className={`v ${entry.applicable ? "" : "null"}`}>
                    {entry.applicable ? fmt(entry.value) : "不适用"}
                  </span>
                  <span className="f">{SHORT_FORMULA[metric]}</span>
                </button>
              );
            })}
          </div>
          {active?.view === view && (
            <Computation block={version[view]} metric={active.metric} />
          )}
        </div>
      ))}
    </div>
  );
}

function UnlabeledStrip({ block }: { block: Block }) {
  const share = block.unlabeled.share;
  return (
    <div className="unlabeled-strip">
      <span>未标注</span>
      <div className="meter" aria-hidden="true">
        <div className="meter-fill" style={{ width: `${(share ?? 0) * 100}%` }} />
      </div>
      <span className="meter-label">{share === null ? "不适用" : `${(share * 100).toFixed(1)}%`}</span>
      <span className="micro">
        {block.unlabeled.count} / {block.unlabeled.retrieved} 条计分结果
      </span>
      {block.auxiliary && block.dropped_unlabeled.length > 0 && (
        <span className="micro">已剔除 {block.dropped_unlabeled.length} 条</span>
      )}
    </div>
  );
}

function Pipeline({ block }: { block: Block }) {
  const normalization = block.rows;
  const scored = normalization.filter((row) => row.scored);
  const duplicates = block.duplicates;
  const ties = block.ties;
  return (
    <div className="pipeline">
      <div className="pipeline-title">
        <span className="eyebrow">排序归一化</span>
        <span className="micro">{block.k} 条截断</span>
      </div>
      <div className="pipeline-step">
        <span>①</span>
        <span>
          按 <b>(名次, 文档编号)</b> 排序；输入 <b>{normalization.length}</b> 行
        </span>
      </div>
      {duplicates.length > 0 && (
        <div className="pipeline-step" style={{ alignItems: "flex-start" }}>
          <span>②</span>
          <div>
            <span>
              同一文档只保留首次出现，剔除 <b>{duplicates.length}</b> 条：
            </span>
            <div className="pipeline-list">
              {duplicates.map((dup, index) => (
                <span className="doc-token dup" key={`${dup.doc_id}-${index}`}>
                  {dup.doc_id} @ {dup.rank}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {ties.length > 0 && (
        <div className="pipeline-step" style={{ alignItems: "flex-start" }}>
          <span>{duplicates.length > 0 ? "③" : "②"}</span>
          <div>
            <span>并列名次按文档编号稳定排序：</span>
            <div className="pipeline-list">
              {ties.map((tie) => (
                <span className="doc-token" key={tie.rank}>
                  #{tie.rank}: {tie.doc_ids.join(" / ")}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="pipeline-step">
        <span>{duplicates.length + ties.length > 0 ? "④" : "②"}</span>
        <span>
          连续编号后取前 <b>{block.k}</b>；计分 <b>{scored.length}</b> 条，超出 K{" "}
          <b>{block.beyond.length}</b> 条
        </span>
      </div>
      {block.beyond.length > 0 && (
        <div className="pipeline-list">
          {block.beyond.map((row) => (
            <span className="doc-token" key={row.doc_id}>
              {row.doc_id} #{row.rank}
            </span>
          ))}
        </div>
      )}
      {block.docs.length === 0 && (
        <div className="pipeline-step">
          <span>!</span>
          <span className="micro">该查询在本版本下没有返回结果，保留在查询集中，各项计 0。</span>
        </div>
      )}
    </div>
  );
}

function Computation({ block, metric }: { block: Block; metric: MetricKey }) {
  const entry = block.metrics[metric];
  const showTerms = metric === "ndcg" || metric === "precision" || metric === "recall";

  return (
    <div className="computation">
      <h4>计算过程 · {metric}</h4>
      <code className="formula-box">{entry.formula}</code>
      <div style={{ marginBottom: 8 }}>{entry.explain}</div>

      {(metric === "precision" || metric === "recall") && (
        <div className="kv-row">
          <span className="k">分子：前 K 名中相关性 ≥ 1 的结果</span>
          <span className="v">{entry.numerator}</span>
        </div>
      )}
      {(metric === "precision" || metric === "recall") && (
        <div className="kv-row">
          <span className="k">分母：{metric === "precision" ? "K" : "全部已标注相关文档"}</span>
          <span className="v">{entry.denominator}</span>
        </div>
      )}
      {metric === "recall" && (
        <div className="micro" style={{ marginTop: 4 }}>
          已知相关文档：
          {block.known_relevant_docs.length === 0
            ? " 无"
            : block.known_relevant_docs.map((doc) => (
                <span key={doc.doc_id} className="doc-token" style={{ marginLeft: 4 }}>
                  {doc.doc_id} · 级 {doc.grade}
                </span>
              ))}
        </div>
      )}

      {metric === "mrr" && (
        <div className="kv-row">
          <span className="k">首个相关结果名次</span>
          <span className="v">
            {entry.first_relevant_rank === null || entry.first_relevant_rank === undefined
              ? "无"
              : entry.first_relevant_rank}
          </span>
        </div>
      )}

      {metric === "ndcg" && (
        <div className="kv-row">
          <span className="k">DCG ÷ 理想 DCG（全部已标注前 K）</span>
          <span className="v">
            {fmt(block.dcg)} ÷ {fmt(block.idcg)}
          </span>
        </div>
      )}

      {showTerms && (
        <table className="term-table">
          <thead>
            {metric === "ndcg" ? (
              <tr>
                <th>名次</th>
                <th>文档</th>
                <th>相关性</th>
                <th>增益 2^g−1</th>
                <th>折损 log2(n+1)</th>
                <th>项贡献</th>
              </tr>
            ) : (
              <tr>
                <th>名次</th>
                <th>文档</th>
                <th>相关性</th>
                <th>计为相关</th>
              </tr>
            )}
          </thead>
          <tbody>
            {block.rows.map((row) => {
              const relevant = row.relevant;
              const inTop = row.scored;
              if (metric === "ndcg" && !inTop) return null;
              return (
                <tr key={row.doc_id} className={[row.unlabeled ? "unlabeled" : "", !inTop ? "beyond" : ""].join(" ")}>
                  <td>#{row.rank}</td>
                  <td>
                    {row.doc_id}
                    {row.tie && <span className="micro"> 并列</span>}
                  </td>
                  <td>
                    <GradeBadge grade={row.grade} />
                  </td>
                  {metric === "ndcg" ? (
                    <>
                      <td>{row.unlabeled ? "0（未标注）" : row.gain?.toFixed(0)}</td>
                      <td>{row.unlabeled ? "—" : row.discount?.toFixed(3)}</td>
                      <td>{row.unlabeled ? "0.000" : row.term?.toFixed(3)}</td>
                    </>
                  ) : (
                    <td>
                      {row.unlabeled ? (
                        <span className="micro">未标注 → 不计</span>
                      ) : relevant ? (
                        <span style={{ color: "var(--good-ink)" }}>是</span>
                      ) : (
                        <span className="micro">否</span>
                      )}
                      {!inTop && <span className="micro">（超出 K）</span>}
                    </td>
                  )}
                </tr>
              );
            })}
            {metric === "ndcg" && (
              <>
                <tr className="total-row">
                  <td colSpan={5} style={{ textAlign: "left" }}>
                    实际 DCG（前 K 合计）
                  </td>
                  <td>{fmt(block.dcg)}</td>
                </tr>
                {block.ideal_terms.map((term) => (
                  <tr key={`ideal-${term.rank}`} className="unlabeled">
                    <td>理想 #{term.rank}</td>
                    <td>{term.doc_id}</td>
                    <td>
                      <GradeBadge grade={term.grade} />
                    </td>
                    <td>{term.gain.toFixed(0)}</td>
                    <td>{term.discount.toFixed(3)}</td>
                    <td>{term.term.toFixed(3)}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td colSpan={5} style={{ textAlign: "left" }}>
                    理想 DCG（前 K 合计）
                  </td>
                  <td>{fmt(block.idcg)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      )}

      {metric === "precision" && (
        <div className="micro" style={{ marginTop: 6 }}>
          {entry.explain}；前 K 名共 {block.docs.length} 条，未标注 {block.unlabeled.count} 条。
        </div>
      )}

      {block.flags.insufficient && (
        <div className="micro" style={{ marginTop: 6 }}>
          本查询返回不足 K 条；Precision 的分母仍为 K。
        </div>
      )}
      {block.flags.duplicates && (
        <div className="micro" style={{ marginTop: 6 }}>
          重复结果已按「同一文档只保留首次出现」处理。
        </div>
      )}
    </div>
  );
}
