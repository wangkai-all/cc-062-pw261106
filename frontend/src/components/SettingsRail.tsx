import { api, type EvaluationSummary, type Report } from "../lib/api";
import { Chip } from "./ui";

interface Props {
  evaluations: EvaluationSummary[];
  current: EvaluationSummary | null;
  report: Report | null;
  busy: boolean;
  error: string | null;
  onSelect: (id: number) => void;
  onCreated: (id: number) => void;
  onRefresh: () => void;
  onSeedDemo: () => void;
  onImport: (kind: "queries" | "judgments" | "ranking/a" | "ranking/b", file: File) => void;
}

export function SettingsRail({
  evaluations,
  current,
  report,
  busy,
  error,
  onSelect,
  onCreated,
  onRefresh,
  onSeedDemo,
  onImport,
}: Props) {
  const create = async () => {
    const name = prompt("新评测名称", "新评测");
    if (name === null) return;
    const kText = prompt("K（正整数）", "10");
    if (kText === null) return;
    const k = Number(kText);
    if (!Number.isInteger(k) || k < 1) {
      alert("K 必须是正整数");
      return;
    }
    const created = await api.createEvaluation(name || "新评测", k);
    onCreated(created.id);
  };

  const pick = (event: React.ChangeEvent<HTMLInputElement>, kind: Parameters<Props["onImport"]>[0]) => {
    const file = event.target.files?.[0];
    if (file) onImport(kind, file);
    event.target.value = "";
  };

  const rename = async () => {
    if (!current) return;
    const name = prompt("评测名称", current.name);
    if (name === null || !name.trim()) return;
    await api.patchEvaluation(current.id, { name: name.trim() });
    onRefresh();
  };

  const remove = async () => {
    if (!current) return;
    if (!confirm(`删除评测「${current.name}」及其全部导入数据？`)) return;
    await api.deleteEvaluation(current.id);
    onRefresh();
  };

  return (
    <aside className="rail">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">本次评测设置</h2>
          <span className="eyebrow">Settings</span>
        </div>
        <div className="rail-section">
          <div className="field">
            <label htmlFor="evaluation-select">评测</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                id="evaluation-select"
                className="input"
                value={current?.id ?? ""}
                onChange={(event) => onSelect(Number(event.target.value))}
                disabled={evaluations.length === 0}
              >
                {evaluations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · K={item.k}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={create} title="新建评测">
                新建
              </button>
            </div>
          </div>
          {current && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="icon-btn" onClick={rename}>
                重命名
              </button>
              <button className="icon-btn btn-danger" onClick={remove}>
                删除
              </button>
              {!report?.versions_present.a && !report?.versions_present.b && (
                <button className="icon-btn" onClick={onSeedDemo}>
                  载入示例
                </button>
              )}
            </div>
          )}
          {current && (
            <div className="saved-note">
              已保存 · 更新于 {new Date(current.updated_at).toLocaleString("zh-CN")}
            </div>
          )}
          {error && <div className="status-banner error">{error}</div>}
          {busy && <div className="status-banner">载入中…</div>}
        </div>
      </div>

      {current && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">评测参数</h2>
          </div>
          <div className="rail-section">
            <KEditor k={current.k} onSave={async (k) => {
              await api.patchEvaluation(current.id, { k });
              onRefresh();
            }} />
            <div className="hint">K 用于截断每个查询的排序，并作为 Precision 的分母。</div>
          </div>
        </div>
      )}

      {current && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">导入数据</h2>
          </div>
          <div className="rail-section">
            <div className="import-row">
              <span className="label">查询集（CSV / JSON）</span>
              <label className="btn">
                选择
                <input
                  className="hidden-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => pick(event, "queries")}
                />
              </label>
            </div>
            <div className="import-row">
              <span className="label">相关性标注 0–3</span>
              <label className="btn">
                选择
                <input
                  className="hidden-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => pick(event, "judgments")}
                />
              </label>
            </div>
            <div className="import-row">
              <span className="label">版本 A 排序</span>
              <label className="btn">
                选择
                <input
                  className="hidden-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => pick(event, "ranking/a")}
                />
              </label>
            </div>
            <div className="import-row">
              <span className="label">版本 B 排序</span>
              <label className="btn">
                选择
                <input
                  className="hidden-file"
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => pick(event, "ranking/b")}
                />
              </label>
            </div>
            <details className="help-details">
              <summary>导入格式</summary>
              <ul className="rule-list">
                <li>
                  查询集列：<code>qid</code> <code>text</code> <code>group</code> <code>weight</code>。
                  同名 qid 只保留第一次出现。
                </li>
                <li>
                  标注列：<code>qid</code> <code>doc_id</code> <code>grade</code>，grade 取 0–3。
                </li>
                <li>
                  排序列：<code>qid</code> <code>doc_id</code> <code>rank</code>。JSON 还可用{" "}
                  <code>{'{"qid": "...", "results": []}'}</code> 声明一个空结果查询。
                </li>
                <li>导入会整体替换该类数据；重新计算在后端完成，无需手动触发。</li>
              </ul>
            </details>
            {report && (
              <div className="chip-row">
                <Chip>{report.comparison.query_count} 个共同覆盖查询</Chip>
                {report.comparison.excluded_count > 0 && (
                  <Chip tone="warn">{report.comparison.excluded_count} 个不参与比较</Chip>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function KEditor({ k, onSave }: { k: number; onSave: (k: number) => Promise<void> }) {
  return (
    <div className="field">
      <label htmlFor="k-input">每查询截断 K</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          id="k-input"
          className="input input-num"
          type="number"
          min={1}
          defaultValue={k}
          key={k}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const target = event.currentTarget;
            const next = Number(target.value);
            if (!Number.isInteger(next) || next < 1) {
              alert("K 必须是正整数");
              return;
            }
            void onSave(next);
          }}
          onBlur={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isInteger(next) && next >= 1 && next !== k) void onSave(next);
          }}
        />
        <span className="micro">回车或离开输入框即保存</span>
      </div>
    </div>
  );
}
