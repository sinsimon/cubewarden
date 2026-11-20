/**
 * Text syntax for filters and rules, in the style of CubeCobra and Scryfall.
 *
 * Filters: otag:counterspell t:creature o:"draw a card" kw:flying m:{X} mv>=4 pow>=4 tou<=2
 *          c=wu c>=u c<=wu c=scope c:c is:hybrid r:common s:fdn,trk !"Exact Name" name:bolt
 *          wr>=55% wrraw>=55% games>=500 elo>=1300 cubes>=1000 picks>=100 member:any ncolors>=2 tag:"CubeCobra tag"
 *          space = and, "or", ( ), "-" = not.
 * Rules:   count(F) >= 6 · count(F) in 13..14 · count(t:creature) >= 50% · count(c=scope -is:hybrid) = 3 fixed
 *          avg(wr, member:any) in 55%..60% · every(s:fdn,trk) · every(mv, t:creature) <= 5 · shorthand "F >= 6"
 */
import type { Condition, Constraint, Filter, Measure, Metric, RuleBody } from "./model.ts";
import { colorSet } from "./colors.ts";
import { isSupportedScryfallTerm } from "./scryfall-subset.ts";
import { slug } from "./slug.ts";

/** A text that cannot be read. `at` is the character offset where reading stopped, when known. */
export class SyntaxError extends Error {
  at?: number;
  constructor(message: string, at?: number) {
    super(message);
    this.name = "SyntaxError";
    this.at = at;
  }
}

const TERM_KEYS: Record<string, Condition["field"] | "is"> = {
  otag: "tag", oracletag: "tag", function: "tag", kw: "keyword", keyword: "keyword",
  t: "type", type: "type", o: "text", oracle: "text", text: "text", m: "manaCost", mana: "manaCost", name: "name",
  mv: "mv", cmc: "mv", manavalue: "mv", pow: "power", power: "power", tou: "toughness", toughness: "toughness",
  c: "colors", color: "colors", colors: "colors", ncolors: "colorCount", is: "is", r: "rarity", rarity: "rarity",
  s: "set", set: "set", e: "set", edition: "set", wr: "wrAdj", wradj: "wrAdj", adj: "wrAdj", wrraw: "wrRaw", gih: "wrRaw",
  games: "games", elo: "ccElo", cubes: "ccCubes", picks: "ccPicks", member: "member", tag: "ccTag",
};
const RARITY: Record<string, string> = { c: "common", u: "uncommon", r: "rare", m: "mythic" };
const KNOWN_KEYS = "otag:, t:, o:, kw:, m:, mv, pow, tou, c=, s:, r:, wr, wrraw, elo, cubes, picks, tag:, member:";

function termToCond(tok: string): Condition {
  let neg = false, t = tok;
  if (t.startsWith("-")) { neg = true; t = t.slice(1); }
  const withNot = (c: Condition): Condition => (neg ? { ...c, not: !c.not } : c);
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^!"([^"]*)"$/))) return withNot({ field: "name", op: "is", value: m[1] });
  if (!(m = t.match(/^([A-Za-z]+)(<=|>=|!=|:|=|<|>)(.+)$/))) return withNot({ field: "name", op: "contains", value: t.replace(/^"|"$/g, "") });
  const key = m[1].toLowerCase(), opRaw = m[2], value = m[3].replace(/^"|"$/g, "");
  const field = TERM_KEYS[key];
  if (!field) {
    if (isSupportedScryfallTerm(t)) return withNot({ field: "scryfall", op: "matches", value: t });
    throw new SyntaxError(`Unknown filter "${m[1]}" (try ${KNOWN_KEYS})`);
  }
  if (opRaw === "!=") { const c = termToCond(`${m[1]}=${m[3]}`); return withNot({ ...c, not: !c.not }); }
  switch (field) {
    case "tag": return withNot({ field, op: "is", value: slug(value) });
    case "keyword": return withNot({ field, op: "is", value: value.toLowerCase() });
    case "type": case "text": return withNot({ field, op: "contains", value: value.toLowerCase() });
    case "manaCost": return withNot({ field, op: "contains", value });
    case "name": return withNot({ field, op: "contains", value });
    case "colors": {
      const v = value.toLowerCase();
      const op = opRaw === "=" ? "is" : opRaw === "<=" ? "within" : "includes";
      if (v === "scope") return withNot({ field, op, value: "@scope" });
      if (v === "c" || v === "colorless") return withNot({ field, op: "is", value: "" });
      return withNot({ field, op, value: colorSet(v) });
    }
    case "is":
      if (value.toLowerCase() === "hybrid") return withNot({ field: "hybrid", op: "is", value: true });
      throw new SyntaxError(`"is:${value}" is not supported (only is:hybrid)`);
    case "rarity": {
      const vals = value.toLowerCase().split(",").map((x) => RARITY[x] || x);
      return withNot(vals.length > 1 ? { field, op: "in", value: vals } : { field, op: "is", value: vals[0] });
    }
    case "set": {
      const vals = value.toLowerCase().split(",");
      return withNot(vals.length > 1 ? { field, op: "in", value: vals } : { field, op: "is", value: vals[0] });
    }
    case "member": case "ccTag": return withNot({ field, op: "is", value });
    default:
      return withNot({ field, op: opRaw === ":" ? "=" : (opRaw as Condition["op"]), value: metricValue(value, field as Metric) });
  }
}

