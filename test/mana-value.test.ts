import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { cardFromPrintings, type ScryfallCard } from "../src/data/index.ts";
import { cardFromCubeCobra, createWorkspace, evaluate, manaValue, matches, parseFilter, spellCosts, type Card, type Project } from "../src/index.ts";
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

describe("mana value: the cube's \"X counts as\" setting", () => {
  // Fresh cards for each test: the setting is applied to the card objects in place.
  const cube = () => [
    card("XGG", { name: "Hydra", colors: "G", manaCost: "{X}{G}{G}", mv: 2 }),
    card("XG", { name: "Small Hydra", colors: "G", manaCost: "{X}{G}", mv: 1 }),
    card("TWOG", { name: "Bear Cub", colors: "G", manaCost: "{2}{G}", mv: 3 }),
    card("XTB", { name: "Twobrid Hydra", colors: "G", manaCost: "{X}{2/G}", mv: 1 }), // as loaded: {2/G} = 1.5, rounded down
    card("TXT", { name: "Text X", colors: "G", type: "Sorcery", manaCost: "{1}{G}", mv: 2, text: "Draw X cards, where X is the number of creatures you control.", power: null, toughness: null }),
  ];
  const outside = () => [
    card("BIGX", { name: "Big X", colors: "G", manaCost: "{X}{X}{G}", mv: 1 }),
    card("FOUR", { name: "Four Drop", colors: "G", manaCost: "{3}{G}", mv: 4 }),
  ];
  const byId = (cards: Card[]) => Object.fromEntries(cards.map((c) => [c.id, c]));
  function project(xValue?: number): Project {
    const ids = cube().map((c) => c.id);
    return {
      version: 1, original: [...ids], current: [...ids],
      config: config({
        cube: { name: "X cube", ...(xValue != null ? { xValue } : {}) },
        rules: [rule("curve", { kind: "cube" }, "curve(t:creature) 1:0 2:0 3:3 4:1"), rule("big", { kind: "cube" }, "count(mv>=4) = 1")],
      }),
    };
  }
  const ws = (p: Project) => createWorkspace(p, byId([...cube(), ...outside()]));

  it("counts each {X} as N, from 0 (the official rule)", () => {
    expect(manaValue(card("A", { manaCost: "{X}{G}{G}", mv: 2 }))).toBe(2);
    expect(manaValue(card("A", { manaCost: "{X}{G}{G}", mv: 2 }), 0)).toBe(2);
    expect(manaValue(card("A", { manaCost: "{X}{G}{G}", mv: 2 }), 2)).toBe(4);
    expect(manaValue(card("A", { manaCost: "{X}{G}", mv: 1 }), 2)).toBe(3);
    expect(manaValue(card("A", { manaCost: "{X}{X}{R}", mv: 1 }), 2)).toBe(5);
    expect(manaValue(card("A", { manaCost: "{3}{G}", mv: 4 }), 2)).toBe(4);
  });
  it("adds N per {X} before the twobrid total is rounded down", () => {
    expect(manaValue(card("A", { manaCost: "{X}{2/R}", mv: 2 }), 2)).toBe(3);
    expect(manaValue(card("A", { manaCost: "{X}{2/R}{2/R}", mv: 4 }), 2)).toBe(5);
    expect(manaValue(card("A", { manaCost: "{X}{2/R}{2/R}", mv: 4 }), 0)).toBe(3);
  });
  it("reads only the {X} of the mana cost, on the front face", () => {
    expect(manaValue(card("A", { manaCost: "{1}{G}", mv: 2, text: "Draw X cards." }), 2)).toBe(2);
    expect(manaValue(card("A", { manaCost: "{X}{G} // {1}{G}", mv: 1 }), 2)).toBe(3);
    expect(manaValue(card("A", { manaCost: "{U/R}{U/R} // {X}{U}{U}{R}{R}", mv: 6, type: "Instant // Instant" }), 2)).toBe(6);
  });

  it("leaves a project without the setting on the official rule", () => {
    const w = ws(project());
    expect(w.settings()).toEqual({ xValue: 0 });
    const e = w.explain("curve");
    expect(e.cards.map((c) => [c.id, c.mv])).toEqual([["XGG", 2], ["XG", 1], ["TWOG", 3], ["XTB", 1]]);
    expect(e.buckets!.map((b) => [b.label, b.value])).toEqual([["1", 2], ["2", 1], ["3", 1], ["4", 0]]);
  });
  it("puts X cards in the curve, the mv filter, avg, sorting and results with X = N", () => {
    const w = ws(project(2));
    expect(w.settings()).toEqual({ xValue: 2 });
    const e = w.explain("curve");
    expect(e.cards.map((c) => [c.id, c.mv])).toEqual([["XGG", 4], ["XG", 3], ["TWOG", 3], ["XTB", 3]]);
    expect(e.buckets!.map((b) => [b.label, b.value, b.status])).toEqual([["1", 0, "ok"], ["2", 0, "ok"], ["3", 3, "ok"], ["4", 1, "ok"]]);
    expect(w.explain("big")).toMatchObject({ value: 1, status: "ok" });
    expect(w.explain("big").cards.map((c) => c.id)).toEqual(["XGG"]);
    expect(w.search("t:creature", { sort: "mv" }).cards.map((c) => [c.id, c.mv])).toEqual([["FOUR", 4], ["BIGX", 5]]);
    expect(w.setRule({ id: "avg", scope: "cube", text: "avg(mv, t:creature) >= 3" })).toBeTruthy();
    expect(w.explain("avg").value).toBeCloseTo(13 / 4, 5);
  });
  it("is honoured by evaluate on its own", () => {
    const p = project(2);
    const r = evaluate(p.config, p.current, byId(cube()));
    expect(r.cube.rules.find((x) => x.id === "curve")!.buckets!.map((b) => b.value)).toEqual([0, 0, 3, 1]);
  });
  it("counts N per {X} in spellmv, going up from there", () => {
    const spell = () => card("XS", { name: "Blaze", colors: "R", type: "Sorcery", manaCost: "{X}{R}", mv: 1, power: null, toughness: null });
    const s0 = spell();
    expect(spellCosts(s0)).toEqual([{ mv: 1, x: 1, via: "cast" }]);
    const p = { ...project(2), current: ["XS"], original: ["XS"] };
    const s2 = spell();
    const w = createWorkspace(p, { XS: s2 });
    expect(spellCosts(s2)).toEqual([{ mv: 3, x: 1, via: "cast" }]);
    expect(matches(s2, parseFilter("spellmv<=2"))).toBe(false);
    expect(matches(s2, parseFilter("spellmv=4"))).toBe(true);
    w.setSettings({ xValue: 0 });
    expect(spellCosts(s2)).toEqual([{ mv: 1, x: 1, via: "cast" }]);
    expect(matches(s2, parseFilter("spellmv<=2"))).toBe(true);
  });

  it("setSettings changes it in the project, re-evaluates, and 0 restores the official values", () => {
    const p = project();
    const w = ws(p);
    let changed = 0;
    w.onChange(() => changed++);
    expect(w.setSettings({ xValue: 2 })).toEqual({ xValue: 2 });
    expect(p.config.cube.xValue).toBe(2);
    expect(changed).toBe(1);
    expect(w.explain("curve").buckets!.map((b) => b.value)).toEqual([0, 0, 3, 1]);
    w.setSettings({ xValue: 2 });
    expect(w.explain("curve").cards.map((c) => c.mv)).toEqual([4, 3, 3, 3]);
    w.setSettings({ xValue: 0 });
    expect("xValue" in p.config.cube).toBe(false);
    expect(w.explain("curve").cards.map((c) => c.mv)).toEqual([2, 1, 3, 1]);
  });
  it("setSettings refuses anything but a whole number from 0", () => {
    const w = ws(project());
    for (const bad of [-1, 1.5, Number.NaN, "2" as unknown as number]) expect(() => w.setSettings({ xValue: bad })).toThrow(/X counts as/);
    expect(w.settings()).toEqual({ xValue: 0 });
  });

  it("is read from the project file by the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
    const p = project(2);
    writeFileSync(join(dir, "cubewarden.json"), JSON.stringify(p));
    writeFileSync(join(dir, "cards.json"), JSON.stringify([...cube(), ...outside()]));
    let out = "";
    expect(await run(["explain", "curve", "--json"], { cwd: dir, write: (s) => (out += s) })).toBe(0);
    expect(JSON.parse(out).cards.map((c: { mv: number }) => c.mv)).toEqual([4, 3, 3, 3]);
  });
});
