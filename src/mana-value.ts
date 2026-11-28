/**
 * Mana value as cubewarden counts it: Scryfall's, except that a twobrid pip ({2/W}…{2/G}, {2/C}) counts 1.5 and the
 * total is rounded down. Magmablood Archaic {2/R}{2/R}{2/R} is 4, not 6; Wildgrowth Archaic {2/G}{2/G} is 3.
 *
 * Every card gets its `mv` from here when it is built (Scryfall, CubeCobra) and again when prebuilt card data is
 * loaded (cards.json, the hosted set files), so the curve, the mv filter, avg(mv), sorting and the tables agree.
 * A card without twobrid pips keeps the value it has. One with them is valued from its front face's cost alone,
 * so applying it twice changes nothing (every twobrid card is a single-faced card).
 */
import type { Card } from "./model.ts";

const TWOBRID = /\{2\/[WUBRGC]\}/i;

/** Value of one mana symbol, without braces: {3} = 3, {X} = 0, {2/R} = 1.5, any other pip = 1. */
export function symbolValue(sym: string): number {
  const u = sym.toUpperCase();
  if (/^\d+$/.test(u)) return Number(u);
  if (u === "X" || u === "Y" || u === "Z") return 0;
  if (/^2\/[WUBRGC]$/.test(u)) return 1.5;
  return 1;
}

/** The card's mana value with twobrid pips at 1.5, rounded down; the card's own `mv` when it has none. */
export function manaValue(card: Pick<Card, "manaCost" | "mv">): number {
  const front = (card.manaCost || "").split(" // ")[0];
  if (!TWOBRID.test(front)) return card.mv;
  let v = 0;
  for (const [, sym] of front.matchAll(/\{([^}]+)\}/g)) v += symbolValue(sym);
  return Math.floor(v);
}

/** The card with `mv` from manaValue: the same object when nothing changes. */
export function withManaValue<T extends Card>(card: T): T {
  const mv = manaValue(card);
  return mv === card.mv ? card : { ...card, mv };
}
