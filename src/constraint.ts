import type { Constraint, CurveBucket, Metric } from "./model.ts";
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

/** ok | near | fail | none | nodata. near = outside by at most 1 (a card for counts, a point for a count in percent),
 *  1 WR point (wr, wrraw) or 0.25 of another metric (averages). Curve buckets in percent use shareStatus instead. */
export function statusOf(v: number | null, c: Constraint | null | undefined, kind: "count" | "avg", metric?: Metric): Status {
  if (!c) return "none";
  if (v == null) return "nodata";
  const g = Math.abs(gap(v, c));
  if (g === 0) return "ok";
  const tol = kind === "avg" ? (metric === "wrRaw" ? 0.01 : metric === "wrDelta" ? 1 : 0.25) : 1;
  return g <= tol + 1e-9 ? "near" : "fail";
}

/** n of total as a percent, to one decimal (0 when total is 0). */
export function share(n: number, total: number): number {
  return total ? Math.round((1000 * n) / total) / 10 : 0;
}

/** Status of a curve bucket in percent holding n of the total filtered cards. near = one card away: moving one card
 *  of the filter into the bucket (when below) or out of it (when above) reaches or crosses the violated bound. The move
 *  is a swap with another bucket, so the total stays put: that is the largest one-card step, since adding a new card
 *  or dropping one from the filter moves the share less ((n+1)/total >= (n+1)/(total+1), (n-1)/total <= (n-1)/(total-1)).
 *  "Reaches or crosses" keeps a target narrower than one card (an exact 33% with 6 cards) near rather than unreachable.
 *  With no card in the filter there is nothing to move: a miss is a fail. */
export function shareStatus(n: number, total: number, c: Constraint): Status {
  const g = gap(share(n, total), c);
  if (g === 0) return "ok";
  if (!total) return "fail";
  const moved = g < 0 ? gap(share(n + 1, total), c) >= 0 : gap(share(n - 1, total), c) <= 0;
  return moved ? "near" : "fail";
}

export function formatConstraint(c: Constraint | null | undefined, metric?: Metric): string {
  if (!c) return "no target";
  const f = c.unit === "percent" ? (x: number) => x + "%" : (metric && METRICS[metric]?.format) || ((x: number) => String(x));
  switch (c.kind) {
    case "min": return "≥ " + f(c.min);
    case "max": return "≤ " + f(c.max);
    case "exact": return "= " + f(c.value);
    // Signed ends ("−1.0", "+3.0") read badly around a dash.
    case "range": return f(c.min) + (metric === "wrDelta" ? " to " : "–") + f(c.max);
  }
}

/** A curve bucket's name: "2", "1–3" for one to three, or "6+" for six and above. */
export function bucketLabel(b: Pick<CurveBucket, "mv" | "mvMax" | "plus">): string {
  return b.mv + (b.mvMax != null && b.mvMax > b.mv ? "–" + b.mvMax : "") + (b.plus ? "+" : "");
}

/** Whether a mana value (rounded down) falls in a curve bucket. */
export function inBucket(mv: number, b: Pick<CurveBucket, "mv" | "mvMax" | "plus">): boolean {
  const v = Math.floor(mv);
  return b.plus ? v >= b.mv : v >= b.mv && v <= Math.max(b.mv, b.mvMax ?? b.mv);
}
