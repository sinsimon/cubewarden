/**
 * The workspace: one cube project and the operations people and agents run on it. The CLI, the page's
 * window.cubewarden object and its WebMCP tools are thin doors onto these same functions.
 */
import type { Card, Config, Rule, Scope } from "./model.ts";
import { WUBRG } from "./colors.ts";
import { formatConstraint, inConstraint, type Status } from "./constraint.ts";
import { evaluate, scopeCards, type EvaluateOptions, type Report, type Result, type SharedSummary } from "./evaluate.ts";
import { changelist, diff, type Diff } from "./export.ts";
import { matches, metricOf, type MatchContext } from "./filter.ts";
import { parseFilter, parseRule, ruleToText } from "./syntax.ts";

export interface Project {
  version: 1;
  config: Config;
  /** The list as imported: changes are measured against it. */
  original: string[];
  current: string[];
  /** CubeCobra cube id, when the cube came from CubeCobra. */
  cubeId?: string | null;
}

export interface Finding {
  id: string;
  kind: "rule" | "mechanic";
  scope: string;
  name: string;
  priority: "primary" | "secondary";
  status: Status;
  value: number | null;
  target: string;
  rule: string;
  error?: string;
}

export interface CheckResult {
  ok: boolean;
  size: number;
  targetSize: number | null;
  /** Primary rules and mechanics that are not met (near, fail, error). */
  failing: Finding[];
  /** Secondary ones that are not met. */
  warnings: Finding[];
}

export interface CardSummary { id: string; name: string; colors: string; type: string; mv: number; wrAdj: number | null; set: string | null }

export interface Explanation extends Finding {
  description?: string;
  cards: (CardSummary & { value?: number | boolean | null })[];
  /** Shared rules: the result in each colour or archetype. */
  byScope?: { scope: string; value: number | null; status: Status }[];
}

export interface RuleLine { id: string; name: string; scope: string; priority: "primary" | "secondary"; text: string }
export interface RuleInput { id: string; name?: string; scope?: string; priority?: "primary" | "secondary"; text?: string; description?: string }
export interface Changes { add?: string[]; remove?: string[] }
export interface Delta {
  size: { before: number; after: number };
  changed: { id: string; scope: string; name: string; before: { value: number | null; status: Status }; after: { value: number | null; status: Status } }[];
}

const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colourless", L: "Lands" };
const NOT_MET: Status[] = ["near", "fail", "error"];

export function summarizeCard(c: Card): CardSummary {
  return { id: c.id, name: c.name, colors: c.colors, type: c.type, mv: c.mv, wrAdj: c.wrAdj ?? null, set: c.set };
}

/** "cube" | "color:W" | "archetype:wu" | "allColors" | "allArchetypes" ↔ Scope. */
export function scopeToText(s: Scope): string {
  if (s.kind === "color") return `color:${s.color}`;
  if (s.kind === "archetype") return `archetype:${s.id}`;
  return s.kind;
}

