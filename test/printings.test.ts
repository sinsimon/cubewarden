import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { createWorkspace, exportCsv, type Card, type Printing, type Project } from "../src/index.ts";
import { mergeCards } from "../src/hosted.ts";
import { card, config, rule } from "./fixtures/cards.ts";

// A cube entry is a card (oracle id) plus the printing it is shown and exported in. "Make Your Move" is printed in
// msc (a Commander product), tmt, fdn and mkm; the CubeCobra list stores it as msc #137.
const p = (set: string, number: string): Printing => ({ set, number, scryfallId: `${set}-${number}`, image: `https://img/${set}/${number}.jpg` });
const MSC = p("msc", "137"), TMT = p("tmt", "61"), FDN = p("fdn", "143"), MKM = p("mkm", "70");

/** Fresh card objects for every test: the shown printing lives on the card objects of one workspace. */
function cards(): Record<string, Card> {
  const list = [
    // Shown in the CubeCobra printing (msc); its win rate comes from fdn.
    card("MYM", { name: "Make Your Move", type: "Instant", ...MSC, printSets: ["fdn", "mkm", "msc", "tmt"], wrSet: "fdn", wrDelta: 1,
      printings: [MSC, TMT, FDN, MKM] }),
    // No win rate: the newest allowed printing (tmt) is the one to use.
    card("NWR", { name: "No Win Rate", ...p("msc", "9"), printSets: ["fdn", "msc", "tmt"], printings: [p("msc", "9"), p("tmt", "5"), p("fdn", "4")] }),
    // Only printed outside the allowed sets: nothing to switch to.
    card("ONLY", { name: "Only Commander", ...p("msc", "200"), printSets: ["msc"], printings: [p("msc", "200")] }),
    // Already in an allowed printing.
    card("OK", { name: "Fine Card", ...p("fdn", "10"), printSets: ["fdn"], printings: [p("fdn", "10")] }),
    // Outside the cube, with several printings.
    card("OUT", { name: "Candidate", ...p("dsk", "3"), printSets: ["dsk", "fdn", "tmt"], printings: [p("dsk", "3"), p("tmt", "7"), p("fdn", "8")] }),
    // Old card data: no list of printings, only the one shown.
    card("OLD", { name: "Old Data", ...p("fdn", "50"), printSets: ["fdn"] }),
  ];
  return Object.fromEntries(list.map((c) => [c.id, c]));
}
function project(withSetRule = true): Project {
  return {
    version: 1, original: ["MYM", "NWR", "ONLY", "OK", "OLD"], current: ["MYM", "NWR", "ONLY", "OK", "OLD"], maybeboard: [],
    config: config({ rules: withSetRule ? [rule("cube-sets", { kind: "cube" }, "every(s:fdn,tmt)")] : [] }),
  };
}
const row = (csv: string, name: string) => csv.split("\n").find((l) => l.startsWith(`"${name}"`))!.split(",");

describe("printings: a project without chosen printings", () => {
  it("shows and exports each card in the printing the data has (the CubeCobra list's), as before", () => {
    const w = createWorkspace(project(false), cards());
    expect(w.cardsById.MYM).toMatchObject({ set: "msc", number: "137", image: MSC.image, scryfallId: MSC.scryfallId });
    const csv = exportCsv(w.project.current, w.cardsById);
    expect(row(csv, "Make Your Move").slice(4, 6)).toEqual(["msc", "137"]);
    expect(w.printingIssues()).toEqual([]);
    expect(w.project.printings).toBeUndefined();
  });
});

