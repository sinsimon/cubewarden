/** Evaluating a config against a cube: every rule and mechanic in every scope. */
import type { Card, Config, Constraint, Measure, Mechanic, Priority, Rule, Scope } from "./model.ts";
import { bucketLabel, gap, inConstraint, statusOf, type Status } from "./constraint.ts";
import { isLand, matches, metricOf, type MatchContext } from "./filter.ts";
import { WUBRG } from "./colors.ts";

/** One mana value of a curve rule: its count (scaled like counts) or share in %, and how it compares with its target. */
export interface CurveBucketResult {
  label: string;
  mv: number;
  plus?: boolean;
  value: number;
  /** Unscaled number of cards. */
  raw: number;
  constraint: Constraint;
  status: Status;
}

export interface Result {
  kind: "rule" | "mechanic";
  id: string;
  name: string;
  priority: Priority;
  measure: Measure;
  constraint: Constraint | null;
  scope?: Scope;
  /** The number compared with the target: a (scaled) count, a share in %, an average, the cards breaking an "every" rule,
   *  or the curve buckets out of range. */
  value: number | null;
  /** Unscaled count, for counts. */
  raw?: number;
  status: Status;
  gap: number;
  /** Cards counted (count, avg) or breaking the rule (every). */
  cards: string[];
  /** Per card in the scope: matched (count, every) or the card's metric (avg, every with a metric, curve: mana value). */
  perCard: Record<string, boolean | number | null>;
  /** Curves: one entry per written bucket. */
  buckets?: CurveBucketResult[];
  /** Averages: cards with a value, and cards without data. */
  n?: number;
  noData?: number;
  error?: string;
  inherited?: boolean;
  from?: "allColors" | "allArchetypes";
}

export interface ScopeStatus { primary: Status; all: Status }

export interface ScopeReport { cards: string[]; mechanics: Result[]; rules: Result[]; status: ScopeStatus }
export interface ArchetypeReport extends ScopeReport { members: string[]; membersScaled: number }

/** One shared rule ("all colours" / "all archetypes") and its result in each scope it applies to. */
export interface SharedSummary {
  id: string;
  name: string;
  priority: Priority;
  measure: Measure;
  constraint: Constraint | null;
  byScope: Record<string, Result>;
  counts: { ok: number; near: number; fail: number; error: number };
  status: Status;
}

export interface Report {
  size: number;
  targetSize: number | null;
  factor: number;
  cube: { cards: string[]; rules: Result[]; status: ScopeStatus };
  colors: Record<string, ScopeReport>;
  archetypes: Record<string, ArchetypeReport>;
  allColors: { rules: SharedSummary[]; status: ScopeStatus };
  allArchetypes: { rules: SharedSummary[]; status: ScopeStatus };
}

/** The cards of a colour scope: W U B R G = mono-coloured nonland, C = colourless nonland, L = lands. */
export function colorPool(cards: Card[], code: string): Card[] {
  if (code === "L") return cards.filter(isLand);
  if (code === "C") return cards.filter((c) => c.colors === "" && !isLand(c));
  return cards.filter((c) => c.colors === code && !isLand(c));
}

/** The cards an archetype draws from: nonland cards in its colours (a subset of them) and colourless nonland cards. */
export function archetypePool(cards: Card[], colors: string): Card[] {
  return cards.filter((c) => !isLand(c) && [...c.colors].every((x) => colors.includes(x)));
}

export function scopeCards(scope: Scope, cards: Card[], config: Config): Card[] {
  if (scope.kind === "color") return colorPool(cards, scope.color);
  if (scope.kind === "archetype") {
    const a = config.archetypes.find((x) => x.id === scope.id);
    return a ? archetypePool(cards, a.colors) : [];
  }
  return cards;
}

export function measureMechanic(mech: Mechanic, pool: Card[], ctx: MatchContext | undefined, factor: number): Result {
  const rule: Rule = { id: mech.id, name: mech.name, priority: mech.priority, scope: { kind: "allColors" }, measure: { kind: "count" },
    filter: mech.filter, constraint: mech.constraint };
  const r = measureRule(rule, pool, ctx, factor);
  delete r.scope;
  return { ...r, kind: "mechanic" };
}

