/**
 * Browser entry, bundled to web/dist/cubewarden.js. It exposes:
 *   window.CubeEngine  the engine under the names the page uses;
 *   window.cubewardenAttach(state, cardsById, hooks)  the page calls it once its state is ready: it creates
 *     window.cubewarden (the workspace API for agents driving the browser) and registers the same operations
 *     as WebMCP tools when the browser supports WebMCP.
 */
import type { Card, Config, Filter, Scope } from "./model.ts";
import { aboutMarkdown, REPO_URL } from "./about.ts";
import { colorSet } from "./colors.ts";
import { bucketLabel, formatConstraint, gap, inConstraint, statusOf } from "./constraint.ts";
import { cubeCobraListUrl, decodeRules, encodeRules, fetchCubeCobra, readCubeCobra } from "./cubecobra.ts";
import { describeFilter } from "./describe.ts";
import { archetypePool, evaluate, evaluateMaybeboard, scopeCards } from "./evaluate.ts";
import { changelist, diff, exportCsv, mechanicTags } from "./export.ts";
import { FIELD, FIELDS, METRICS, pct } from "./fields.ts";
import { FilterError, isCreature, isLand, matches, metricOf, validateFilter, type MatchContext } from "./filter.ts";
import { toScryfall } from "./scryfall.ts";
import { slug } from "./slug.ts";
import { spellCosts } from "./spell-costs.ts";
import { SOURCES } from "./sources.ts";
import { linkedRule, linkedRules, mechanicOfRule, mechanicTarget, removeMechanic, saveMechanic } from "./mechanic-target.ts";
import { referenceCounts, type ReferenceState } from "./references.ts";
import { filterToText, parseFilter, parseRule, ruleToText } from "./syntax.ts";
import { SYNTAX_HELP } from "./syntax-help.ts";
import { chordBadgeT, enemyLabel } from "./star.ts";
import { createWorkspace, cubeAllows, sortCards, type Project, type SearchSource, type SortKey } from "./workspace.ts";
import { loadHosted, resolveNames } from "./hosted.ts";

interface PageData { builtAt: string; cards: Card[]; cube: { name: string; source?: string; original: string[]; current: string[] }; seed: Config; sources?: Record<string, string> }
type Win = typeof globalThis & { CUBE_DATA?: PageData; CubeEngine?: unknown; cubewarden?: unknown; cubewardenAttach?: unknown };
const W = globalThis as Win;

/** Cards outside the cube matching a filter in a scope's colours. Options: ctx, respectCubeRules, sort, and
 *  within: look only at these cards (the maybeboard). */
function candidates(filter: Filter, scope: Scope | null, config: Config, cardsById: Record<string, Card>, cubeIds: string[],
  opts: { ctx?: MatchContext; respectCubeRules?: boolean; sort?: SortKey | ((c: Card) => number | null | undefined); within?: string[] } = {}) {
  const inCube = new Set(cubeIds);
  let pool = (opts.within ? [...new Set(opts.within)].map((id) => cardsById[id]).filter(Boolean) : Object.values(cardsById)).filter((c) => !inCube.has(c.id));
  if (opts.respectCubeRules) pool = pool.filter(cubeAllows(config));
  if (scope && scope.kind !== "cube") pool = scopeCards(scope, pool, config);
  const out: Card[] = [];
  for (const c of pool) {
    try { if (matches(c, filter, opts.ctx)) out.push(c); } catch (e) { return { error: (e as Error).message, cards: [] as Card[] }; }
  }
  return { cards: sortCards(out, opts.sort ?? "cubes") };
}

/** The cube's "every card" rules (primary, whole cube): what "Only cards your cube rules allow" applies. */
function cubeGateRules(config: Config) {
  return config.rules.filter((r) => r.scope.kind === "cube" && r.measure.kind === "every" && (r.priority || "primary") === "primary");
}

async function referenceCube(id: string, known: Record<string, Card>) {
  const cube = await fetchCubeCobra(id, known);
  return { id, name: cube.name, ids: cube.mainboard, cardsById: cube.cards };
}