describe("printings outside the cube's allowed sets", () => {
  it("lists the cube and maybeboard entries printed outside the sets of the 'every card' rule, with the printing to use", () => {
    const pr = project();
    pr.current = pr.current.filter((id) => id !== "NWR");
    pr.maybeboard = ["NWR"];
    const issues = createWorkspace(pr, cards()).printingIssues();
    expect(issues.map((i) => [i.name, i.board, `${i.printing.set} ${i.printing.number}`, i.fix && `${i.fix.set} ${i.fix.number}`])).toEqual([
      ["Make Your Move", "cube", "msc 137", "fdn 143"], // the set its win rate comes from
      ["Only Commander", "cube", "msc 200", null], // no allowed printing in the data
      ["No Win Rate", "maybeboard", "msc 9", "tmt 5"], // no win rate: the newest allowed set
    ]);
  });

  it("switches every entry it can to an allowed printing at once, and says which it could not", () => {
    const w = createWorkspace(project(), cards());
    const before = w.check();
    const r = w.useAllowedPrintings();
    expect(r.changed.map((c) => [c.name, c.from, c.to])).toEqual([["Make Your Move", "MSC 137", "FDN 143"], ["No Win Rate", "MSC 9", "TMT 5"]]);
    expect(r.skipped.map((c) => c.name)).toEqual(["Only Commander"]);
    expect(w.cardsById.MYM).toMatchObject({ set: "fdn", number: "143", image: FDN.image, scryfallId: FDN.scryfallId });
    expect(w.project.printings?.MYM).toEqual(FDN);
    expect(w.printingIssues().map((i) => i.name)).toEqual(["Only Commander"]);
    // The card stays the same card: rules, filters and win rates do not move.
    expect(w.cardsById.MYM).toMatchObject({ printSets: ["fdn", "mkm", "msc", "tmt"], wrSet: "fdn", wrDelta: 1, rarity: "common" });
    expect(w.check()).toEqual(before);
    const csv = exportCsv(w.project.current, w.cardsById);
    expect(row(csv, "Make Your Move").slice(4, 6)).toEqual(["fdn", "143"]);
    expect(row(csv, "No Win Rate").slice(4, 6)).toEqual(["tmt", "5"]);
  });

  it("switches one card on request", () => {
    const w = createWorkspace(project(), cards());
    const r = w.useAllowedPrintings(["No Win Rate"]);
    expect(r.changed.map((c) => c.to)).toEqual(["TMT 5"]);
    expect(w.cardsById.MYM.set).toBe("msc");
  });
});

describe("choosing a printing", () => {
  it("lists a card's printings, the cube's allowed sets first, and marks the one shown", () => {
    const o = createWorkspace(project(), cards()).printings("Make Your Move");
    expect(o).toMatchObject({ name: "Make Your Move", board: "cube", shown: { set: "msc", number: "137" } });
    expect(o.options.map((x) => [x.label, x.allowed, x.shown])).toEqual([
      ["TMT 61", true, false], ["FDN 143", true, false], ["MSC 137", false, true], ["MKM 70", false, false],
    ]);
  });

  it("switches to a printing the data has, by set and optionally collector number, and back", () => {
    const w = createWorkspace(project(), cards());
    expect(w.setPrinting("Make Your Move", "TMT")).toMatchObject({ name: "Make Your Move", printing: { set: "tmt", number: "61" }, allowed: true });
    expect(w.cardsById.MYM).toMatchObject({ set: "tmt", number: "61", image: TMT.image });
    w.setPrinting("Make Your Move", "fdn", "143");
    expect(w.cardsById.MYM.number).toBe("143");
    // Back to the printing of the imported list: nothing left to remember.
    w.setPrinting("Make Your Move", "msc");
    expect(w.cardsById.MYM).toMatchObject({ set: "msc", number: "137", image: MSC.image });
    expect(w.project.printings?.MYM).toBeUndefined();
  });

  it("refuses printings the data does not have, and cards in neither the cube nor the maybeboard", () => {
    const w = createWorkspace(project(), cards());
    expect(() => w.setPrinting("Make Your Move", "dsk")).toThrow(/No DSK printing of "Make Your Move".*MSC 137, TMT 61, FDN 143, MKM 70/);
    expect(() => w.setPrinting("Make Your Move", "fdn", "999")).toThrow(/No FDN 999 printing/);
    expect(() => w.setPrinting("Old Data", "tmt")).toThrow(/No TMT printing of "Old Data"/);
    expect(() => w.setPrinting("Candidate", "fdn")).toThrow(/"Candidate" is neither in the cube nor in the maybeboard/);
  });

  it("adds a card in a given printing: Name (SET) or Name (SET) number", () => {
    const w = createWorkspace(project(), cards());
    w.applyChanges({ add: ["Candidate (FDN)"] });
    expect(w.project.current).toContain("OUT");
    expect(w.cardsById.OUT).toMatchObject({ set: "fdn", number: "8" });
    w.applyChanges({ remove: ["Candidate"] });
    w.maybeboard({ add: ["Candidate (TMT) 7"] });
    expect(w.cardsById.OUT).toMatchObject({ set: "tmt", number: "7" });
    expect(() => w.applyChanges({ add: ["Candidate (MKM)"] })).toThrow(/No MKM printing of "Candidate"/);
  });

  it("forgets the printing when the card leaves both the cube and the maybeboard", () => {
    const w = createWorkspace(project(), cards());
    w.setPrinting("Make Your Move", "fdn");
    w.applyChanges({ remove: ["Make Your Move"] });
    expect(w.project.printings?.MYM).toBeUndefined();
    expect(w.cardsById.MYM.set).toBe("msc");
  });

  it("keeps the printing when the card moves to the maybeboard", () => {
    const w = createWorkspace(project(), cards());
    w.setPrinting("Make Your Move", "fdn");
    w.applyChanges({ remove: ["Make Your Move"], toMaybeboard: true });
    expect(w.cardsById.MYM.set).toBe("fdn");
  });

  it("lists printing changes against the imported list in the changelist", () => {
    const w = createWorkspace(project(), cards());
    w.setPrinting("Make Your Move", "fdn");
    const c = w.changes();
    expect(c.printings).toEqual([{ id: "MYM", name: "Make Your Move", from: "MSC 137", to: "FDN 143" }]);
    expect(c.text).toContain("Printings:\n~ Make Your Move: MSC 137 → FDN 143");
  });

  it("shows a saved project's printings as soon as it is opened", () => {
    const pr = project();
    pr.printings = { MYM: FDN };
    const w = createWorkspace(pr, cards());
    expect(w.cardsById.MYM).toMatchObject({ set: "fdn", number: "143", image: FDN.image });
  });
});

