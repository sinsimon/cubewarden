import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { recentre, setCentres, withWinRate, type WinRateTable } from "../src/data/index.ts";
import { mergeCards } from "../src/hosted.ts";
import { readCubeCobra } from "../src/index.ts";
import { card } from "./fixtures/cards.ts";

/** A data folder as the data branch had it before WR Δ: shards with the adjusted WR (wrAdj), no centre in the index. */
function legacyDataDir() {
  const out = mkdtempSync(join(tmpdir(), "cubewarden-data-"));
  mkdirSync(join(out, "sets"));
  const wr = { source: "game-data", asOf: "2026-01-01", games: 1000 };
  writeFileSync(join(out, "index.json"), JSON.stringify({ version: 1, builtAt: "2026-02-01", sets: [
    { code: "bbb", name: "Set B", released: "2026-01-10", cards: 3, builtAt: "2026-02-01", wr },
    { code: "aaa", name: "Set A", released: "2025-06-01", cards: 5, builtAt: "2026-02-01", wr },
  ] }));
  const legacy = (id: string, set: string, rarity: string, wrAdj: number | null, wrRaw: number | null = wrAdj) =>
    ({ ...card(id, { set, rarity, printSets: [set], wrRaw, wrSet: wrRaw == null ? null : set }), wrDelta: undefined, wrAdj });
  writeFileSync(join(out, "sets", "aaa.json"), JSON.stringify({ set: "aaa", builtAt: "2026-02-01", cards: [
    legacy("A1", "aaa", "common", 0.55), legacy("A2", "aaa", "uncommon", 0.57), legacy("A3", "aaa", "rare", 0.62),
    legacy("A4", "aaa", "common", null, 0.5), legacy("A5", "aaa", "common", null, null),
  ] }));
  writeFileSync(join(out, "sets", "bbb.json"), JSON.stringify({ set: "bbb", builtAt: "2026-02-01", cards: [
    legacy("B1", "bbb", "common", 0.6), legacy("B2", "bbb", "uncommon", 0.58), legacy("B3", "bbb", "mythic", 0.5),
  ] }));
  return out;
}
const read = (out: string, f: string) => JSON.parse(readFileSync(join(out, f), "utf8"));

describe("WR Δ in the published data", () => {
  it("centres each set on the mean adjusted WR of its commons and uncommons and stores the centre in index.json", async () => {
    const out = legacyDataDir();
    await recentre(out);
    const index = read(out, "index.json");
    expect(index.version).toBe(1);
    expect(Object.fromEntries(index.sets.map((s: { code: string; wr: { centre: number } }) => [s.code, s.wr.centre]))).toEqual({ aaa: 0.56, bbb: 0.59 });
    const a = read(out, "sets/aaa.json").cards;
    expect(a.map((c: { id: string; wrDelta: number | null }) => [c.id, c.wrDelta])).toEqual([["A1", -1], ["A2", 1], ["A3", 6], ["A4", null], ["A5", null]]);
    expect(a.some((c: object) => "wrAdj" in c)).toBe(false);
    expect(read(out, "sets/bbb.json").cards.map((c: { wrDelta: number }) => c.wrDelta)).toEqual([1, -1, -9]);
  });
  it("gives the same files when run again on data it already centred", async () => {
    const out = legacyDataDir();
    await recentre(out);
    const first = ["index.json", "sets/aaa.json", "sets/bbb.json"].map((f) => readFileSync(join(out, f), "utf8"));
    await recentre(out);
    expect(["index.json", "sets/aaa.json", "sets/bbb.json"].map((f) => readFileSync(join(out, f), "utf8"))).toEqual(first);
  });
  it("runs offline from the command line as `data recentre`", async () => {
    const out = legacyDataDir();
    let text = "";
    expect(await run(["data", "recentre", "--out", out], { cwd: out, write: (s) => (text += s) })).toBe(0);
    expect(text).toContain("2 set file(s), 2 rewritten");
    expect(read(out, "index.json").sets[0].wr.centre).toBe(0.59);
  });
});

describe("the hosted page's card images", () => {
  it("shows Scryfall's image of the printing the CubeCobra cube chose", async () => {
    const sample = JSON.parse(readFileSync(new URL("./fixtures/cubecobra-cube.json", import.meta.url), "utf8"));
    const d = sample.cards.mainboard[0].details;
    const cube = await readCubeCobra({ cards: { mainboard: [sample.cards.mainboard[0]] } });
    const index = { version: 1 as const, builtAt: "2026-02-01", sets: [{ code: "new", name: "New", released: "2026-01-01", cards: 1 }] };
    const shards = [{ set: "new", cards: [card("X", { id: d.oracle_id, set: "new", printSets: ["new"], scryfallId: "other",
      image: "https://cards.scryfall.io/normal/front/0/0/other.jpg" })] }];
    expect(mergeCards(shards, index, cube.cards)[0]).toMatchObject({
      scryfallId: d.scryfall_id, image: `https://cards.scryfall.io/normal/front/e/e/${d.scryfall_id}.jpg`,
    });
  });
});

describe("WR Δ of a card whose win rate comes from another set", () => {
  it("keeps the delta of the set the win rate comes from when the hosted page merges set files", () => {
    const index = { version: 1 as const, builtAt: "2026-02-01", sets: [
      { code: "new", name: "New", released: "2026-01-01", cards: 1 }, { code: "old", name: "Old", released: "2025-01-01", cards: 1 },
    ] };
    const shards = [
      { set: "new", cards: [card("X", { set: "new", printSets: ["new"] })] },
      { set: "old", cards: [card("X", { set: "old", printSets: ["old"], wrDelta: 2.5, wrRaw: 0.58, wrSet: "old" })] },
    ];
    expect(mergeCards(shards, index)[0]).toMatchObject({ wrDelta: 2.5, wrSet: "old", printSets: ["new", "old"] });
  });
  it("centres a local build on the commons and uncommons of the set the win rate comes from", () => {
    const table: WinRateTable = {
      source: "test", sets: { aaa: { released: "2025-01-01", asOf: null }, bbb: { released: "2026-01-01", asOf: null } },
      cards: {
        A1: { aaa: { gihWr: 0.55, adjWr: 0.55, games: 900, rarity: "common" } },
        A2: { aaa: { gihWr: 0.57, adjWr: 0.57, games: 900, rarity: "uncommon" } },
        A3: { aaa: { gihWr: 0.62, adjWr: 0.62, games: 900, rarity: "rare" } },
        B1: { bbb: { gihWr: 0.6, adjWr: 0.6, games: 900 } },
        B2: { bbb: { gihWr: 0.62, adjWr: 0.62, games: 900, rarity: "uncommon" } },
      },
    };
    // B1 has no rarity in the table: its rarity in bbb comes from the card when the card is shown in bbb.
    const cards = [card("A1"), card("A2"), card("A3", { set: "zzz", rarity: "common" }), card("B1", { set: "bbb", rarity: "common" }), card("B2")];
    const centres = setCentres(table, cards);
    expect(centres).toEqual({ aaa: 0.56, bbb: 0.61 });
    const built = Object.fromEntries(cards.map((c) => withWinRate(c, table, ["aaa", "bbb"], centres)).map((c) => [c.id, c]));
    expect(built.A3).toMatchObject({ wrSet: "aaa", wrRaw: 0.62, wrDelta: 6 });
    expect(built.B1).toMatchObject({ wrSet: "bbb", wrDelta: -1 });
    expect(built.B2).toMatchObject({ wrSet: "bbb", wrDelta: 1 });
  });
});