function storage(key: string) {
  return {
    load() { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } },
    save(v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
  };
}

/** Page bootstrap: card data from window.CUBE_DATA, the user's work from localStorage (or the data's own cube). */
function boot(storageKey: string) {
  const D = W.CUBE_DATA;
  if (!D) throw new Error("No card data: data.js did not load. Run `cubewarden serve` in your project folder.");
  D.sources = { ...SOURCES, ...(D.sources || {}) };
  const cardsById = Object.fromEntries(D.cards.map((c) => [c.id, c]));
  const store = storage(storageKey);
  const saved = store.load();
  const state = saved && saved.version === 1 ? saved
    : { version: 1, config: structuredClone(D.seed), original: D.cube.original.slice(), current: D.cube.current.slice() };
  return { data: D, cardsById, state, store, save: () => store.save(state), reset: () => { store.clear(); location.reload(); } };
}

W.CubeEngine = {
  FIELDS, FIELD, METRICS, FilterError, pct, slug, isLand, isCreature, metricOf, colorSet,
  matches, validateFilter, describeFilter, inConstraint, gap, formatConstraint, bucketLabel, statusOf,
  scopeCards, archetypePool, evaluate, evaluateMaybeboard, candidates, cubeGateRules, sortCards,
  diff, exportChangelist: changelist, exportCsv, storage, boot,
  encodeConfig: encodeRules, decodeConfig: decodeRules, readCubeCobra, referenceCube, mechanicTags, cubeCobraListUrl,
  parseFilterText: parseFilter, filterToText, parseRuleText: parseRule, ruleToText, toScryfall, aboutMarkdown,
  REPO_URL, SYNTAX_HELP, SOURCES, resolveNames, spellCosts,
  linkedRule, linkedRules, mechanicOfRule, mechanicTarget, saveMechanic, removeMechanic, referenceCounts,
  chordBadgeT, enemyLabel,
};

/** Hosted page: assemble the card data before the page's own scripts run. */
(W as Win & { cubewardenHosted?: unknown }).cubewardenHosted = { load: loadHosted };

interface Hooks {
  /** Scale counts like the page does (the "scaled / actual" toggle). */
  scale: () => boolean;
  /** Called before an agent changes the project, with a short label: the page records an undo step and returns
   *  a function that drops it again if the change fails. */
  before?: (label: string) => (() => void) | void;
  /** Called after an agent changed the project: save, recompute, redraw. */
  changed: () => void;
  /** The project's reference cubes as the page has loaded them: search() results then carry refs. */
  refs?: () => ReferenceState[];
}

/** Creates window.cubewarden on the page's live state and registers WebMCP tools. */
W.cubewardenAttach = (state: Project, cardsById: Record<string, Card>, hooks: Hooks) => {
  const opts = { get scale() { return hooks.scale(); } };
  const ws = createWorkspace(state, cardsById, opts);
  ws.onChange(() => hooks.changed());
  const api = {
    ...pick(ws, hooks.before ?? (() => {}), hooks.refs),
    syntax: () => SYNTAX_HELP,
    help: () => AGENT_HELP,
  };
  W.cubewarden = api;
  registerWebMcp(api);
  console.info("cubewarden: agents can use window.cubewarden (try cubewarden.help()). " + REPO_URL);
  return api;
};

const names = (ch: { add?: string[]; remove?: string[] }) =>
  [ch.add?.length ? "add " + ch.add.join(", ") : "", ch.remove?.length ? "remove " + ch.remove.join(", ") : ""].filter(Boolean).join("; ");

