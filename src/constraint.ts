import type { Constraint, Metric } from "./model.ts";
import { METRICS } from "./fields.ts";

export type Status = "ok" | "near" | "fail" | "none" | "nodata" | "error";

export function inConstraint(v: number | null, c: Constraint | null | undefined): boolean {
  if (!c || v == null) return true;
  switch (c.kind) {
    case "min": return v >= c.min;
    case "max": return v <= c.max;
    case "exact": return v === c.value;
    case "range": return v >= c.min && v <= c.max;
  }
}

/** Distance outside the constraint (0 when inside). Positive = above, negative = below. */
export function gap(v: number | null, c: Constraint | null | undefined): number {
  if (!c || v == null) return 0;
  const lo = c.kind === "min" ? c.min : c.kind === "exact" ? c.value : c.kind === "range" ? c.min : -Infinity;
  const hi = c.kind === "max" ? c.max : c.kind === "exact" ? c.value : c.kind === "range" ? c.max : Infinity;
  return v < lo ? v - lo : v > hi ? v - hi : 0;
}

/** ok | near | fail | none | nodata. near = outside by at most 1 card (counts), 1 WR point or 0.25 of another metric (averages). */
export function statusOf(v: number | null, c: Constraint | null | undefined, kind: "count" | "avg", metric?: Metric): Status {
  if (!c) return "none";
  if (v == null) return "nodata";
  const g = Math.abs(gap(v, c));
  if (g === 0) return "ok";
  const tol = kind === "avg" ? (metric === "wrAdj" || metric === "wrRaw" ? 0.01 : 0.25) : 1;
  return g <= tol + 1e-9 ? "near" : "fail";
}

export function formatConstraint(c: Constraint | null | undefined, metric?: Metric): string {
  if (!c) return "no target";
  const f = c.unit === "percent" ? (x: number) => x + "%" : metric ? METRICS[metric].format : (x: number) => String(x);
  switch (c.kind) {
    case "min": return "≥ " + f(c.min);
    case "max": return "≤ " + f(c.max);
    case "exact": return "= " + f(c.value);
    case "range": return f(c.min) + "–" + f(c.max);
  }
}
