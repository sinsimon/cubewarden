/** What the page's card table lists for the selected rule or mechanic. */
import type { Result } from "./evaluate.ts";

/** The All | Counted | Not counted control (Breaking | Passing for "every" rules). */
export type ShowCards = "all" | "match" | "miss";

export interface CardTableView {
  /** The rows, in the order given. */
  ids: string[];
  /** Cards counted (or breaking an "every" rule), marked in the table; null when nothing is marked. */
  marked: Set<string> | null;
  /** The All | Counted | Not counted control. */
  showControl: boolean;
  /** The column with the selection's value for each card. */
  valueColumn: boolean;
  /** The "Show others" toggle: counts only (mechanics and count rules), whose value column would just repeat "counts". */
  othersToggle: boolean;
}

/**
 * A count (a mechanic or a count rule) lists only the cards it counts, unless `showOthers`: then every card, as for the
 * other rules, with the control, the value column and the counted cards marked. Nothing selected, or an error: every card.
 */
export function cardTableView(ids: readonly string[], res: Result | null | undefined, opts: { show: ShowCards; showOthers: boolean }): CardTableView {
  const hit = res && res.cards && res.status !== "error" ? new Set(res.cards) : null;
  if (!res || !hit) return { ids: ids.slice(), marked: null, showControl: false, valueColumn: true, othersToggle: false };
  const isCount = (res.measure || { kind: "count" }).kind === "count";
  if (isCount && !opts.showOthers) return { ids: ids.filter((id) => hit.has(id)), marked: null, showControl: false, valueColumn: false, othersToggle: true };
  const rows = opts.show === "match" ? ids.filter((id) => hit.has(id)) : opts.show === "miss" ? ids.filter((id) => !hit.has(id)) : ids.slice();
  return { ids: rows, marked: hit, showControl: true, valueColumn: true, othersToggle: isCount };
}