function pick(ws: ReturnType<typeof createWorkspace>, before: (label: string) => (() => void) | void, refs?: () => ReferenceState[]) {
  /** Records an undo step, runs the change, and drops the step if the change throws. */
  const undoable = <T>(label: string, f: () => T): T => {
    const drop = before(label);
    try { return f(); } catch (e) { if (drop) drop(); throw e; }
  };
  return {
    check: () => ws.check(),
    explain: (id: string) => ws.explain(id),
    search: (filter: string, o?: Parameters<typeof ws.search>[1]) => {
      const res = ws.search(filter, { respectCubeRules: true, ...o });
      // refs: how many reference cubes play the card; left out while they load or when there are none.
      const rc = refs ? referenceCounts(refs()) : null;
      return rc ? { ...res, refsOf: rc.of, cards: res.cards.map((c) => ({ ...c, refs: rc.count(c) })) } : res;
    },
    tryChanges: (ch: Parameters<typeof ws.tryChanges>[0]) => ws.tryChanges(ch),
    applyChanges: (ch: Parameters<typeof ws.applyChanges>[0]) => undoable(names(ch), () => ws.applyChanges(ch)),
    changes: () => ws.changes(),
    maybeboard: (ch?: Parameters<typeof ws.maybeboard>[0]) => (ch && (ch.add?.length || ch.remove?.length) ? undoable("maybeboard", () => ws.maybeboard(ch)) : ws.maybeboard()),
    rules: () => ws.rules(),
    setRule: (r: Parameters<typeof ws.setRule>[0]) => undoable(`rule ${r.id}`, () => ws.setRule(r)),
    removeRule: (id: string) => undoable(`remove rule ${id}`, () => ws.removeRule(id)),
    mechanics: () => ws.mechanics(),
    setMechanic: (m: Parameters<typeof ws.setMechanic>[0]) => undoable(`mechanic ${m.id}`, () => ws.setMechanic(m)),
    removeMechanic: (id: string) => undoable(`remove mechanic ${id}`, () => ws.removeMechanic(id)),
    project: () => structuredClone(ws.project),
  };
}

const AGENT_HELP = `window.cubewarden: the cube on this page, for agents. Same operations as the cubewarden CLI.
  check()                         rules and mechanics not met (primary = failing, secondary = warnings)
  explain(id)                     a rule's value, target and cards
  search(filter, {scope, sort, limit, source})   cards outside the cube; sort: cubes (default), elo, picks, wr, wrraw, mv, name;
                                  source: "maybeboard" looks only at the cards kept aside (all of them, whatever the
                                  "every card" rules say); member: needs a scope (a colour like "W" or an archetype id);
                                  with reference cubes loaded, each card has refs (how many of them play it, out of refsOf)
  wr = WR Δ: 17Lands adjusted WR in points above (+) or below (−) the average common/uncommon of the card's set
       (wr>=1.5, avg(wr, member:any) in 1..3.5); wrraw = raw GIH WR in percent (wrraw>=55%)
  tryChanges({add:[names], remove:[names]})   effect of a swap, nothing saved
  applyChanges({add, remove, toMaybeboard})   make the swap (the page saves and redraws); toMaybeboard keeps the removed cards aside
  maybeboard({add, remove})       candidates kept aside (CubeCobra's maybeboard)
  changes()                       adds/removes against the imported list, with a changelist
  rules() / setRule({id, name, scope, text, priority}) / removeRule(id)
  mechanics() / setMechanic({id, name, scope: "color:W" | "archetype:<id>", text, priority}) / removeMechanic(id)
  syntax()                        the filter and rule syntax
The page keeps its work in this browser (localStorage). To work from a terminal instead, use the CLI: ${REPO_URL}`;