/** member:any, member:primary, member:secondary or member:<mechanic id>, from a scope's measured mechanics. */
function memberOf(mechanics: Result[]): NonNullable<MatchContext["member"]> {
  const cards = (rs: Result[]) => new Set(rs.flatMap((r) => r.cards));
  const sets = new Map<string, Set<string>>(mechanics.map((r) => [r.id, new Set(r.cards)]));
  sets.set("any", cards(mechanics));
  sets.set("primary", cards(mechanics.filter((r) => r.priority === "primary")));
  sets.set("secondary", cards(mechanics.filter((r) => r.priority === "secondary")));
  return (id, v) => !!sets.get(v ?? "any")?.has(id);
}

const ORDER: Record<Status, number> = { error: 5, fail: 4, near: 3, nodata: 2, ok: 1, none: 0 };

export function worst(results: { status: Status; priority?: Priority }[]): ScopeStatus {
  const top = (rs: typeof results) => rs.reduce<Status>((w, r) => (ORDER[r.status] > ORDER[w] ? r.status : w), "none");
  return { primary: top(results.filter((r) => r.priority !== "secondary")), all: top(results) };
}

function errorResult(base: Omit<Result, "value" | "status" | "gap" | "cards" | "perCard">, e: unknown): Result {
  return { ...base, value: null, status: "error", gap: 0, cards: [], perCard: {}, error: e instanceof Error ? e.message : String(e) };
}

export function measureRule(rule: Rule, pool: Card[], ctx: MatchContext | undefined, factor: number): Result {
  const m: Measure = rule.measure || { kind: "count" };
  const constraint = rule.constraint || null;
  const base = { kind: "rule" as const, id: rule.id, name: rule.name, priority: rule.priority || "primary", constraint, measure: m, scope: rule.scope };
  try {
    const hit = pool.filter((c) => matches(c, rule.filter, ctx));
    if (m.kind === "count") {
      const ids = new Set(hit.map((c) => c.id));
      const value = constraint?.unit === "percent"
        ? pool.length ? Math.round((1000 * hit.length) / pool.length) / 10 : 0
        : Math.round(hit.length * (rule.scope.kind === "cube" || m.absolute ? 1 : factor));
      return { ...base, value, raw: hit.length, status: statusOf(value, constraint, "count"), gap: gap(value, constraint),
        cards: [...ids], perCard: Object.fromEntries(pool.map((c) => [c.id, ids.has(c.id)])) };
    }
    if (m.kind === "curve") {
      const scale = rule.scope.kind === "cube" || m.absolute ? 1 : factor;
      const buckets = m.buckets.map((b): CurveBucketResult => {
        const n = hit.filter((c) => (b.plus ? Math.floor(c.mv) >= b.mv : Math.floor(c.mv) === b.mv)).length;
        const value = b.constraint.unit === "percent" ? (hit.length ? Math.round((1000 * n) / hit.length) / 10 : 0) : Math.round(n * scale);
        return { label: bucketLabel(b), mv: b.mv, ...(b.plus ? { plus: true } : {}), value, raw: n, constraint: b.constraint,
          status: statusOf(value, b.constraint, "count") };
      });
      const misses = buckets.filter((b) => b.status !== "ok");
      const status: Status = !buckets.length ? "none" : !misses.length ? "ok" : misses.every((b) => b.status === "near") ? "near" : "fail";
      return { ...base, value: misses.length, raw: hit.length, status, gap: misses.length, buckets,
        cards: hit.map((c) => c.id), perCard: Object.fromEntries(hit.map((c) => [c.id, c.mv])) };
    }
    if (m.kind === "avg") {
      const vals = hit.map((c) => [c.id, metricOf(c, m.metric)] as const);
      const known = vals.filter((x) => x[1] != null) as (readonly [string, number])[];
      const value = known.length ? known.reduce((s, x) => s + x[1], 0) / known.length : null;
      return { ...base, value, n: known.length, noData: vals.length - known.length, status: statusOf(value, constraint, "avg", m.metric),
        gap: gap(value, constraint), cards: hit.map((c) => c.id), perCard: Object.fromEntries(vals) };
    }
    // every: each card in scope must match the filter, or (with a metric) the filtered cards must have the metric in the target.
    let bad: Card[];
    let noData = 0;
    let perCard: Result["perCard"];
    if (m.metric) {
      bad = hit.filter((c) => {
        const v = metricOf(c, m.metric!);
        if (v == null) { noData++; return false; }
        return !inConstraint(v, constraint);
      });
      perCard = Object.fromEntries(hit.map((c) => [c.id, metricOf(c, m.metric!)]));
    } else {
      const ok = new Set(hit.map((c) => c.id));
      bad = pool.filter((c) => !ok.has(c.id));
      perCard = Object.fromEntries(pool.map((c) => [c.id, ok.has(c.id)]));
    }
    return { ...base, value: bad.length, noData, status: bad.length === 0 ? "ok" : bad.length <= 1 ? "near" : "fail", gap: bad.length,
      cards: bad.map((c) => c.id), perCard };
  } catch (e) {
    return errorResult(base, e);
  }
}

