/**
 * Printings: a cube entry is a card (oracle id) shown and exported in one printing (set, collector number, image,
 * Scryfall id). The printing comes from the project's choice (project.printings), else from the card data (the
 * CubeCobra list's printing, else the data's own). Rules, filters and win rates never look at it.
 *
 * The shown printing is written on the card objects of a cardsById map (set, number, image, scryfallId), so every
 * view and export of that map reads it; the data's own printing is remembered to go back to it.
 */
import type { Card, Config, Filter, Printing } from "./model.ts";

/** The part of a project printings depend on (a workspace Project, or the page's state). */
export interface PrintingProject {
  config: Config;
  current: string[];
  maybeboard?: string[];
  printings?: Record<string, Printing>;
}

export interface PrintingIssue { id: string; name: string; board: "cube" | "maybeboard"; printing: Printing; fix: Printing | null }
export interface PrintingChange { id: string; name: string; from: string; to: string }

/** "MSC 137". */
export const printingLabel = (p: Printing) => `${p.set.toUpperCase()}${p.number ? " " + p.number : ""}`;
const sameSet = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const samePrinting = (a: Printing, b: Printing) => sameSet(a.set, b.set) && String(a.number ?? "") === String(b.number ?? "");
const own = (c: Card): Printing => ({ set: c.set ?? "", number: c.number ?? null, scryfallId: c.scryfallId ?? null, image: c.image ?? null });

/** Set codes of a filter that are an allow-list: a non-negated set condition at the top level of an "and" (or of a one-item filter). */
function allowListOf(filter: Filter | null | undefined): string[] | null {
  if (!filter || filter.not || (filter.op !== "and" && filter.items.length !== 1)) return null;
  for (const item of filter.items) {
    if ("field" in item && item.field === "set" && !item.not && (item.op === "in" || item.op === "is")) {
      return ([] as unknown[]).concat(item.value).map((s) => String(s).toLowerCase());
    }
  }
  return null;
}

/** The sets every card of the cube must come from, from the cube's "every card" rules, or null when no rule limits them. */
export function allowedSets(config: Config | null | undefined): string[] | null {
  let out: string[] | null = null;
  for (const r of config?.rules || []) {
    if (r.scope.kind !== "cube" || r.measure.kind !== "every") continue;
    const sets = allowListOf(r.filter);
    if (sets) out = out ? out.filter((s) => sets.includes(s)) : sets;
  }
  return out;
}

/** The data's own printing of each card object, before any choice was shown on it. */
const BASE = new WeakMap<Card, Printing>();
/** Per cardsById map: the cards showing a chosen printing, to put back when the choice goes. */
const SHOWING = new WeakMap<object, Set<string>>();

/** The printing the card data gives a card (the CubeCobra list's, else the data's own). */
export function basePrinting(c: Card): Printing {
  return BASE.get(c) ?? own(c);
}

/** Every printing the data has for a card, newest set first; the data's own printing is always one of them. */
export function printingsOf(c: Card): Printing[] {
  const out: Printing[] = [];
  for (const p of [...(c.printings || []), basePrinting(c)]) if (p.set && !out.some((x) => samePrinting(x, p))) out.push(p);
  return out;
}

/** The printing to use in the allowed sets: the set the card's win rate comes from, else the newest allowed set. */
export function allowedPrinting(c: Card, sets: string[]): Printing | null {
  const ok = printingsOf(c).filter((p) => sets.some((s) => sameSet(s, p.set)));
  return (c.wrSet && ok.find((p) => sameSet(p.set, c.wrSet!))) || ok[0] || null;
}

/** A printing of the card: by set, and by collector number when given. Throws naming the printings the data has. */
export function findPrinting(c: Card, set: string, number?: string | null): Printing {
  const all = printingsOf(c);
  const hit = all.find((p) => sameSet(p.set, set) && (number == null || number === "" || String(p.number) === String(number)));
  if (hit) return hit;
  const what = number ? `${set.toUpperCase()} ${number}` : set.toUpperCase();
  throw new Error(`No ${what} printing of "${c.name}" in the card data (it has ${all.map(printingLabel).join(", ")})`);
}