function tokenize(src: string): string[] {
  const re = /\s*(\(|\)|-?!"[^"]*"|-?[A-Za-z]+(?:<=|>=|!=|:|=|<|>)(?:"[^"]*"|[^\s()]+)|-(?=\()|[^\s()]+)/y;
  const out: string[] = [];
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(re.lastIndex))) break;
    const at = re.lastIndex;
    const m = re.exec(src);
    if (!m) throw new SyntaxError(`Cannot read the filter near "${src.slice(at, at + 15)}"`, at);
    out.push(m[1]);
  }
  return out;
}

/** Text → Filter tree. Throws SyntaxError with a readable message. */
export function parseFilter(src: string): Filter {
  const toks = tokenize(String(src || "").trim());
  let i = 0;
  const peek = () => toks[i];
  const isWord = (t: string | undefined, w: string) => t != null && t.toLowerCase() === w;
  const asGroup = (e: Condition | Filter): Filter => ("field" in e ? { op: "and", items: [e] } : e);
  function expr(): Condition | Filter {
    const parts = [andExpr()];
    while (isWord(peek(), "or")) { i++; parts.push(andExpr()); }
    return parts.length === 1 ? parts[0] : { op: "or", items: parts };
  }
  function andExpr(): Condition | Filter {
    const parts: (Condition | Filter)[] = [];
    while (peek() && peek() !== ")" && !isWord(peek(), "or")) {
      if (isWord(peek(), "and")) { i++; continue; }
      parts.push(unary());
    }
    if (!parts.length) throw new SyntaxError("Empty condition (check 'or' and parentheses)");
    return parts.length === 1 ? parts[0] : { op: "and", items: parts };
  }
  function unary(): Condition | Filter {
    const t = toks[i++];
    if (t === "-" && peek() === "(") { const g = group(); return { ...g, not: !g.not }; }
    if (t === "(") { i--; return group(); }
    return termToCond(t);
  }
  function group(): Filter {
    i++;
    const e = expr();
    if (toks[i++] !== ")") throw new SyntaxError("Missing closing parenthesis");
    return asGroup(e);
  }
  if (!toks.length) return { op: "and", items: [] };
  const e = expr();
  if (i < toks.length) throw new SyntaxError(`Unexpected "${toks[i]}"`);
  return asGroup(e);
}

interface Target { kind: string; a: string; b?: string }