describe("printings from the command line", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
    writeFileSync(join(dir, "cubewarden.json"), JSON.stringify(project()));
    writeFileSync(join(dir, "cards.json"), JSON.stringify(Object.values(cards())));
    return dir;
  }
  const cli = async (dir: string, ...argv: string[]) => {
    let out = "";
    const code = await run(argv, { cwd: dir, write: (s) => (out += s) });
    return { code, out };
  };
  const file = (dir: string): Project => JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8"));

  it("lists, sets and fixes printings, and exports the chosen ones", async () => {
    const dir = setup();
    const list = await cli(dir, "printing", "Make Your Move");
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/TMT 61 +allowed/);
    expect(list.out).toMatch(/MSC 137 +outside the allowed sets +shown/);
    expect((await cli(dir, "printing", "Make Your Move", "tmt")).code).toBe(0);
    expect(file(dir).printings?.MYM).toMatchObject({ set: "tmt", number: "61" });
    expect((await cli(dir, "printings")).out).toMatch(/No Win Rate: MSC 9 → TMT 5/);
    const fix = await cli(dir, "printings", "fix");
    expect(fix.code).toBe(0);
    expect(fix.out).toMatch(/No Win Rate: MSC 9 → TMT 5/);
    expect(fix.out).toMatch(/Only Commander: MSC 200, no printing in an allowed set/);
    const csv = (await cli(dir, "export", "csv")).out;
    expect(row(csv, "Make Your Move").slice(4, 6)).toEqual(["tmt", "61"]);
    expect(row(csv, "No Win Rate").slice(4, 6)).toEqual(["tmt", "5"]);
    expect((await cli(dir, "printing", "Make Your Move", "dsk")).code).toBe(2);
  });
});

describe("printings on the hosted page", () => {
  it("keeps every set file's printing of a card, and the CubeCobra list's, so the cube can switch between them", () => {
    const index = { version: 1 as const, builtAt: "2026-11-01", sets: [
      { code: "tmt", name: "TMT", released: "2026-03-01", cards: 1 }, { code: "fdn", name: "FDN", released: "2024-11-15", cards: 1 },
      { code: "mkm", name: "MKM", released: "2024-02-09", cards: 1 },
    ] };
    const shard = (pr: Printing, over: Partial<Card> = {}) => ({ set: pr.set, cards: [card("MYM", { name: "Make Your Move", ...pr, printSets: [pr.set], ...over })] });
    const shards = [shard(MKM), shard(FDN, { wrSet: "fdn", wrDelta: 1, wrRaw: 0.56 }), shard(TMT)];
    const fromCube = { MYM: card("MYM", { name: "Make Your Move", ...MSC, printSets: ["msc"] }) };
    const [merged] = mergeCards(shards, index, fromCube);
    expect(merged).toMatchObject({ set: "msc", number: "137", wrSet: "fdn" });
    expect(merged.printings!.map((x) => `${x.set} ${x.number}`)).toEqual(["msc 137", "tmt 61", "fdn 143", "mkm 70"]);
    const w = createWorkspace({ ...project(), current: ["MYM"], original: ["MYM"] }, { MYM: merged });
    w.useAllowedPrintings();
    expect(w.cardsById.MYM).toMatchObject({ set: "fdn", number: "143", image: FDN.image });
    // Without a CubeCobra list: the newest set file's printing, as before.
    expect(mergeCards(shards, index)[0]).toMatchObject({ set: "tmt", number: "61" });
  });
});
