/** The subset of Scryfall search syntax the engine can evaluate on its own card data. */
import type { Card } from "./model.ts";
import { colorSet } from "./colors.ts";
import { slug } from "./slug.ts";

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

export function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function cmp(a: number | null, op: string, b: number): boolean {
  if (a == null) return false;
  switch (op) {
    case "=": return a === b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
  }
  throw new FilterError("Unknown operator " + op);
}

const unq = (s: string) => s.replace(/^"|"$/g, "");

/** One positive Scryfall term (no leading "-") against a card. Throws FilterError for terms outside the subset. */
export function scryPositive(c: Card, t: string, raw: string = t): boolean {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(otag|oracletag|function):(.+)$/i))) return c.tags.includes(slug(unq(m[2])));
  if ((m = t.match(/^(keyword|kw):(.+)$/i))) return c.keywords.includes(unq(m[2]).toLowerCase());
  if ((m = t.match(/^(t|type):(.+)$/i))) return c.type.toLowerCase().includes(unq(m[2]).toLowerCase());
  if ((m = t.match(/^(o|oracle):(.+)$/i))) return c.text.toLowerCase().includes(unq(m[2]).toLowerCase());
  if ((m = t.match(/^(m|mana):(.+)$/i))) return (c.manaCost || "").toLowerCase().includes(unq(m[2]).toLowerCase());
  if ((m = t.match(/^name:(.+)$/i))) return c.name.toLowerCase().includes(unq(m[1]).toLowerCase());
  if ((m = t.match(/^(mv|cmc|manavalue|pow|power|tou|toughness)(<=|>=|=|<|>|:)(\d+(?:\.\d+)?)$/i))) {
    const f = ({ mv: "mv", cmc: "mv", manavalue: "mv", pow: "power", power: "power", tou: "toughness", toughness: "toughness" } as const)[
      m[1].toLowerCase() as "mv"
    ];
    return cmp(num(c[f]), m[2] === ":" ? "=" : m[2], Number(m[3]));
  }
  if ((m = t.match(/^(c|color|id|identity)(<=|>=|=|:|<|>)([wubrgc]+)$/i))) {
    const identity = m[1].toLowerCase().startsWith("i");
    const own = identity ? colorSet(c.identity) : c.colors;
    const want = m[3].toLowerCase() === "c" ? "" : colorSet(m[3]);
    const sub = [...own].every((x) => want.includes(x));
    const sup = [...want].every((x) => own.includes(x));
    switch (m[2]) {
      case ":": return identity ? sub : want === "" ? own === "" : sup;
      case "=": return sub && sup;
      case "<=": return sub;
      case ">=": return sup;
      case "<": return sub && !sup;
      case ">": return sup && !sub;
    }
  }
  if ((m = t.match(/^(r|rarity):(\w+)$/i))) return (c.rarity || "")[0] === m[2].toLowerCase()[0];
  if ((m = t.match(/^(s|set|e|edition):(\w+)$/i))) return (c.set || "").toLowerCase() === m[2].toLowerCase();
  if (/^is:hybrid$/i.test(t)) return !!c.hybrid;
  if (/^produces=wubrg$/i.test(t)) return /any color/i.test(c.text);
  throw new FilterError(`Scryfall term not supported: "${raw}"`);
}

function scryTerm(card: Card, raw: string): boolean {
  const neg = raw.startsWith("-");
  const r = scryPositive(card, neg ? raw.slice(1) : raw, raw);
  return neg ? !r : r;
}

/** A Scryfall query in the subset: terms joined by spaces (and) and "or"; no parentheses. */
export function scryMatches(card: Card, query: string): boolean {
  if (/[()]/.test(query)) throw new FilterError("Parentheses are not supported inside a Scryfall query");
  return query.split(/\s+or\s+/i).some((part) => (part.match(/-?\w+[:<>=]+"[^"]+"|\S+/g) || []).every((t) => scryTerm(card, t)));
}

/** True when a term is inside the subset (checked against an empty card). */
export function isSupportedScryfallTerm(t: string): boolean {
  const probe: Card = {
    id: "", name: "", colors: "", identity: "", manaCost: "", hybrid: false, type: "", mv: 0, power: null, toughness: null,
    text: "", keywords: [], tags: [], set: null, number: null, rarity: null, printSets: [], image: null,
  };
  try {
    scryPositive(probe, t);
    return true;
  } catch {
    return false;
  }
}