function splitTarget(src: string): { head: string; target: Target | null; absolute: boolean } {
  let rest = src.trim(), absolute = false;
  let m: RegExpMatchArray | null;
  if (/\s+fixed$/i.test(rest)) { absolute = true; rest = rest.replace(/\s+fixed$/i, ""); }
  if ((m = rest.match(/^(.*?)\s+(?:in\s+)?(-?[\d.]+%?)\s*\.\.\s*(-?[\d.]+%?)$/i))) return { head: m[1], target: { kind: "range", a: m[2], b: m[3] }, absolute };
  if ((m = rest.match(/^(.*?)\s*(>=|<=|=|>|<)\s*(-?[\d.]+%?)$/))) return { head: m[1], target: { kind: m[2], a: m[3] }, absolute };
  return { head: rest, target: null, absolute };
}

function number(v: string): number {
  const n = Number(v.replace(/%$/, ""));
  if (!Number.isFinite(n)) throw new SyntaxError(`"${v}" is not a number`);
  return n;
}

/** Win rates are fractions inside the model (0.55) and percentages in text (55%). */
function metricValue(v: string, metric?: Metric): number {
  const n = number(v);
  if (metric === "wrAdj" || metric === "wrRaw") return /%$/.test(v) || n > 1 ? n / 100 : n;
  return n;
}

function toConstraint(t: Target | null, metric: Metric | undefined, isCount: boolean): Constraint | null {
  if (!t) return null;
  const percent = isCount && /%$/.test(t.a);
  const val = (x: string) => (isCount ? number(x) : metricValue(x, metric));
  const step = isCount && !percent ? 1 : 0;
  let c: Constraint;
  if (t.kind === "range") c = { kind: "range", min: val(t.a), max: val(t.b!) };
  else if (t.kind === "=") c = { kind: "exact", value: val(t.a) };
  else if (t.kind === ">=") c = { kind: "min", min: val(t.a) };
  else if (t.kind === ">") c = { kind: "min", min: val(t.a) + step };
  else if (t.kind === "<=") c = { kind: "max", max: val(t.a) };
  else c = { kind: "max", max: val(t.a) - step };
  if (percent) c.unit = "percent";
  return c;
}

function insideParens(s: string, name: string): string | null {
  const m = s.match(new RegExp("^" + name + "\\s*\\((.*)\\)$", "i"));
  return m ? m[1] : null;
}

const MEASURE_METRIC: Record<string, Metric> = {
  wr: "wrAdj", wradj: "wrAdj", adj: "wrAdj", wrraw: "wrRaw", gih: "wrRaw", mv: "mv", pow: "power", power: "power",
  elo: "ccElo", cubes: "ccCubes", picks: "ccPicks",
};
const METRIC_TEXT: Record<Metric, string> = {
  wrAdj: "wr", wrRaw: "wrraw", mv: "mv", power: "pow", ccElo: "elo", ccCubes: "cubes", ccPicks: "picks", colorCount: "ncolors",
};

/** Text → { measure, filter, constraint } for a rule or a mechanic. */
export function parseRule(src: string): RuleBody {
  const { head, target, absolute } = splitTarget(String(src || ""));
  let inner: string | null;
  let measure: Measure;
  let filterText = "";
  if ((inner = insideParens(head, "count")) != null || /^count$/i.test(head)) {
    measure = { kind: "count" };
    filterText = inner || "";
  } else if ((inner = insideParens(head, "avg")) != null) {
    const [m0, ...rest] = inner.split(",");
    const metric = MEASURE_METRIC[m0.trim().toLowerCase()];
    if (!metric) throw new SyntaxError(`Unknown metric "${m0.trim()}" (wr, wrraw, mv, pow, elo, cubes, picks)`);
    measure = { kind: "avg", metric };
    filterText = rest.join(",");
  } else if ((inner = insideParens(head, "every")) != null) {
    const parts = inner.split(",");
    const metric = MEASURE_METRIC[parts[0].trim().toLowerCase()];
    if (metric && (parts.length > 1 || target)) {
      measure = { kind: "every", metric };
      filterText = parts.slice(1).join(",");
    } else {
      measure = { kind: "every" };
      filterText = inner;
    }
  } else {
    measure = { kind: "count" };
    filterText = head;
  }
  if (absolute && measure.kind === "count") measure.absolute = true;
  const filter = parseFilter(filterText);
  const metric = measure.kind === "count" ? undefined : measure.metric;
  return { measure, filter: filter.items.length ? filter : null, constraint: toConstraint(target, metric, measure.kind === "count") };
}

