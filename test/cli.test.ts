import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { parseFilter, type Project } from "../src/index.ts";
import { CARDS, card, config, rule } from "./fixtures/cards.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
  const cards = [...CARDS, card("W4", { name: "Dawn Skirmisher", colors: "W", wrDelta: 5 }),
    card("U3", { name: "Sky Spy", colors: "U", keywords: ["flying"], wrDelta: -1.2 })];
  const project: Project = {
    version: 1, original: ["W1", "W2", "W3", "U1"], current: ["W1", "W2", "W3", "U1"],
    config: config({
      archetypes: [{ id: "wu", name: "Azorius Flyers", colors: "WU", mechanics: [{ id: "fly", name: "Flyers", filter: parseFilter("kw:flying") }] }],
      rules: [rule("w-cre", { kind: "color", color: "W" }, "count(t:creature) >= 3", { name: "White creatures" })],
    }),
  };
  writeFileSync(join(dir, "cubewarden.json"), JSON.stringify(project));
  writeFileSync(join(dir, "cards.json"), JSON.stringify(cards));
  return dir;
}
const cli = async (dir: string, ...argv: string[]) => {
  let out = "";
  const code = await run(argv, { cwd: dir, write: (s) => (out += s) });
  return { code, out };
};

const SAMPLE = readFileSync(new URL("./fixtures/cubecobra-cube.json", import.meta.url), "utf8");
const fakeFetch = (async () => new Response(SAMPLE, { status: 200 })) as unknown as typeof fetch;

