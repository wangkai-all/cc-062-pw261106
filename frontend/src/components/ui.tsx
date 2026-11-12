import type { ReactNode } from "react";
import { deltaDirection, fmtDelta } from "../lib/format";

export function DeltaPill({ value, digits = 3 }: { value: number | null; digits?: number }) {
  const direction = deltaDirection(value);
  const cls = direction === "up" ? "delta-up" : direction === "down" ? "delta-down" : "delta-flat";
  return (
    <span className={`delta-pill ${cls}`} aria-label={`差值 ${fmtDelta(value, digits)}`}>
      {fmtDelta(value, digits)}
    </span>
  );
}

export function GradeBadge({ grade }: { grade: number | null }) {
  const cls = grade === null ? "grade-none" : `grade-${grade}`;
  return (
    <span className={`grade-badge ${cls}`} title={grade === null ? "未标注" : undefined}>
      {grade === null ? "?" : grade}
    </span>
  );
}

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "bad";
  children: ReactNode;
}) {
  return <span className={`chip ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          className="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="micro" style={{ marginLeft: 5 }}>
              {option.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="version-empty">{children}</div>;
}
