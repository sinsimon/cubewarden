import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aboutMarkdown, changelist, cubeCobraListUrl, decodeRules, diff, encodeRules, evaluate, exportCsv, parseFilter, readCubeCobra,
  type Card, type Config,
} from "../src/index.ts";
import { ALL, BY_ID, config, rule } from "./fixtures/cards.ts";

const SAMPLE = JSON.parse(readFileSync(new URL("./fixtures/cubecobra-cube.json", import.meta.url), "utf8"));
const byName = (cards: Record<string, Card>, name: string) => Object.values(cards).find((c) => c.name === name)!;

describe("reading a CubeCobra cube", () => {
  it("lists the mainboard and maybeboard by oracle id and turns each card into our shape", async () => {
    const cube = await readCubeCobra(SAMPLE);
    expect(cube.name).toBe("Sample cube");
    expect(cube.mainboard).toHaveLength(5);
    expect(cube.maybeboard).toHaveLength(1);
    expect(byName(cube.cards, "Sokka, Lateral Strategist")).toMatchObject({ colors: "WU", manaCost: "{1}{W/U}{W/U}", hybrid: true });
    expect(byName(cube.cards, "No More Lies")).toMatchObject({ colors: "WU", manaCost: "{W}{U}", hybrid: false, type: "Instant" });
    expect(byName(cube.cards, "Gran-Gran").tags).toContain("triggered-ability");
    expect(cube.config).toBeNull();
  });
  it("counts a card listed twice once, and says how many duplicates it dropped", async () => {
    const json = { ...SAMPLE, cards: { ...SAMPLE.cards, mainboard: [...SAMPLE.cards.mainboard, SAMPLE.cards.mainboard[0]] } };
    const cube = await readCubeCobra(json);
    expect(cube.mainboard).toHaveLength(5);
    expect(cube.duplicates).toBe(1);
  });
  it("keeps the cube's own CubeCobra tags on the cards", async () => {
    const cube = await readCubeCobra(SAMPLE);
    expect(byName(cube.cards, "Abandoned Campground").ccTags).toEqual(["DSK"]);
    expect(cube.tags).toEqual(expect.arrayContaining(["DSK", "TLA", "MKM", "WOE"]));
  });
  it("prefers the card data we already have, but keeps the cube's tags", async () => {
    const spiderId = SAMPLE.cards.mainboard[1].details.oracle_id;
    const known = { [spiderId]: { ...BY_ID.W1, id: spiderId, name: "Known Spider", wrAdj: 0.61 } };
    const cube = await readCubeCobra(SAMPLE, known);
    expect(cube.cards[spiderId]).toMatchObject({ name: "Known Spider", wrAdj: 0.61 });
  });
});

const CFG: Config = config({
  cube: { name: "Test cube", targetSize: 360, description: "A test." },
  archetypes: [{ id: "wu", name: "Azorius Flyers", colors: "WU", description: "Fly over.", mechanics: [
    { id: "fly", name: "Flyers", filter: parseFilter("kw:flying"), constraint: { kind: "min", min: 1 } },
    { id: "rem", name: "Removal", priority: "secondary", filter: parseFilter("otag:removal") },
  ] }],
  rules: [rule("size", { kind: "cube" }, "count() <= 360")],
});

describe("rules saved inside CubeCobra", () => {
  it("hides the rules in one markdown line that CubeCobra does not display", async () => {
    const line = await encodeRules(CFG, { hidden: true });
    expect(line).toMatch(/^\[cubewarden-v1\]: cw:[A-Za-z0-9_-]+$/);
  });
  it("restores the rules when the cube is imported, from the hidden line or a visible block", async () => {
    for (const hidden of [true, false]) {
      const text = await encodeRules(CFG, { hidden });
      const json = { ...SAMPLE, primerTabs: [{ title: "Primer", content: "Our cube.\n\n" + text }] };
      expect((await readCubeCobra(json)).config).toEqual(CFG);
    }
  });
  it("finds no rules in plain text, and explains a damaged block", async () => {
    expect(await decodeRules("just an about text")).toBeNull();
    await expect(decodeRules("[cubewarden-v1]: cw:AAAAbroken")).rejects.toThrow(/damaged/);
  });
});

describe("About text for CubeCobra", () => {
  const report = evaluate(CFG, ALL, BY_ID);
  it("describes the cube and its archetypes with their primary mechanics", async () => {
    const md = await aboutMarkdown(CFG, report);
    expect(md).toContain("# Test cube\n\nA test.");
    expect(md).toContain("### Azorius Flyers {W}{U}\n\nFly over.\n\n- Flyers\n");
    expect(md).not.toContain("- Removal");
  });
  it("can list current numbers with links to the cube on CubeCobra and to Scryfall", async () => {
    const md = await aboutMarkdown(CFG, report, { numbers: true, cubeId: "sample" });
    const line = md.split("\n").find((l) => l.startsWith("- Flyers"))!;
    expect(line).toMatch(/^- Flyers: 36 cards at 360 \(target ≥ 1\)/);
    expect(line).toContain(`[see on CubeCobra](https://cubecobra.com/cube/list/sample?f=tag%3A%22WU%20Flyers%22)`);
    expect(line).toContain("[Scryfall](https://scryfall.com/search?q=");
  });
  it("says it was made with cubewarden and ends with the hidden rules line", async () => {
    const md = await aboutMarkdown(CFG, report);
    expect(md).toContain("[cubewarden](https://github.com/sinsimon/cubewarden)");
    expect(md.trimEnd().split("\n").at(-1)).toMatch(/^\[cubewarden-v1\]: cw:/);
    expect(await aboutMarkdown(CFG, report, { saveRules: false })).not.toContain("cubewarden-v1");
  });
});

describe("changes back to CubeCobra", () => {
  it("lists what goes in and out", () => {
    const d = diff(["W1", "W2", "U1"], ["W1", "U1", "G1"]);
    expect(d).toEqual({ adds: ["G1"], removes: ["W2"] });
    expect(changelist(d, BY_ID)).toBe("Changes: 1 in, 1 out\n\nRemove:\n- W2\n\nAdd:\n+ G1 (FDN) 1");
  });
  it("writes the whole list as a CSV CubeCobra can import, with tags separated by semicolons", () => {
    const csv = exportCsv(["WU1", "G1"], BY_ID, { tags: { WU1: ["WU Flyers", "W Removal"] } }).split("\n");
    expect(csv[0]).toMatch(/^name,CMC,Type,Color,Set,Collector Number,Rarity,.*,tags,/);
    expect(csv[1]).toContain('"WU Flyers;W Removal"');
    expect(csv).toHaveLength(3);
  });
  it("links to the cube list filtered with CubeCobra's own syntax", () => {
    expect(cubeCobraListUrl("sample", 'tag:"UG Ramp"')).toBe("https://cubecobra.com/cube/list/sample?f=tag%3A%22UG%20Ramp%22");
  });
});