export interface EvaluateOptions {
  /** Scale counts at colour and archetype scope to cube.targetSize (default true when a target size is set). */
  scale?: boolean;
}

export function evaluate(config: Config, cubeIds: string[], cardsById: Record<string, Card>, opts: EvaluateOptions = {}): Report {
  const cards = cubeIds.map((id) => cardsById[id]).filter(Boolean);
  const target = config.cube?.targetSize || null;
  const factor = opts.scale !== false && target && cards.length ? target / cards.length : 1;
  const cubeRules = config.rules.filter((r) => r.scope.kind === "cube").map((r) => measureRule(r, cards, undefined, factor));
  const allColors = config.rules.filter((r) => r.scope.kind === "allColors");
  const allArchetypes = config.rules.filter((r) => r.scope.kind === "allArchetypes");
  const inherit = (res: Result, r: Rule): Result => ({ ...res, inherited: true, from: r.scope.kind as "allColors" });

  const colors: Report["colors"] = {};
  for (const col of config.colors) {
    const pool = colorPool(cards, col.code);
    const scopeColors = WUBRG.includes(col.code) ? col.code : "";
    const mechanics = (col.mechanics || []).map((m) => measureMechanic(m, pool, { scopeColors }, factor));
    const ctx: MatchContext = { scopeColors, member: memberOf(mechanics) };
    const own = config.rules.filter((r) => r.scope.kind === "color" && r.scope.color === col.code).map((r) => measureRule(r, pool, ctx, factor));
    const shared = WUBRG.includes(col.code) ? allColors.map((r) => inherit(measureRule(r, pool, ctx, factor), r)) : [];
    const rules = own.concat(shared);
    colors[col.code] = { cards: pool.map((c) => c.id), mechanics, rules, status: worst(mechanics.concat(rules)) };
  }

  const archetypes: Report["archetypes"] = {};
  for (const a of config.archetypes) {
    const pool = archetypePool(cards, a.colors);
    const mechanics = a.mechanics.map((m) => measureMechanic(m, pool, { scopeColors: a.colors }, factor));
    const memberIds = new Set(mechanics.flatMap((r) => r.cards));
    const ctx: MatchContext = { scopeColors: a.colors, member: memberOf(mechanics) };
    const own = config.rules.filter((r) => r.scope.kind === "archetype" && r.scope.id === a.id).map((r) => measureRule(r, pool, ctx, factor));
    const rules = own.concat(allArchetypes.map((r) => inherit(measureRule(r, pool, ctx, factor), r)));
    archetypes[a.id] = { cards: pool.map((c) => c.id), members: [...memberIds], membersScaled: Math.round(memberIds.size * factor),
      mechanics, rules, status: worst(mechanics.concat(rules)) };
  }

  const summary = (rs: Rule[], scopes: Record<string, ScopeReport>): SharedSummary[] => rs.map((r) => {
    const byScope = Object.fromEntries(Object.entries(scopes)
      .map(([k, v]) => [k, v.rules.find((x) => x.inherited && x.id === r.id)] as const)
      .filter((x): x is readonly [string, Result] => !!x[1]));
    const st = Object.values(byScope);
    const n = (s: Status) => st.filter((x) => x.status === s).length;
    const priority = r.priority || "primary";
    return { id: r.id, name: r.name, priority, measure: r.measure, constraint: r.constraint || null, byScope,
      counts: { ok: n("ok"), near: n("near"), fail: n("fail"), error: n("error") },
      status: worst(st)[priority === "secondary" ? "all" : "primary"] };
  });
  const named = Object.fromEntries(config.archetypes.filter((a) => a.name).map((a) => [a.id, archetypes[a.id]]));
  const five = Object.fromEntries(Object.entries(colors).filter(([k]) => WUBRG.includes(k)));
  const sharedColors = summary(allColors, five);
  const sharedArchetypes = summary(allArchetypes, named);
  return {
    size: cards.length, targetSize: target, factor,
    cube: { cards: cards.map((c) => c.id), rules: cubeRules, status: worst(cubeRules) },
    colors, archetypes,
    allColors: { rules: sharedColors, status: worst(sharedColors) },
    allArchetypes: { rules: sharedArchetypes, status: worst(sharedArchetypes) },
  };
}

export type { Mechanic };
