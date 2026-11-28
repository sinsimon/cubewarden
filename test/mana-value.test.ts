import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { cardFromPrintings, type ScryfallCard } from "../src/data/index.ts";
import { cardFromCubeCobra, manaValue, matches, parseFilter, spellCosts, type Project } from "../src/index.ts";
import { card, config, rule } from "./fixtures/cards.ts";

// Mana values as Scryfall gives them: a twobrid pip ({2/R}) counts 2 there.
const MAGMABLOOD = card("MAG", { name: "Magmablood Archaic", colors: "R", manaCost: "{2/R}{2/R}{2/R}", mv: 6 });
const WILDGROWTH = card("WILD", { name: "Wildgrowth Archaic", colors: "G", manaCost: "{2/G}{2/G}", mv: 4 });
const JAVELIN = card("JAV", { name: "Flame Javelin", colors: "R", type: "Instant", manaCost: "{2/R}{2/R}{2/R}", mv: 6, power: null, toughness: null });

describe("mana value: a twobrid pip counts 1.5, the total rounded down", () => {
  it("values twobrid costs", () => {
    expect(manaValue(MAGMABLOOD)).toBe(4);
    expect(manaValue(WILDGROWTH)).toBe(3);
    expect(manaValue(card("X", { manaCost: "{1}{2/W}", mv: 3 }))).toBe(2);
    expect(manaValue(card("X", { manaCost: "{2/W}{2/U}{2/B}{2/R}{2/G}", mv: 10 }))).toBe(7);
  });
  it("keeps the mana value of every other card", () => {
    expect(manaValue(card("X", { manaCost: "{3}{G}", mv: 4 }))).toBe(4);
    expect(manaValue(card("X", { manaCost: "{R/G}{R/G}", mv: 2 }))).toBe(2);
    expect(manaValue(card("X", { manaCost: "{1}{W/P}", mv: 2 }))).toBe(2);
    expect(manaValue(card("X", { manaCost: "{X}{R}", mv: 1 }))).toBe(1);
    expect(manaValue(card("X", { manaCost: "{1}{G} // {G}", mv: 2 }))).toBe(2);
  });
  it("gives the same value when applied to a value it already computed", () => {
    expect(manaValue({ ...MAGMABLOOD, mv: 4 })).toBe(4);
    expect(manaValue({ ...WILDGROWTH, mv: 3 })).toBe(3);
  });
  it("is the mv of a card built from Scryfall data", () => {
    const sc = { id: "s1", oracle_id: "o-mag", name: "Magmablood Archaic", layout: "normal", set: "c21", collector_number: "50", rarity: "rare",
      released_at: "2021-04-23", cmc: 6, mana_cost: "{2/R}{2/R}{2/R}", type_line: "Creature — Avatar", colors: ["R"], color_identity: ["R"] } as unknown as ScryfallCard;
    expect(cardFromPrintings([sc]).mv).toBe(4);
    const plain = { ...sc, id: "s2", oracle_id: "o-plain", name: "Plain", cmc: 4, mana_cost: "{3}{R}" } as unknown as ScryfallCard;
    expect(cardFromPrintings([plain]).mv).toBe(4);
  });
  it("is the mv of a card read from CubeCobra", () => {
    const c = cardFromCubeCobra({ oracle_id: "o-wild", name: "Wildgrowth Archaic", parsed_cost: ["2-g", "2-g"], cmc: 4, type: "Creature — Avatar" } as never);
    expect(c).toMatchObject({ manaCost: "{2/G}{2/G}", mv: 3 });
  });
  it("is the spellmv of a twobrid spell's own cost", () => {
    expect(spellCosts(JAVELIN)).toEqual([{ mv: 4, via: "cast" }]);
    expect(matches(JAVELIN, parseFilter("spellmv<=4"))).toBe(true);
  });
});

describe("mana value in the CLI, from card data that still has Scryfall's value", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
    const cards = [MAGMABLOOD, WILDGROWTH, card("R1", { name: "Hill Giant", colors: "R", manaCost: "{3}{R}", mv: 4 })];
    const project: Project = { version: 1, original: ["MAG", "WILD", "R1"], current: ["MAG", "WILD", "R1"], config: config() };
    writeFileSync(join(dir, "cubewarden.json"), JSON.stringify(project));
    writeFileSync(join(dir, "cards.json"), JSON.stringify(cards));
    return dir;
  }
  const cli = async (dir: string, ...argv: string[]) => {
    let out = "";
    const code = await run(argv, { cwd: dir, write: (s) => (out += s) });
    return { code, out };
  };

  it("puts Magmablood Archaic in the curve's 4 bucket", async () => {
    const dir = setup();
    expect((await cli(dir, "rule", "set", "curve", "--scope", "cube", "--text", "curve(t:creature) 3:1 4:2 6:0")).code).toBe(0);
    const r = JSON.parse((await cli(dir, "explain", "curve", "--json")).out);
    expect(r.buckets).toEqual([
      { label: "3", value: 1, target: "= 1", status: "ok" },
      { label: "4", value: 2, target: "= 2", status: "ok" },
      { label: "6", value: 0, target: "= 0", status: "ok" },
    ]);
    expect(r.cards.find((c: { id: string }) => c.id === "MAG")).toMatchObject({ mv: 4, value: 4 });
    expect((await cli(dir, "explain", "curve")).out).toContain("MV4 2 (target = 2) ok");
  });
  it("filters, averages and sorts on it", async () => {
    const dir = setup();
    expect((await cli(dir, "rule", "set", "big", "--scope", "cube", "--text", "count(mv>=5) = 0")).code).toBe(0);
    expect(JSON.parse((await cli(dir, "explain", "big", "--json")).out).value).toBe(0);
    expect((await cli(dir, "rule", "set", "avg", "--scope", "cube", "--text", "avg(mv) in 3..4")).code).toBe(0);
    expect(JSON.parse((await cli(dir, "explain", "avg", "--json")).out).value).toBeCloseTo(11 / 3, 5);
    expect((await cli(dir, "apply", "--remove", "Magmablood Archaic", "--remove", "Wildgrowth Archaic")).code).toBe(0);
    const s = JSON.parse((await cli(dir, "search", "t:creature", "--sort", "mv", "--json")).out);
    expect(s.cards.map((c: { name: string; mv: number }) => [c.name, c.mv])).toEqual([["Wildgrowth Archaic", 3], ["Magmablood Archaic", 4]]);
  });
});
