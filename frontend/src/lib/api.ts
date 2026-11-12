export type MetricKey = "precision" | "recall" | "mrr" | "ndcg";
export type Slot = "a" | "b";
export type ViewKey = "standard" | "auxiliary";

export interface MetricEntry {
  value: number | null;
  applicable: boolean;
  numerator?: number;
  denominator?: number;
  formula: string;
  explain: string;
  first_relevant_rank?: number | null;
  dcg?: number;
  idcg?: number;
}

export interface DocRow {
  doc_id: string;
  rank: number;
  original_rank: number;
  seq: number;
  grade: number | null;
  unlabeled: boolean;
  relevant: boolean;
  scored: boolean;
  tie: boolean;
  gain: number | null;
  discount: number | null;
  term: number;
}

export interface BlockFlags {
  empty: boolean;
  insufficient: boolean;
  unlabeled: boolean;
  no_relevant: boolean;
  missing_relevant: boolean;
  duplicates: boolean;
  ties: boolean;
}

export interface Block {
  auxiliary: boolean;
  k: number;
  rows: DocRow[];
  docs: DocRow[];
  beyond: DocRow[];
  metrics: Record<MetricKey, MetricEntry>;
  dcg: number;
  idcg: number;
  ideal_terms: {
    rank: number;
    doc_id: string;
    grade: number;
    gain: number;
    discount: number;
    term: number;
  }[];
  known_relevant_grades: number[];
  known_relevant_docs: { doc_id: string; grade: number }[];
  relevant_in_top: number;
  known_relevant: number;
  judged_count: number;
  unlabeled: {
    count: number;
    retrieved: number;
    share: number | null;
    doc_ids: string[];
    explain: string;
  };
  dropped_unlabeled: string[];
  duplicates: { doc_id: string; rank: number; seq: number; tie: boolean }[];
  ties: { rank: number; doc_ids: string[] }[];
  flags: BlockFlags;
}

export interface Normalization {
  raw: { doc_id: string; rank: number; seq: number }[];
  ordered: { doc_id: string; rank: number; seq: number }[];
  kept: DocRow[];
  top: string[];
  beyond_k: string[];
  duplicates: { doc_id: string; rank: number; seq: number; tie: boolean }[];
  ties: { rank: number; doc_ids: string[] }[];
  flags: BlockFlags;
  counts: { raw: number; unique: number; dropped: number; scored: number; beyond_k: number };
}

export interface VersionScore {
  normalization: Normalization;
  standard: Block;
  auxiliary: Block;
}

export interface Delta {
  a: number | null;
  b: number | null;
  delta: number | null;
  applicable: boolean;
}

export interface QueryRow {
  qid: string;
  text: string;
  grp: string;
  weight: number;
  judged: number;
  known_relevant: number;
  covered: Record<Slot, boolean>;
  comparable: boolean;
  status: string | null;
  versions: Record<Slot, VersionScore | null>;
  diffs?: Record<MetricKey, Record<ViewKey, Delta> & { absolute: Delta }>;
}

export interface Contribution {
  qid: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface AggregateView {
  value: number | null;
  applicable_count: number;
  not_applicable_count: number;
  zero_weight_count?: number;
  scoped_count: number;
  weight_sum?: number;
  contributions: Contribution[];
}

export interface Aggregate {
  metric: MetricKey;
  macro: AggregateView;
  weighted: AggregateView;
}

export interface Report {
  evaluation: { id: number; name: string; k: number; created_at: string; updated_at: string };
  k: number;
  labels: Record<Slot, string>;
  versions_present: Record<Slot, boolean>;
  queries: QueryRow[];
  comparison: {
    query_count: number;
    excluded_count: number;
    only_a: string[];
    only_b: string[];
    groups: { group: string; count: number; weights: number }[];
  };
  aggregates: Record<Slot, Record<MetricKey, Record<ViewKey, Aggregate>>>;
  deltas: Record<MetricKey, Record<ViewKey, { macro: Delta; weighted: Delta }>>;
  flags_summary: Record<string, number>;
  metric_labels: Record<MetricKey, string>;
}

export interface EvaluationSummary {
  id: number;
  name: string;
  k: number;
  created_at: string;
  updated_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join("；");
    } catch {
      /* keep the status text */
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  meta: () => request<{ metrics: MetricKey[]; metric_labels: Record<MetricKey, string>; grade_labels: Record<string, string> }>("/api/meta"),
  evaluations: () => request<{ evaluations: EvaluationSummary[] }>("/api/evaluations"),
  createEvaluation: (name: string, k: number) =>
    request<EvaluationSummary>("/api/evaluations", json("POST", { name, k })),
  patchEvaluation: (id: number, body: { name?: string; k?: number }) =>
    request<EvaluationSummary>(`/api/evaluations/${id}`, json("PATCH", body)),
  deleteEvaluation: (id: number) => request<void>(`/api/evaluations/${id}`, { method: "DELETE" }),
  report: (id: number) => request<Report>(`/api/evaluations/${id}/report`),
  queries: (id: number) =>
    request<{ queries: { qid: string; text: string; grp: string; weight: number; seq: number }[] }>(
      `/api/evaluations/${id}/queries`,
    ),
  patchQuery: (id: number, qid: string, body: { grp?: string; weight?: number }) =>
    request(`/api/evaluations/${id}/queries/${encodeURIComponent(qid)}`, json("PATCH", body)),
  judgments: (id: number) =>
    request<{ judgments: { qid: string; doc_id: string; grade: number }[] }>(
      `/api/evaluations/${id}/judgments`,
    ),
  seedDemo: (id: number) => request<{ ok: boolean }>(`/api/evaluations/${id}/seed-demo`, { method: "POST" }),
  importFile: (id: number, kind: "queries" | "judgments" | `ranking/${Slot}`, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<unknown>(`/api/evaluations/${id}/import/${kind}`, {
      method: "POST",
      body: form,
    });
  },
};
