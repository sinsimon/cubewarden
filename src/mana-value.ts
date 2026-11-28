/**
 * Mana value as cubewarden counts it: Scryfall's, except that a twobrid pip ({2/W}…{2/G}, {2/C}) counts 1.5 and the
 * total is rounded down. Magmablood Archaic {2/R}{2/R}{2/R} is 4, not 6; Wildgrowth Archaic {2/G}{2/G} is 3.
 *
 * Every card gets its `mv` from here when it is built (Scryfall, CubeCobra) and again when prebuilt card data is
 * loaded (cards.json, the hosted set files), so the curve, the mv filter, avg(mv), sorting and the tables agree.
 * A card without twobrid pips keeps the value it has. One with them is valued from its front face's cost alone,
 * so applying it twice changes nothing (every twobrid card is a single-faced card).
 *
 * The cube can also say what an {X} in a mana cost is worth (config.cube.xValue, "X counts as", default 0 = the
 * official rule). That value belongs to the cube, not to the card data: applyXValue writes it into the cards' `mv`
 * in place (like the chosen printings, see printing.ts) wherever a cube is evaluated, searched or shown, and setting
 * it back to 0 restores the values the data had.
 */
import type { Card, Config } from "./model.ts";

const TWOBRID = /\{2\/[WUBRGC]\}/i;

/** Value of one mana symbol, without braces: {3} = 3, {X} = x (0 by default), {2/R} = 1.5, any other pip = 1. */
export function symbolValue(sym: string, x = 0): number {
  const u = sym.toUpperCase();
  if (/^\d+$/.test(u)) return Number(u);
  if (u === "X") return x;
  if (u === "Y" || u === "Z") return 0;
  if (/^2\/[WUBRGC]$/.test(u)) return 1.5;
  return 1;
}

/** How many {X} a cost has. */
export function xCount(cost: string): number {
  return (cost.match(/\{X\}/gi) || []).length;
}

/**
 * The card's mana value with twobrid pips at 1.5 and each {X} of its front face at xValue, rounded down once; the
 * card's own `mv` when neither applies. A card with one face is valued from its cost. One with more faces (a split
 * card's mv adds both halves) keeps its own `mv` plus xValue per {X} of the front face.
 */
export function manaValue(card: Pick<Card, "manaCost" | "mv">, xValue = 0): number {
  const faces = (card.manaCost || "").split(" // ");
  const front = faces[0];
  const xs = xValue ? xCount(front) : 0;
  if (!TWOBRID.test(front) && !xs) return card.mv;
  if (faces.length > 1) return Math.floor(card.mv + xs * xValue);
  let v = 0;
  for (const [, sym] of front.matchAll(/\{([^}]+)\}/g)) v += symbolValue(sym, xValue);
  return Math.floor(v);
}

/** The card with `mv` from manaValue: the same object when nothing changes. */
export function withManaValue<T extends Card>(card: T): T {
  const mv = manaValue(card);
  return mv === card.mv ? card : { ...card, mv };
}

/** The cube's "X counts as" value: a whole number from 0; 0 when the config has none (projects made before it). */
export function configXValue(config: Pick<Config, "cube"> | null | undefined): number {
  const n = config?.cube?.xValue;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : 0;
}

/** The X value last written into a card by applyXValue (0 for a card it never changed). */
const APPLIED = new WeakMap<object, number>();
/** The mv a card with an {X} had before any X value was written into it, by id and cost (copies share it). */
const BASE = new Map<string, number>();

export function appliedXValue(card: object): number {
  return APPLIED.get(card) ?? 0;
}

/**
 * Writes the cube's X value into the `mv` of the cards (in place) that have an {X} on their front face. Running it
 * again with the same value changes nothing; with 0 it restores each card's mv from before.
 */
export function applyXValue(cards: Record<string, Card> | Iterable<Card>, xValue: number): void {
  const list = Symbol.iterator in cards ? cards as Iterable<Card> : Object.values(cards);
  for (const c of list) {
    if (!c || appliedXValue(c) === xValue) continue;
    if (!xCount((c.manaCost || "").split(" // ")[0])) { APPLIED.set(c, xValue); continue; }
    const key = c.id + "|" + c.manaCost;
    // The first time a card with this id and cost is seen its mv is the data's. A copy made after a value was
    // written (a reference cube reusing our cards) carries the written mv, so the one recorded first is used.
    if (!BASE.has(key)) BASE.set(key, c.mv);
    c.mv = manaValue({ manaCost: c.manaCost, mv: BASE.get(key)! }, xValue);
    APPLIED.set(c, xValue);
  }
}
