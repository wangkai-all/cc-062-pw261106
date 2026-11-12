import type {
  AggregateView,
  Contribution,
  MetricKey,
  QueryRow,
  Slot,
  ViewKey,
} from "./api";

export const METRICS: MetricKey[] = ["precision", "recall", "mrr", "ndcg"];

export const normalizeWeight = (weight: number): number =>
  Number.isFinite(weight) && weight > 0 ? weight : 0;

export function metricValue(
  row: QueryRow,
  slot: Slot,
  metric: MetricKey,
  view: ViewKey,
): number | null {
  const version = row.versions[slot];
  if (!version) return null;
  const entry = version[view].metrics[metric];
  return entry.applicable ? entry.value : null;
}

function build(
  rows: QueryRow[],
  slot: Slot,
  metric: MetricKey,
  view: ViewKey,
): { macro: AggregateView; weighted: AggregateView } {
  const applicable: { qid: string; value: number; weight: number }[] = [];
  let notApplicable = 0;
  for (const row of rows) {
    const value = metricValue(row, slot, metric, view);
    if (value === null) {
      notApplicable += 1;
      continue;
    }
    applicable.push({ qid: row.qid, value, weight: normalizeWeight(row.weight) });
  }

  const macroCount = applicable.length;
  const macroValue =
    macroCount === 0
      ? null
      : applicable.reduce((acc, item) => acc + item.value, 0) / macroCount;
  const macroContributions: Contribution[] = applicable.map((item) => ({
    qid: item.qid,
    value: item.value,
    weight: item.weight,
    contribution: macroCount ? item.value / macroCount : 0,
  }));

  const positive = applicable.filter((item) => item.weight > 0);
  const weightSum = positive.reduce((acc, item) => acc + item.weight, 0);
  const weightedValue =
    weightSum === 0
      ? null
      : positive.reduce((acc, item) => acc + item.value * item.weight, 0) / weightSum;
  const weightedContributions: Contribution[] = positive.map((item) => ({
    qid: item.qid,
    value: item.value,
    weight: item.weight,
    contribution: weightSum ? (item.value * item.weight) / weightSum : 0,
  }));

  return {
    macro: {
      value: macroValue,
      applicable_count: macroCount,
      not_applicable_count: notApplicable,
      scoped_count: rows.length,
      contributions: macroContributions,
    },
    weighted: {
      value: weightedValue,
      applicable_count: positive.length,
      not_applicable_count: notApplicable,
      zero_weight_count: applicable.length - positive.length,
      scoped_count: rows.length,
      weight_sum: weightSum,
      contributions: weightedContributions,
    },
  };
}

export type Aggregates = {
  macro: AggregateView;
  weighted: AggregateView;
};

export function aggregate(
  rows: QueryRow[],
  slot: Slot,
  metric: MetricKey,
  view: ViewKey,
): Aggregates {
  return build(rows, slot, metric, view);
}

export function perQueryDelta(
  row: QueryRow,
  metric: MetricKey,
  view: ViewKey,
): number | null {
  const a = metricValue(row, "a", metric, view);
  const b = metricValue(row, "b", metric, view);
  if (a === null || b === null) return null;
  return b - a;
}

export function queryFlags(row: QueryRow, view: ViewKey): string[] {
  const flags: string[] = [];
  if (!row.comparable) flags.push("excluded");
  for (const slot of ["a", "b"] as const) {
    const version = row.versions[slot];
    if (!version) continue;
    const block = version[view];
    if (block.flags.duplicates) flags.push("duplicates");
    if (block.flags.ties) flags.push("ties");
    if (block.flags.empty) flags.push("empty");
    if (block.flags.insufficient) flags.push("insufficient");
    if (view === "standard" && block.flags.unlabeled) flags.push("unlabeled");
    if (block.flags.no_relevant) flags.push("no_relevant");
  }
  return [...new Set(flags)];
}

export const FLAG_LABELS: Record<string, string> = {
  duplicates: "重复结果",
  ties: "并列名次",
  empty: "空结果",
  insufficient: "不足 K",
  unlabeled: "含未标注",
  no_relevant: "无相关文档",
  missing_relevant: "相关问题未进前 K",
  excluded: "未共同覆盖",
};

export const FLAG_ORDER = [
  "duplicates",
  "ties",
  "empty",
  "insufficient",
  "unlabeled",
  "no_relevant",
  "missing_relevant",
];
