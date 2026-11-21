import type { Card, Config, Rule, Scope } from "../../src/index.ts";
import { parseRule } from "../../src/index.ts";

/** A card with sensible blanks; tests set only what matters. */
export function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id, name: id, colors: "", identity: "", manaCost: "", hybrid: false, type: "Creature", mv: 2, power: "2", toughness: "2",
    text: "", keywords: [], tags: [], set: "fdn", number: "1", rarity: "common", printSets: ["fdn"], image: null,
    wrDelta: null, wrRaw: null, ...over,
  };
}

/**
 * Ten cards with hand-picked values. WR Δ (points): W1 1.5, W2 3, W3 -1, U1 0.5, WU1 4.5, WU2 -0.5, C1 -5, G1 2
 * (average 0.625); U2 and the land have no data.
 */
export const CARDS: Card[] = [
  card("W1", { colors: "W", manaCost: "{1}{W}", mv: 2, wrDelta: 1.5 }),
  card("W2", { colors: "W", manaCost: "{2}{W}", mv: 3, keywords: ["flying"], wrDelta: 3 }),
  card("W3", { colors: "W", type: "Instant", manaCost: "{W}", mv: 1, tags: ["removal"], wrDelta: -1, printSets: ["trk"], set: "trk" }),
  card("U1", { colors: "U", manaCost: "{1}{U}", mv: 2, wrDelta: 0.5 }),
  card("U2", { colors: "U", type: "Instant", manaCost: "{U}{U}", mv: 2, tags: ["counterspell"] }),
  card("WU1", { colors: "WU", manaCost: "{1}{W}{U}", mv: 3, wrDelta: 4.5 }),
  card("WU2", { colors: "WU", manaCost: "{W/U}{W/U}", hybrid: true, mv: 2, wrDelta: -0.5 }),
  card("L1", { colors: "", type: "Land", mv: 0, power: null, toughness: null }),
  card("C1", { colors: "", type: "Artifact", manaCost: "{2}", mv: 2, wrDelta: -5, power: null, toughness: null }),
  card("G1", { colors: "G", manaCost: "{3}{G}", mv: 4, wrDelta: 2 }),
];
export const BY_ID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const ALL = CARDS.map((c) => c.id);

/** A rule from its text, e.g. rule("size", { kind: "cube" }, "count() <= 360"). */
export function rule(id: string, scope: Scope, text: string, over: Partial<Rule> = {}): Rule {
  return { id, name: id, scope, ...parseRule(text), ...over };
}

export function config(over: Partial<Config> = {}): Config {
  return {
    version: 1,
    cube: { name: "Test cube" },
    colors: ["W", "U", "B", "R", "G", "C", "L"].map((code) => ({ code: code as "W", mechanics: [] })),
    archetypes: [],
    rules: [],
    ...over,
  };
}
