export const fmt = (value: number | null | undefined, digits = 3): string =>
  value === null || value === undefined ? "—" : value.toFixed(digits);

export const fmtDelta = (value: number | null | undefined, digits = 3): string => {
  if (value === null || value === undefined) return "—";
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return "0.000";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(digits)}`;
};

export const fmtWeight = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

export type Direction = "up" | "down" | "flat";

export const deltaDirection = (value: number | null | undefined, epsilon = 0.0005): Direction => {
  if (value === null || value === undefined || Math.abs(value) < epsilon) return "flat";
  return value > 0 ? "up" : "down";
};

export const gradeLabel = (grade: number | null): string =>
  grade === null ? "未标注" : ["不相关", "部分相关", "相关", "高度相关"][grade];