/** WebMCP (W3C draft): document.modelContext.registerTool, or navigator.modelContext in older Chrome builds. */
function registerWebMcp(api: ReturnType<typeof pick> & { syntax: () => string }) {
  let mc: { registerTool?: (t: unknown) => unknown } | undefined;
  try {
    const d = (globalThis as { document?: { modelContext?: typeof mc } }).document;
    const n = (globalThis as { navigator?: { modelContext?: typeof mc } }).navigator;
    mc = d?.modelContext ?? n?.modelContext;
  } catch { mc = undefined; }
  if (!mc?.registerTool) return;
  const text = (v: unknown) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
  const str = { type: "string" };
  const names = { type: "array", items: str };
  const tools = [
    { name: "cubewarden_check", description: "Rules and mechanics of the cube that are not met", inputSchema: { type: "object", properties: {} }, run: () => api.check() },
    { name: "cubewarden_explain", description: "A rule's value, target and the cards behind it", inputSchema: { type: "object", properties: { id: str }, required: ["id"] }, run: (a: { id: string }) => api.explain(a.id) },
    { name: "cubewarden_search", description: "Cards outside the cube matching a filter (see cubewarden_syntax). sort: cubes (default), elo, picks, wr (WR Δ in points), wrraw, mv, name. member:<mechanic>|any|primary|secondary needs a scope: a colour (W) or an archetype id. source: \"maybeboard\" searches only the cards kept aside", inputSchema: { type: "object", properties: { filter: str, scope: str, sort: str, limit: { type: "number" }, source: { type: "string", enum: ["all", "maybeboard"] } }, required: ["filter"] },
      run: (a: { filter: string; scope?: string; sort?: SortKey; limit?: number; source?: SearchSource }) => api.search(a.filter, a) },
    { name: "cubewarden_try_changes", description: "Effect of adding/removing cards on every rule, without saving", inputSchema: { type: "object", properties: { add: names, remove: names } }, run: (a: { add?: string[]; remove?: string[] }) => api.tryChanges(a) },
    { name: "cubewarden_apply_changes", description: "Add/remove cards in the cube shown on this page; toMaybeboard keeps the removed cards in the maybeboard", inputSchema: { type: "object", properties: { add: names, remove: names, toMaybeboard: { type: "boolean" } } }, run: (a: { add?: string[]; remove?: string[]; toMaybeboard?: boolean }) => api.applyChanges(a) },
    { name: "cubewarden_maybeboard", description: "Cards kept aside (CubeCobra's maybeboard): add or remove candidates, or list them with no arguments", inputSchema: { type: "object", properties: { add: names, remove: names } }, run: (a: { add?: string[]; remove?: string[] }) => api.maybeboard(a) },
    { name: "cubewarden_rules", description: "Every rule as text", inputSchema: { type: "object", properties: {} }, run: () => api.rules() },
    { name: "cubewarden_set_rule", description: "Add or change a rule written as text (see cubewarden_syntax; wr is the WR Δ in points, e.g. avg(wr, member:any) in 1..3.5; wrraw is the raw GIH WR in percent)", inputSchema: { type: "object", properties: { id: str, name: str, scope: str, text: str, priority: str }, required: ["id"] },
      run: (a: Parameters<typeof api.setRule>[0]) => api.setRule(a) },
    { name: "cubewarden_mechanics", description: "Every mechanic of the colours and archetypes as text", inputSchema: { type: "object", properties: {} }, run: () => api.mechanics() },
    { name: "cubewarden_set_mechanic", description: "Add or change a colour or archetype mechanic written as text", inputSchema: { type: "object", properties: { id: str, name: str, scope: str, text: str, priority: str }, required: ["id"] },
      run: (a: Parameters<typeof api.setMechanic>[0]) => api.setMechanic(a) },
    { name: "cubewarden_changes", description: "Cards added and removed against the imported list", inputSchema: { type: "object", properties: {} }, run: () => api.changes() },
    { name: "cubewarden_syntax", description: "Filter and rule syntax", inputSchema: { type: "object", properties: {} }, run: () => api.syntax() },
  ];
  for (const t of tools) {
    try {
      mc.registerTool({ name: t.name, description: t.description, inputSchema: t.inputSchema,
        execute: async (input: never) => { try { return text(t.run(input ?? ({} as never))); } catch (e) { return { ...text((e as Error).message), isError: true }; } } });
    } catch (e) { console.warn("cubewarden: WebMCP tool not registered", t.name, e); }
  }
}

export { readCubeCobra };
