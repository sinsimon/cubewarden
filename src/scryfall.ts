/** Opening a filter on Scryfall. */
import type { Condition, Filter, FieldId } from "./model.ts";
import { WUBRG } from "./colors.ts";
import { describeFilter } from "./describe.ts";
import { conditionToText } from "./syntax.ts";

const SKIP: FieldId[] = ["wrAdj", "wrRaw", "games", "member", "ccElo", "ccCubes", "ccPicks", "ccTag", "colorCount"];

export type ScryfallScope = { kind: "cube" } | { kind: "color"; color: string } | { kind: "archetype"; colors: string };

const quote = (v: string) => (/[\s()"]/.test(v) || v === "" ? `"${v}"` : v);

/**
 * Filter (+ scope and allowed sets) → a Scryfall search. Conditions Scryfall cannot express (win rates,
 * CubeCobra data, archetype membership) are left out and listed in `skipped`.
 */
export function toScryfall(filter: Filter | Condition | null | undefined, opts: { scope?: ScryfallScope; sets?: string[] } = {}) {
  const skipped: string[] = [];
  const sc = opts.scope;
  const scopeColors = sc ? (sc.kind === "archetype" ? sc.colors : sc.kind === "color" && WUBRG.includes(sc.color) ? sc.color : "") : "";
  function conv(f: Filter | Condition | null | undefined): string {
    if (!f) return "";
    if ("field" in f) {
      if (SKIP.includes(f.field)) { skipped.push(describeFilter(f)); return ""; }
      if (f.field === "colors" && f.value === "@scope") {
        if (!scopeColors) { skipped.push(describeFilter(f)); return ""; }
        return conditionToText({ ...f, value: scopeColors });
      }
      if (f.field === "set" && Array.isArray(f.value)) return (f.not ? "-" : "") + "(" + f.value.map((x) => "s:" + x).join(" or ") + ")";
      if (f.field === "keyword") return `${f.not ? "-" : ""}kw:${quote(String(f.value))}`;
      return conditionToText(f);
    }
    const items = f.items.map(conv).filter(Boolean);
    if (!items.length) return "";
    const s = items.join(f.op === "or" ? " or " : " ");
    return f.not ? `-(${s})` : items.length > 1 ? `(${s})` : s;
  }
  const parts = [conv(filter)];
  if (sc?.kind === "archetype") parts.push(`c<=${sc.colors.toLowerCase()} -c:c -t:land`);
  else if (sc?.kind === "color") parts.push(sc.color === "L" ? "t:land" : sc.color === "C" ? "c:c -t:land" : `c=${sc.color.toLowerCase()} -t:land`);
  if (opts.sets?.length) parts.push("(" + opts.sets.map((x) => "s:" + x).join(" or ") + ")");
  const query = parts.filter(Boolean).join(" ");
  return { query, skipped, url: "https://scryfall.com/search?" + new URLSearchParams({ q: query, unique: "cards", as: "grid", order: "cmc" }) };
}