// ---------- writing ----------
const TEXT_KEY: Partial<Record<Condition["field"], string>> = {
  tag: "otag", keyword: "kw", type: "t", text: "o", manaCost: "m", mv: "mv", power: "pow", toughness: "tou",
  colorCount: "ncolors", rarity: "r", set: "s", wrAdj: "wr", wrRaw: "wrraw", games: "games", ccElo: "elo",
  ccCubes: "cubes", ccPicks: "picks", member: "member", ccTag: "tag",
};
const RARITY_LETTER: Record<string, string> = { common: "common", uncommon: "uncommon", rare: "rare", mythic: "mythic" };

const quote = (v: string) => (/[\s()"]/.test(v) || v === "" ? `"${v}"` : v);
const pctText = (x: number) => +(x * 100).toFixed(1) + "%";

export function conditionToText(c: Condition): string {
  const neg = c.not ? "-" : "";
  const v = c.value;
  switch (c.field) {
    case "name": return c.op === "is" ? `${neg}!"${v}"` : `${neg}name:${quote(String(v))}`;
    case "hybrid": return (v ? neg : neg ? "" : "-") + "is:hybrid";
    case "colors": {
      if (v === "") return `${neg}c:c`;
      const val = v === "@scope" ? "scope" : String(v).toLowerCase();
      return `${neg}c${c.op === "is" ? "=" : c.op === "within" ? "<=" : ">="}${val}`;
    }
    case "set": return `${neg}s:${([] as unknown[]).concat(v).join(",")}`;
    case "rarity": return `${neg}r:${([] as unknown[]).concat(v).map((x) => RARITY_LETTER[String(x)] || x).join(",")}`;
    case "wrAdj": case "wrRaw": return `${neg}${TEXT_KEY[c.field]}${c.op}${pctText(Number(v))}`;
    case "scryfall": return /\s/.test(String(v)) ? `${neg}(${v})` : `${neg}${v}`;
    case "tag": case "keyword": case "type": case "text": case "manaCost": case "member": case "ccTag":
      return `${neg}${TEXT_KEY[c.field]}:${quote(String(v))}`;
    default: return `${neg}${TEXT_KEY[c.field] || c.field}${c.op}${v}`;
  }
}

/** Filter tree → text. */
export function filterToText(f: Filter | Condition | null | undefined, nested = false): string {
  if (!f) return "";
  if ("field" in f) return conditionToText(f);
  const items = f.items.map((x) => filterToText(x, true)).filter(Boolean);
  let s = items.join(f.op === "or" ? " or " : " ");
  if (f.not) return `-(${s})`;
  if (nested && items.length > 1) s = `(${s})`;
  return s;
}

function targetText(c: Constraint | null | undefined, metric?: Metric): string {
  if (!c) return "";
  const f = c.unit === "percent" ? (x: number) => x + "%" : metric === "wrAdj" || metric === "wrRaw" ? pctText : (x: number) => String(x);
  switch (c.kind) {
    case "min": return ` >= ${f(c.min)}`;
    case "max": return ` <= ${f(c.max)}`;
    case "exact": return ` = ${f(c.value)}`;
    case "range": return ` in ${f(c.min)}..${f(c.max)}`;
  }
}

/** Rule or mechanic → text. */
export function ruleToText(r: { measure?: Measure; filter?: Filter | null; constraint?: Constraint | null }): string {
  const m: Measure = r.measure || { kind: "count" };
  const ft = filterToText(r.filter);
  let head: string;
  if (m.kind === "avg") head = `avg(${METRIC_TEXT[m.metric]}${ft ? ", " + ft : ""})`;
  else if (m.kind === "every") head = m.metric ? `every(${METRIC_TEXT[m.metric]}${ft ? ", " + ft : ""})` : `every(${ft})`;
  else head = `count(${ft})`;
  const metric = m.kind === "count" ? undefined : m.metric;
  return head + targetText(r.constraint, metric) + (m.kind === "count" && m.absolute ? " fixed" : "");
}
