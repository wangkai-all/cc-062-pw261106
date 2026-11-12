# 检索排序对比评测

两版检索排序在同一查询集上的逐查询、逐名次对比。所有分数都可从总分一路展开到单个文档的增益项：

```
总分（普通平均 / 权重平均）
  → 贡献明细（每个查询的分数 × 系数 = 贡献，合计即总分）
    → 某个查询（A/B 两版并排）
      → 排序归一化（排序、去重、并列、连续编号、前 K 截断）
        → 标准分数 / 辅助分数（四项指标）
          → 指标计算过程（分子、分母、DCG/IDCG、逐文档增益表、理想顺序）
```

## 技术栈

- 后端：Python 3.11、FastAPI、SQLite（`sqlite3`，WAL）
- 前端：React 19 + TypeScript + Vite，纯手写 CSS（无 UI 库）

## 启动

后端（在仓库根目录）：

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000 --app-dir backend
```

首次启动会在 `data/eval.db` 建库，并自动生成一个覆盖全部样例的示例评测（K=5）。可用 `EVAL_DB_PATH` 指定其他数据库路径。

前端：

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173，/api 代理到 127.0.0.1:8000
npm run build      # tsc -b && vite build，产物在 frontend/dist
```

测试：

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

## 计算口径

**排序归一化**：按 `(名次, 文档编号)` 排序，同一文档只保留首次出现（其余记为重复并剔除），再连续编号 1..N，取前 K 条计分。空结果查询保留在查询集中，各项计 0。

**相关性**：0–3 级标注，一级以上算相关。未标注文档按 0 贡献，同时单列未标注占比。辅助视图先剔除未标注文档、重新编号后再截断 K，与标准分数分开展示。

**指标（前 K）**

| 指标 | 定义 |
|---|---|
| Precision@K | 前 K 名中相关性 ≥ 1 的结果数 ÷ K（不足 K 条时分母仍为 K） |
| Recall@K | 前 K 名中相关性 ≥ 1 的结果数 ÷ 该查询全部已知相关文档数 |
| MRR@K | 1 ÷ 前 K 名中首个相关结果的名次；没有相关结果记 0 |
| nDCG@K | Σ(2^相关性 − 1)/log2(名次 + 1) ÷ 理想顺序前 K 的同一合计；理想顺序取全部已标注文档前 K |

没有已知相关文档时 Recall 与 nDCG 不适用，MRR 记 0。

**覆盖与平均**：某版未覆盖的查询单列（A 版有、B 版没有 → 仅 A），比较只用两版共同覆盖的查询。普通平均对适用查询等权；权重平均只纳入适用且权重 > 0 的查询，分母为这些查询的权重之和。权重为 0 的查询仍进普通平均，但不进权重平均。

## 导入格式

查询集、标注、排序各用 CSV 或 JSON 整体替换，文件名即版本名（如 `ranking-bm25.json` 会显示为「版本 A：ranking-bm25」）。

**查询集** — 列 `qid,text,group,weight`；同名 qid 只保留第一次出现。

```csv
qid,text,group,weight
q01,蓝牙耳机 降噪,数码,1
```

**相关性标注 0–3** — 列 `qid,doc_id,grade`。

**排序** — CSV 列 `qid,doc_id,rank`；JSON 可按查询分组，空数组用于声明「该查询返回空结果」：

```json
[
  {"qid": "q01", "results": [{"doc_id": "P01", "rank": 1}, {"doc_id": "P04", "rank": 2}]},
  {"qid": "q06", "results": []}
]
```

`samples/` 里有一整套可直接导入的文件（9 个查询，含重复结果、并列名次、未标注、无相关文档、不足 K、空结果、仅单版覆盖等样例），导入后与内置示例评测逐条一致。

## 样例查询一览

| 查询 | 覆盖的样例 |
|---|---|
| q01 | 未标注文档（标准与辅助分数不同） |
| q02 | 并列名次（P08 / P09 同列第 2，按文档编号稳定排序） |
| q03 | 重复结果（P14 重复出现，权重 2） |
| q04 | 不足 K 条（A 4 条、B 3 条，Precision 分母仍为 K） |
| q05 | 权重 0（只进普通平均） |
| q06 | 空结果（两版都没有返回） |
| q07 | 无相关文档（Recall / nDCG 不适用，MRR 记 0） |
| q08 / q09 | 仅 A / 仅 B 覆盖（单列，不参与比较） |

## 界面结构

- **总分对比**：四项指标的普通平均、权重平均与 B−A 差值；「展开计算」弹出每个查询的分数 × 系数贡献表。
- **逐查询差值**：哑铃图按 B−A 排序，两版位置、差值、悬停提示；点一行跳到该查询的计算。
- **覆盖与分组 / 样例索引**：共同覆盖、仅 A、仅 B，分组权重和，以及按样例类型的快捷入口。
- **逐查询得分**：按样例筛选的表格；展开某行得到两版并排的归一化过程、未标注占比、标准与辅助指标卡，点指标卡展开完整计算（公式、分子分母、DCG/ICDG、逐文档增益）。
- **评测口径**：页面上把上述规则再列一遍，与后端实现逐条对应。

## 目录

```
backend/
  app/scoring.py    # 归一化与指标计算（纯函数）
  app/services.py   # 查询/标注/排序读写、导入解析、评测汇总
  app/demo.py       # 内置样例
  app/main.py       # FastAPI 路由
  tests/            # 26 个 pytest 用例
frontend/
  src/components/   # SummaryMetrics、DeltaChart、QueryTable、ContributionSheet 等
  src/lib/          # API 客户端、聚合重算、格式化
samples/            # 可导入的查询集 / 标注 / 两版排序
```
