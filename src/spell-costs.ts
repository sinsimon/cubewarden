/**
 * Spell costs: every mana value a card can be cast for as a noncreature spell (the `spellmv` filter).
 *
 *   - each noncreature, nonland face with a mana cost: that face's mana value (a plain instant, the adventure or omen
 *     of a creature, each half of a split card);
 *   - recast and alternative costs printed on that face: flashback, harmonize, beam me up, escape, mayhem, overload,
 *     foretell (the foretold cost), cleave, madness, miracle, surge, sneak, web-slinging, warp; retrace and
 *     jump-start cost the face's own. Plot is not one: its cost exiles the card, which is later cast for free;
 *   - optional additional costs added to the face's cost: each kicker (and both of an "and/or" pair), one multikick,
 *     each tier, entwine, every spree mode together.
 * A cost with X (`x` = how many X it has) can be cast for its X=0 value or more, in steps of `x`. Costs that are not
 * mana (a kicker that sacrifices, a flashback that taps creatures) add nothing. Creature faces and lands have none.
 */
import type { Card } from "./model.ts";
import { cmp } from "./scryfall-subset.ts";

export interface SpellCost {
  /** Mana value paid, with X = 0. */
  mv: number;
  /** Number of X in the cost: the spell can also be cast for mv + x, mv + 2x… Absent when the cost has no X. */
  x?: number;
  /** How it is cast: "cast", the name of a card's other face, or the keyword of the cost (kicker, flashback…). */
  via: string;
}

interface Cost { mv: number; x: number }

const COST = String.raw`((?:\{[^}]+\})+)`;
/** Keywords that cast the spell for the cost written after them ("Flashback {4}{R}", "Escape—{3}{B}, Exile…"). */
const ALTERNATIVE = ["flashback", "harmonize", "beam me up", "escape", "mayhem", "overload", "foretell", "cleave", "madness", "miracle", "surge",
  "sneak", "web-slinging", "warp"];
/** Keywords that recast the spell for its own cost. */
const SAME_COST = ["retrace", "jump-start"];

function costOf(s: string): Cost {
  let mv = 0, x = 0;
  for (const [, sym] of s.matchAll(/\{([^}]+)\}/g)) {
    const u = sym.toUpperCase();
    if (/^\d+$/.test(u)) mv += Number(u);
    else if (u === "X" || u === "Y" || u === "Z") x++;
    else if (/^\d+\//.test(u)) mv += Number(u.split("/")[0]);
    else mv += 1;
  }
  return { mv, x };
}
const plus = (...cs: Cost[]): Cost => ({ mv: cs.reduce((a, c) => a + c.mv, 0), x: cs.reduce((a, c) => a + c.x, 0) });
const allMatches = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m[1]);

/** The faces of a card: type, mana cost (empty = cannot be cast) and rules text. */
function faces(card: Pick<Card, "type" | "manaCost" | "text">) {
  const types = (card.type || "").split(" // ");
  const texts = (card.text || "").split("\n//\n");
  const costs = (card.manaCost || "").split(" // ").filter(Boolean);
  // A card's data lists only the faces that have a cost. Fewer costs than faces: they belong to the faces in order,
  // lands left out (a Town's adventure, a transforming creature's front, a battle's front).
  const cost: string[] = types.map(() => "");
  if (costs.length === types.length) costs.forEach((c, i) => (cost[i] = c));
  else {
    let k = 0;
    types.forEach((t, i) => { if (k < costs.length && !/\bLand\b/.test(t)) cost[i] = costs[k++]; });
  }
  return types.map((type, i) => ({
    type, cost: cost[i],
    text: texts.length === types.length ? texts[i] : i === 0 ? card.text || "" : "",
  }));
}

function costsOf(card: Pick<Card, "name" | "type" | "manaCost" | "text">): SpellCost[] {
  const names = (card.name || "").split(" // ");
  const out: SpellCost[] = [];
  const add = (c: Cost, via: string) => {
    if (!out.some((o) => o.mv === c.mv && (o.x ?? 0) === c.x)) out.push({ mv: c.mv, ...(c.x ? { x: c.x } : {}), via });
  };
  faces(card).forEach((f, i) => {
    if (!f.cost || /\b(Creature|Land)\b/.test(f.type)) return;
    const base = costOf(f.cost);
    add(base, i === 0 ? "cast" : names[i] || "cast");
    // Reminder text repeats costs ("pay an additional {4}"), so it is left out; keywords only count at a line start.
    const text = f.text.replace(/\([^()]*\)/g, "");
    for (const kw of ALTERNATIVE) {
      for (const c of allMatches(text, new RegExp(`^${kw}(?: |—)${COST}`, "gim"))) add(costOf(c), kw);
    }
    for (const kw of SAME_COST) if (new RegExp(`^${kw}\\b`, "im").test(text)) add(base, kw);
    for (const m of text.matchAll(new RegExp(`^Kicker(?: |—)${COST}(?: and/or ${COST})?`, "gim"))) {
      const a = costOf(m[1]);
      add(plus(base, a), "kicker");
      if (m[2]) {
        const b = costOf(m[2]);
        add(plus(base, b), "kicker");
        add(plus(base, a, b), "kicker");
      }
    }
    for (const c of allMatches(text, new RegExp(`^Multikicker(?: |—)${COST}`, "gim"))) add(plus(base, costOf(c)), "multikicker");
    for (const c of allMatches(text, new RegExp(`^Entwine(?: |—)${COST}`, "gim"))) add(plus(base, costOf(c)), "entwine");
    if (/^Tiered\b/im.test(text)) {
      for (const c of allMatches(text, new RegExp(`^•[^—\\n]*—\\s*${COST}\\s*—`, "gm"))) add(plus(base, costOf(c)), "tiered");
    }
    if (/^Spree\b/im.test(text)) {
      const modes = allMatches(text, new RegExp(`^\\+\\s*${COST}\\s*—`, "gm")).map(costOf);
      if (modes.length) add(plus(base, ...modes), "spree");
    }
  });
  return out;
}

const memo = new WeakMap<object, SpellCost[]>();

/** Every mana value the card can be cast for as a noncreature spell, without repeats (see the top of this file). */
export function spellCosts(card: Pick<Card, "name" | "type" | "manaCost" | "text">): SpellCost[] {
  let r = memo.get(card);
  if (!r) memo.set(card, (r = costsOf(card)));
  return r;
}

/** True when one of the card's spell costs passes `op n`. An X cost passes any > or >=, and = for mv, mv + x… */
export function spellMvMatches(card: Pick<Card, "name" | "type" | "manaCost" | "text">, op: string, n: number): boolean {
  return spellCosts(card).some((c) => {
    if (!c.x) return cmp(c.mv, op, n);
    if (op === ">" || op === ">=") return true;
    if (op === "=") return n >= c.mv && (n - c.mv) % c.x === 0;
    return cmp(c.mv, op, n);
  });
}