/**
 * Shows each entry's chosen printing on its card object, and the data's printing on the others. A choice belongs to
 * an entry: it is dropped when the card is in neither the cube nor the maybeboard.
 */
export function showPrintings(cardsById: Record<string, Card>, project: PrintingProject): void {
  const chosen = project.printings;
  const entries = new Set([...(project.current || []), ...(project.maybeboard || [])]);
  if (chosen) {
    for (const id of Object.keys(chosen)) if (!entries.has(id)) delete chosen[id];
    if (!Object.keys(chosen).length) delete project.printings;
  }
  let showing = SHOWING.get(cardsById);
  if (!showing) SHOWING.set(cardsById, (showing = new Set()));
  for (const id of new Set([...showing, ...Object.keys(project.printings || {})])) {
    const c = cardsById[id];
    if (!c) continue;
    if (!BASE.has(c)) BASE.set(c, own(c));
    const want = project.printings?.[id];
    // A known printing brings its own image and Scryfall id; an unknown one (a hand-edited file) is shown as written.
    const p = want ? printingsOf(c).find((x) => samePrinting(x, want)) ?? want : BASE.get(c)!;
    Object.assign(c, { set: p.set, number: p.number ?? null, scryfallId: p.scryfallId ?? null, image: p.image ?? null });
    if (want) showing.add(id); else showing.delete(id);
  }
}

/**
 * Chooses the printing of a cube or maybeboard entry (one the card data has) and shows it. Choosing the data's own
 * printing clears the choice. Returns the printing now shown.
 */
export function choosePrinting(project: PrintingProject, cardsById: Record<string, Card>, id: string, set: string, number?: string | null): Printing {
  const c = cardsById[id];
  if (!c) throw new Error(`Unknown card ${id}`);
  if (!project.current.includes(id) && !(project.maybeboard || []).includes(id)) throw new Error(`"${c.name}" is neither in the cube nor in the maybeboard`);
  const p = findPrinting(c, set, number);
  const chosen = { ...(project.printings || {}) };
  if (samePrinting(p, basePrinting(c))) delete chosen[id];
  else chosen[id] = { set: p.set, number: p.number ?? null, scryfallId: p.scryfallId ?? null, image: p.image ?? null };
  project.printings = chosen;
  showPrintings(cardsById, project);
  return p;
}

/** Cube and maybeboard entries shown outside the sets the cube's "every card" rules allow, with the printing to use. */
export function printingIssues(project: PrintingProject, cardsById: Record<string, Card>): PrintingIssue[] {
  const sets = allowedSets(project.config);
  if (!sets) return [];
  showPrintings(cardsById, project);
  const cube = new Set(project.current);
  const rows = [...project.current.map((id) => [id, "cube"] as const),
    ...(project.maybeboard || []).filter((id) => !cube.has(id)).map((id) => [id, "maybeboard"] as const)];
  const out: PrintingIssue[] = [];
  for (const [id, board] of rows) {
    const c = cardsById[id];
    if (!c || !c.set || sets.some((s) => sameSet(s, c.set!))) continue;
    out.push({ id, name: c.name, board, printing: own(c), fix: allowedPrinting(c, sets) });
  }
  return out;
}

/** Entries shown in a printing other than the card data's (the imported list's): "MSC 137 → FDN 143". */
export function printingChanges(project: PrintingProject, cardsById: Record<string, Card>): PrintingChange[] {
  showPrintings(cardsById, project);
  return Object.keys(project.printings || {}).filter((id) => cardsById[id])
    .map((id) => ({ id, name: cardsById[id].name, from: printingLabel(basePrinting(cardsById[id])), to: printingLabel(own(cardsById[id])) }))
    .filter((x) => x.from !== x.to)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** "Make Your Move (FDN)" or "Make Your Move (FDN) 143" → name, set and number; null for a plain name. */
export function parsePrintingRef(ref: string): { name: string; set: string; number: string | null } | null {
  const m = ref.trim().match(/^(.+?)\s*\(([A-Za-z0-9]{2,6})\)(?:\s+(\S+))?$/);
  return m ? { name: m[1], set: m[2].toLowerCase(), number: m[3] ?? null } : null;
}