describe("cubewarden import", () => {
  it("starts a project from a CubeCobra cube", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
    let out = "";
    const code = await run(["import", "sample"], { cwd: dir, write: (s) => (out += s), fetch: fakeFetch });
    expect(code).toBe(0);
    expect(out).toMatch(/Imported "Sample cube": 5 cards/);
    expect(JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8")).current).toHaveLength(5);
  });
  it("refuses to overwrite an existing project unless asked with --force", async () => {
    const dir = setup();
    let out = "";
    expect(await run(["import", "sample"], { cwd: dir, write: (s) => (out += s), fetch: fakeFetch })).toBe(2);
    expect(out).toMatch(/already exists.*--force/);
    expect(JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8")).current).toHaveLength(4);
    expect(await run(["import", "sample", "--force"], { cwd: dir, write: () => {}, fetch: fakeFetch })).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8")).current).toHaveLength(5);
  });
});

describe("cubewarden CLI", () => {
  it("check: exits 1 when a primary rule is not met, and prints JSON for agents", async () => {
    const dir = setup();
    const r = await cli(dir, "check", "--json");
    expect(r.code).toBe(1);
    const json = JSON.parse(r.out);
    expect(json.ok).toBe(false);
    expect(json.failing[0]).toMatchObject({ id: "w-cre", status: "near", value: 2 });
  });
  it("check: prints a readable summary for people", async () => {
    const r = await cli(setup(), "check");
    expect(r.out).toMatch(/White · White creatures: 2 \(target ≥ 3\) near\s+count\(t:creature\) >= 3/);
  });
  it("try shows the effect of a swap without saving it; apply saves it", async () => {
    const dir = setup();
    const t = JSON.parse((await cli(dir, "try", "--add", "Dawn Skirmisher", "--json")).out);
    expect(t.changed[0]).toMatchObject({ id: "w-cre", after: { status: "ok" } });
    expect(JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8")).current).not.toContain("W4");
    expect((await cli(dir, "apply", "--add", "Dawn Skirmisher")).code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8")).current).toContain("W4");
    expect((await cli(dir, "check")).code).toBe(0);
    expect((await cli(dir, "changes")).out).toContain("+ Dawn Skirmisher");
  });
  it("maybeboard keeps candidates aside, lists them and drops them", async () => {
    const dir = setup();
    const file = () => JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8"));
    expect((await cli(dir, "maybeboard", "--add", "Dawn Skirmisher")).code).toBe(0);
    expect(file().maybeboard).toEqual(["W4"]);
    expect(file().current).not.toContain("W4");
    expect((await cli(dir, "maybeboard")).out).toContain("Dawn Skirmisher");
    expect(JSON.parse((await cli(dir, "maybeboard", "--json")).out)).toEqual(["W4"]);
    expect((await cli(dir, "maybeboard", "--remove", "Dawn Skirmisher")).code).toBe(0);
    expect(file().maybeboard).toEqual([]);
    expect((await cli(dir, "maybeboard", "--add", "W1")).code).toBe(2);
  });
  it("import keeps the cube's maybeboard", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
    expect(await run(["import", "sample"], { cwd: dir, write: () => {}, fetch: fakeFetch })).toBe(0);
    const p = JSON.parse(readFileSync(join(dir, "cubewarden.json"), "utf8"));
    expect(p.maybeboard).toHaveLength(1);
    expect(p.originalMaybeboard).toEqual(p.maybeboard);
  });
  it("rule set writes a rule from text; rules lists them as text", async () => {
    const dir = setup();
    expect((await cli(dir, "rule", "set", "u-cre", "--scope", "color:U", "--name", "Blue creatures", "--text", "count(t:creature) >= 1")).code).toBe(0);
    expect((await cli(dir, "rules")).out).toContain("u-cre  color:U  primary  Blue creatures: count(t:creature) >= 1");
  });
  it("check and explain print each bucket of a curve rule", async () => {
    const dir = setup();
    expect((await cli(dir, "rule", "set", "w-curve", "--scope", "color:W", "--text", "curve(t:creature) 2:2..3 3:1 4+:10%..20%")).code).toBe(0);
    const r = await cli(dir, "check");
    expect(r.out).toContain("MV2 1 (target 2–3) near");
    expect(r.out).toContain("MV4+ 0% (target 10%–20%) fail");
    expect((await cli(dir, "explain", "w-curve")).out).toContain("MV3 1 (target = 1) ok");
    expect((await cli(dir, "rule", "set", "w-range", "--scope", "color:W", "--text", "curve() 1-3:2..4 4+:0")).code).toBe(0);
    expect((await cli(dir, "explain", "w-range")).out).toContain("MV1–3 3 (target 2–4) ok");
  });
  it("explain and search answer in JSON", async () => {
    const dir = setup();
    expect(JSON.parse((await cli(dir, "explain", "fly", "--json")).out).cards.map((c: { id: string }) => c.id)).toEqual(["W2"]);
    expect(JSON.parse((await cli(dir, "search", "c=w t:creature", "--json")).out).cards.map((c: { name: string }) => c.name)).toEqual(["Dawn Skirmisher"]);
  });
  it("search prints each card's WR Δ in signed points", async () => {
    const dir = setup();
    const r = await cli(dir, "search", "t:creature", "--sort", "wr", "--all-cards");
    expect(r.out).toContain("Dawn Skirmisher (W, mv 2, WR Δ +5.0)");
    expect(r.out).toContain("Sky Spy (U, mv 2, WR Δ −1.2)");
  });
  it("search reads member: in the colour or archetype given with --scope", async () => {
    const dir = setup();
    expect((await cli(dir, "search", "member:fly", "--scope", "wu", "--all-cards")).out).toContain("Sky Spy");
    const r = await cli(dir, "search", "member:fly", "--all-cards");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/member:.*--scope/);
  });
  it("exits 2 with a readable message on bad input", async () => {
    const dir = setup();
    const r = await cli(dir, "search", "foo:bar");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Unknown filter "foo"/);
    expect((await cli(dir, "nonsense")).out).toMatch(/Unknown command "nonsense"/);
  });
  it("prints help listing every command", async () => {
    const r = await cli(setup(), "help");
    for (const c of ["check", "explain", "search", "try", "apply", "rules", "rule set", "changes", "about", "export", "import", "syntax", "serve", "mechanic set", "maybeboard [--add"]) expect(r.out).toContain(c);
  });
});