export function createWorkspace(project: Project, cardsById: Record<string, Card>, opts: EvaluateOptions = {}) {
  const listeners = new Set<(p: Project) => void>();
  const notify = () => listeners.forEach((f) => f(project));
  const byName = new Map(Object.values(cardsById).map((c) => [c.name.toLowerCase(), c]));

  const report = (ids = project.current): Report => evaluate(project.config, ids, cardsById, opts);

  function scopeLabel(s: Scope): string {
    if (s.kind === "cube") return "whole cube";
    if (s.kind === "allColors") return "each colour";
    if (s.kind === "allArchetypes") return "each archetype";
    if (s.kind === "color") return COLOR_NAME[s.color] || s.color;
    const a = project.config.archetypes.find((x) => x.id === s.id);
    return a?.name || a?.colors || s.id;
  }

  function parseScope(text: string): Scope {
    const t = text.trim();
    const [k, v] = t.split(":");
    const key = k.toLowerCase();
    if (key === "cube") return { kind: "cube" };
    if (key === "allcolors" || key === "allcolours") return { kind: "allColors" };
    if (key === "allarchetypes") return { kind: "allArchetypes" };
    if ((key === "color" || key === "colour") && v && "WUBRGCL".includes(v.toUpperCase()) && v.length === 1) return { kind: "color", color: v.toUpperCase() as "W" };
    if (key === "archetype" && v && project.config.archetypes.some((a) => a.id === v)) return { kind: "archetype", id: v };
    const archetypes = project.config.archetypes.map((a) => `archetype:${a.id}`).join(", ");
    throw new Error(`Unknown scope "${text}" (use cube, color:W…L, allColors, allArchetypes${archetypes ? ", " + archetypes : ""})`);
  }

  /** Every result in the report with its scope label, in a stable order. */
  function allResults(r: Report): { scope: string; res: Result; text: string; description?: string }[] {
    const out: { scope: string; res: Result; text: string; description?: string }[] = [];
    const ruleOf = new Map(project.config.rules.map((x) => [x.id, x]));
    const push = (scope: string, res: Result, text: string, description?: string) => out.push({ scope, res, text, description });
    for (const res of r.cube.rules) push("whole cube", res, ruleToText(ruleOf.get(res.id)!), ruleOf.get(res.id)?.description);
    for (const col of project.config.colors) {
      const cr = r.colors[col.code];
      if (!cr) continue;
      cr.mechanics.forEach((m, i) => push(COLOR_NAME[col.code], m, ruleToText(col.mechanics[i])));
      cr.rules.forEach((x) => push(COLOR_NAME[col.code], x, ruleToText(ruleOf.get(x.id)!), ruleOf.get(x.id)?.description));
    }
    for (const a of project.config.archetypes) {
      const ar = r.archetypes[a.id];
      if (!ar) continue;
      const label = a.name || a.colors;
      ar.mechanics.forEach((m, i) => push(label, m, ruleToText(a.mechanics[i])));
      ar.rules.forEach((x) => push(label, x, ruleToText(ruleOf.get(x.id)!), ruleOf.get(x.id)?.description));
    }
    return out;
  }

  const finding = (scope: string, res: Result, text: string): Finding => ({
    id: res.id, kind: res.kind, scope, name: res.name, priority: res.priority, status: res.status, value: res.value,
    target: res.measure.kind === "every" ? "0 cards breaking it" : formatConstraint(res.constraint, res.measure.kind === "avg" ? res.measure.metric : undefined),
    rule: text, ...(res.error ? { error: res.error } : {}),
  });

  function resolve(ref: string): Card {
    const c = cardsById[ref] ?? byName.get(ref.trim().toLowerCase());
    if (c) return c;
    const q = ref.trim().toLowerCase();
    const near = [...byName.keys()].filter((n) => n.includes(q) || closeEnough(n, q)).slice(0, 5).map((n) => byName.get(n)!.name);
    throw new Error(`No card named "${ref}"${near.length ? ` (did you mean ${near.map((n) => `"${n}"`).join(", ")}?)` : ""}`);
  }

  function nextList(ch: Changes): string[] {
    const cur = new Set(project.current);
    const add = (ch.add || []).map(resolve);
    const remove = (ch.remove || []).map(resolve);
    for (const c of add) if (cur.has(c.id)) throw new Error(`"${c.name}" is already in the cube`);
    for (const c of remove) if (!cur.has(c.id)) throw new Error(`"${c.name}" is not in the cube`);
    const out = project.current.filter((id) => !remove.some((c) => c.id === id));
    return out.concat(add.map((c) => c.id));
  }

  /** Cube-scope "every card" rules, as a card test: what the cube allows at all (sets, rarities, any metric). */
  function allowedByCube(priorities: ("primary" | "secondary")[] = ["primary"]) {
    const every = project.config.rules.filter((r) => r.scope.kind === "cube" && r.measure.kind === "every" && priorities.includes(r.priority || "primary"));
    return (c: Card) => every.every((r) => {
      const m = r.measure;
      if (m.kind !== "every") return true;
      if (!m.metric) return matches(c, r.filter);
      if (!matches(c, r.filter)) return true;
      const v = metricOf(c, m.metric);
      return v == null || inConstraint(v, r.constraint);
    });
  }

  const api = {
    get project() { return project; },
    cardsById,
    report: () => report(),

    check(): CheckResult {
      const r = report();
      const all = allResults(r).filter((x) => NOT_MET.includes(x.res.status));
      return {
        ok: !all.some((x) => x.res.priority !== "secondary"),
        size: r.size, targetSize: r.targetSize,
        failing: all.filter((x) => x.res.priority !== "secondary").map((x) => finding(x.scope, x.res, x.text)),
        warnings: all.filter((x) => x.res.priority === "secondary").map((x) => finding(x.scope, x.res, x.text)),
      };
    },

    explain(id: string): Explanation {
      const r = report();
      const shared = [...r.allColors.rules, ...r.allArchetypes.rules].find((x) => x.id === id);
      if (shared) return explainShared(shared);
      const hit = allResults(r).find((x) => x.res.id === id);
      if (!hit) {
        const ids = [...new Set(allResults(r).map((x) => x.res.id))];
        throw new Error(`Unknown rule "${id}". Known ids: ${ids.join(", ")}`);
      }
      return {
        ...finding(hit.scope, hit.res, hit.text), description: hit.description,
        cards: hit.res.cards.map((cid) => ({ ...summarizeCard(cardsById[cid]), value: hit.res.perCard[cid] })),
      };
    },

    search(filterText: string, o: { scope?: string; limit?: number; respectCubeRules?: boolean } = {}) {
      const filter = parseFilter(filterText);
      const inCube = new Set(project.current);
      let pool = Object.values(cardsById).filter((c) => !inCube.has(c.id));
      if (o.respectCubeRules !== false) pool = pool.filter(allowedByCube());
      let ctx: MatchContext | undefined;
      if (o.scope) {
        const s = o.scope.includes(":") ? parseScope(o.scope)
          : project.config.archetypes.some((a) => a.id === o.scope) ? parseScope("archetype:" + o.scope) : parseScope("color:" + o.scope);
        pool = scopeCards(s, pool, project.config);
        ctx = { scopeColors: s.kind === "archetype" ? project.config.archetypes.find((a) => a.id === s.id)!.colors : s.kind === "color" && WUBRG.includes(s.color) ? s.color : "" };
      }
      const hits = pool.filter((c) => matches(c, filter, ctx));
      hits.sort((a, b) => (b.wrAdj ?? -1) - (a.wrAdj ?? -1) || a.name.localeCompare(b.name));
      return { total: hits.length, cards: hits.slice(0, o.limit ?? 50).map(summarizeCard) };
    },

    tryChanges(ch: Changes): Delta {
      return delta(report(), report(nextList(ch)));
    },

    applyChanges(ch: Changes): Delta {
      const before = report();
      project.current = nextList(ch);
      notify();
      return delta(before, report());
    },

    changes(): Diff & { text: string } {
      const d = diff(project.original, project.current);
      return { ...d, text: changelist(d, cardsById) };
    },

    rules(): RuleLine[] {
      return project.config.rules.map((r) => ({ id: r.id, name: r.name, scope: scopeToText(r.scope), priority: r.priority || "primary", text: ruleToText(r) }));
    },

    setRule(input: RuleInput): RuleLine {
      const old = project.config.rules.find((r) => r.id === input.id);
      if (!old && (!input.scope || input.text == null)) throw new Error(`New rule "${input.id}" needs a scope and a text`);
      const body = input.text != null ? parseRule(input.text) : { measure: old!.measure, filter: old!.filter ?? null, constraint: old!.constraint ?? null };
      const rule: Rule = {
        id: input.id, name: input.name ?? old?.name ?? input.id,
        scope: input.scope ? parseScope(input.scope) : old!.scope,
        priority: input.priority ?? old?.priority ?? "primary",
        ...body,
        ...(input.description ?? old?.description ? { description: input.description ?? old?.description } : {}),
      };
      if (old) project.config.rules[project.config.rules.indexOf(old)] = rule;
      else project.config.rules.push(rule);
      notify();
      return api.rules().find((r) => r.id === rule.id)!;
    },

    removeRule(id: string) {
      const i = project.config.rules.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`Unknown rule "${id}"`);
      project.config.rules.splice(i, 1);
      notify();
    },

    onChange(f: (p: Project) => void) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };

  function explainShared(s: SharedSummary): Explanation {
    const rule = project.config.rules.find((x) => x.id === s.id)!;
    const scopes = Object.entries(s.byScope);
    const label = (k: string) => (rule.scope.kind === "allColors" ? COLOR_NAME[k] : project.config.archetypes.find((a) => a.id === k)?.name || k);
    return {
      id: s.id, kind: "rule", scope: scopeLabel(rule.scope), name: s.name, priority: s.priority, status: s.status, value: null,
      target: formatConstraint(s.constraint, s.measure.kind === "avg" ? s.measure.metric : undefined), rule: ruleToText(rule), description: rule.description,
      cards: [], byScope: scopes.map(([k, v]) => ({ scope: label(k), value: v.value, status: v.status })),
    };
  }

  function delta(a: Report, b: Report): Delta {
    const before = new Map(allResults(a).map((x) => [x.scope + "|" + x.res.id, x]));
    const changed: Delta["changed"] = [];
    for (const x of allResults(b)) {
      const y = before.get(x.scope + "|" + x.res.id);
      if (!y || (y.res.value === x.res.value && y.res.status === x.res.status)) continue;
      changed.push({ id: x.res.id, scope: x.scope, name: x.res.name, before: { value: y.res.value, status: y.res.status }, after: { value: x.res.value, status: x.res.status } });
    }
    return { size: { before: a.size, after: b.size }, changed };
  }

  return api;
}

export type Workspace = ReturnType<typeof createWorkspace>;

/** Edit distance ≤ 2, for "did you mean". */
function closeEnough(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}
