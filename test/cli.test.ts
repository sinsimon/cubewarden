import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.ts";
import { parseFilter, type Project } from "../src/index.ts";
import { CARDS, card, config, rule } from "./fixtures/cards.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "cubewarden-"));
  const cards = [...CARDS, card("W4", { name: "Dawn Skirmisher", colors: "W", wrAdj: 0.61 })];
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
  it("rule set writes a rule from text; rules lists them as text", async () => {
    const dir = setup();
    expect((await cli(dir, "rule", "set", "u-cre", "--scope", "color:U", "--name", "Blue creatures", "--text", "count(t:creature) >= 1")).code).toBe(0);
    expect((await cli(dir, "rules")).out).toContain("u-cre  color:U  primary  Blue creatures: count(t:creature) >= 1");
  });
  it("explain and search answer in JSON", async () => {
    const dir = setup();
    expect(JSON.parse((await cli(dir, "explain", "fly", "--json")).out).cards.map((c: { id: string }) => c.id)).toEqual(["W2"]);
    expect(JSON.parse((await cli(dir, "search", "c=w t:creature", "--json")).out).cards.map((c: { name: string }) => c.name)).toEqual(["Dawn Skirmisher"]);
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
    for (const c of ["check", "explain", "search", "try", "apply", "rules", "rule set", "changes", "about", "export", "import", "syntax", "serve"]) expect(r.out).toContain(c);
  });
});
