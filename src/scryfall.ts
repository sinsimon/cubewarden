/** Opening a filter on Scryfall. */
import type { Condition, Filter, FieldId, Mechanic } from "./model.ts";
import { WUBRG } from "./colors.ts";
import { describeFilter } from "./describe.ts";
import { conditionToText } from "./syntax.ts";

const SKIP: FieldId[] = ["spellMv", "wrDelta", "wrRaw", "games", "member", "ccElo", "ccCubes", "ccPicks", "ccTag", "colorCount"];

export type ScryfallScope = { kind: "cube" } | { kind: "color"; color: string } | { kind: "archetype"; colors: string };

const quote = (v: string) => (/[\s()"]/.test(v) || v === "" ? `"${v}"` : v);

/** True when the whole query is one parenthesised group, e.g. "(a b)" but not "(a) (b)". Quoted text is ignored. */
function isGroup(s: string): boolean {
  if (!s.startsWith("(")) return false;
  let depth = 0, inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "(") depth++;
    else if (!inQuote && ch === ")" && --depth === 0) return i === s.length - 1;
  }
  return false;
}
const group = (s: string) => (isGroup(s) ? s : `(${s})`);

/** The mechanics member:<v> stands for (any, primary, secondary or one id); a mechanic without priority is primary. */
function memberMechanics(mechanics: Mechanic[], v: string): Mechanic[] {
  if (v === "any") return mechanics;
  if (v === "primary" || v === "secondary") return mechanics.filter((m) => (m.priority || "primary") === v);
  return mechanics.filter((m) => m.id === v);
}

/**
 * Filter (+ scope and allowed sets) → a Scryfall search. Conditions Scryfall cannot express (win rates,
 * CubeCobra data, spell mana values) are left out and listed in `skipped`. With the scope's `mechanics`, member:<id> becomes that
 * mechanic's filter and member:any / primary / secondary the OR of those mechanics; a member: that cannot be
 * resolved is skipped too.
 */
export function toScryfall(
  filter: Filter | Condition | null | undefined,
  opts: { scope?: ScryfallScope; sets?: string[]; mechanics?: Mechanic[] } = {},
) {
  const skipped: string[] = [];
  const sc = opts.scope;
  const scopeColors = sc ? (sc.kind === "archetype" ? sc.colors : sc.kind === "color" && WUBRG.includes(sc.color) ? sc.color : "") : "";
  const resolving = new Set<string>();
  function member(f: Condition): string {
    const ms = memberMechanics(opts.mechanics || [], String(f.value ?? "any")).filter((m) => !resolving.has(m.id));
    const parts: string[] = [];
    for (const m of ms) {
      resolving.add(m.id);
      parts.push(conv(m.filter));
      resolving.delete(m.id);
    }
    // No mechanic, or one Scryfall cannot narrow down: the condition is left out.
    if (!parts.length || parts.some((p) => !p)) { skipped.push(describeFilter(f)); return ""; }
    return (f.not ? "-" : "") + group(parts.join(" or "));
  }
  function conv(f: Filter | Condition | null | undefined): string {
    if (!f) return "";
    if ("field" in f) {
      if (f.field === "member") return member(f);
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
