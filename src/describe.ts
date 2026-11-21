import type { Condition, Filter } from "./model.ts";
import { FIELD, pct, points } from "./fields.ts";

/** Human-readable one-liner, e.g. (oracle tag is removal-creature OR keyword is flying) AND NOT type line contains land */
export function describeFilter(filter: Filter | Condition | null | undefined): string {
  if (!filter) return "all cards";
  if ("field" in filter) {
    const label = FIELD[filter.field]?.label.toLowerCase() ?? filter.field;
    const not = filter.not ? "NOT " : "";
    if (filter.value === "@scope") return `${not}${label} ${filter.op} this scope's colours`;
    const v = filter.value;
    const val = Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "…" : filter.field === "wrRaw" ? pct(Number(v)) : filter.field === "wrDelta" ? points(Number(v)) : String(v);
    return `${not}${label} ${filter.op} ${val}`;
  }
  const parts = filter.items.map((x) => ("items" in x && x.items.length > 1 ? `(${describeFilter(x)})` : describeFilter(x)));
  const s = parts.join(filter.op === "or" ? " OR " : " AND ") || "all cards";
  return filter.not ? `NOT (${s})` : s;
}
