/** Matching cards against filters. */
import type { Card, Condition, Filter, Metric } from "./model.ts";
import { colorSet } from "./colors.ts";
import { FIELD } from "./fields.ts";
import { cmp, FilterError, num, scryMatches } from "./scryfall-subset.ts";
import { slug } from "./slug.ts";

export { FilterError };

/** Where a filter is evaluated: the scope's colours (for "@scope") and archetype membership (for member:). */
export interface MatchContext {
  scopeColors?: string;
  member?: (cardId: string, mechanicId: string) => boolean;
}

export const isLand = (c: Card) => /\bLand\b/.test(c.type.split("//")[0]);
export const isCreature = (c: Card) => /\bCreature\b/.test(c.type.split("//")[0]);

export function metricOf(card: Card, metric: Metric | Condition["field"]): number | null {
  if (metric === "colorCount") return card.colors.length;
  return num((card as unknown as Record<string, unknown>)[metric]);
}

function conditionMatches(card: Card, cond: Condition, ctx?: MatchContext): boolean {
  if (!FIELD[cond.field]) throw new FilterError("Unknown field " + cond.field);
  const v = cond.value;
  const s = String(v).toLowerCase();
  let r: boolean;
  switch (cond.field) {
    case "name": r = cond.op === "is" ? card.name.toLowerCase() === s : card.name.toLowerCase().includes(s); break;
    case "tag": r = card.tags.includes(slug(String(v))); break;
    case "keyword": r = card.keywords.includes(s); break;
    case "type": r = card.type.toLowerCase().includes(s); break;
    case "text": r = card.text.toLowerCase().includes(s); break;
    case "manaCost": r = (card.manaCost || "").toLowerCase().includes(s); break;
    case "colors": {
      if (v === "@scope" && ctx?.scopeColors == null) throw new FilterError("'Colours of this scope' only works in a colour or archetype");
      const want = v === "@scope" ? ctx!.scopeColors! : colorSet(String(v));
      const own = card.colors;
      r = cond.op === "is" ? own === want
        : cond.op === "includes" ? [...want].every((x) => own.includes(x))
        : own !== "" && [...own].every((x) => want.includes(x));
      break;
    }
    case "hybrid": r = !!card.hybrid === !!v; break;
    case "set": {
      const want = ([] as unknown[]).concat(v).map((x) => String(x).toLowerCase());
      r = (card.printSets?.length ? card.printSets : [card.set]).some((x) => want.includes(String(x).toLowerCase()));
      break;
    }
    case "rarity": r = cond.op === "in" ? ([] as unknown[]).concat(v).includes(card.rarity) : card.rarity === v; break;
    case "ccTag": r = (card.ccTags || []).some((t) => t.toLowerCase() === s); break;
    case "member":
      if (!ctx?.member) throw new FilterError("'Archetype member' only works inside an archetype");
      r = ctx.member(card.id, String(v));
      break;
    case "scryfall": r = scryMatches(card, String(v)); break;
    default: r = cmp(metricOf(card, cond.field), cond.op, Number(v));
  }
  return cond.not ? !r : r;
}

/** True when the card matches. A null filter matches every card. Throws FilterError when the filter cannot run here. */
export function matches(card: Card, filter: Filter | Condition | null | undefined, ctx?: MatchContext): boolean {
  if (!filter) return true;
  if ("field" in filter) return conditionMatches(card, filter, ctx);
  let r: boolean;
  if (filter.items.length === 0) r = true;
  else if (filter.op === "or") r = filter.items.some((x) => matches(card, x, ctx));
  else r = filter.items.every((x) => matches(card, x, ctx));
  return filter.not ? !r : r;
}

/** Problems in a filter, in plain words; empty when it can run. Scryfall terms are tried on an empty card. */
export function validateFilter(filter: Filter | Condition | null | undefined): string[] {
  const errors: string[] = [];
  const probe: Card = { id: "", name: "", colors: "", identity: "", manaCost: "", hybrid: false, type: "", mv: 0, power: null, toughness: null,
    text: "", keywords: [], tags: [], set: null, number: null, rarity: null, printSets: [], image: null };
  (function walk(f: Filter | Condition | null | undefined) {
    if (!f) return;
    if ("field" in f) {
      const info = FIELD[f.field];
      if (!info) errors.push("Unknown field " + f.field);
      else if (!info.ops.includes(f.op)) errors.push(`Operator "${f.op}" not valid for ${info.label}`);
      if (f.field === "scryfall") {
        try { scryMatches(probe, String(f.value)); } catch (e) { errors.push((e as Error).message); }
      }
      return;
    }
    f.items.forEach(walk);
  })(filter);
  return errors;
}
