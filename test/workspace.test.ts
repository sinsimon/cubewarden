import { describe, expect, it } from "vitest";
import { createWorkspace, parseFilter, type Project } from "../src/index.ts";
import { BY_ID, CARDS, card, config, rule } from "./fixtures/cards.ts";

// The cube holds W1 W2 W3 U1 WU1 L1; the rest of CARDS plus two extra white cards are outside it.
const OUTSIDE = [
  card("W4", { name: "Dawn Skirmisher", colors: "W", mv: 2, wrAdj: 0.61, printSets: ["fdn"] }),
  card("W5", { name: "Old White Flyer", colors: "W", mv: 3, keywords: ["flying"], wrAdj: 0.63, printSets: ["m10"], set: "m10" }),
];
const cardsById = { ...BY_ID, ...Object.fromEntries(OUTSIDE.map((c) => [c.id, c])) };
const IN = ["W1", "W2", "W3", "U1", "WU1", "L1"];

function project(): Project {
  return {
    version: 1,
    original: [...IN],
    current: [...IN],
    config: config({
      archetypes: [{ id: "wu", name: "Azorius Flyers", colors: "WU", mechanics: [{ id: "fly", name: "Flyers", filter: parseFilter("kw:flying"), constraint: { kind: "min", min: 2 } }] }],
      rules: [
        rule("size", { kind: "cube" }, "count() <= 6"),
        rule("sets", { kind: "cube" }, "every(s:fdn,trk)"),
        rule("w-cre", { kind: "color", color: "W" }, "count(t:creature) >= 3", { name: "White creatures" }),
        rule("wr", { kind: "cube" }, "avg(wr) >= 70%", { priority: "secondary", name: "High WR" }),
      ],
    }),
  };
}
const ws = () => createWorkspace(project(), cardsById);

describe("check", () => {
  it("passes only when every primary rule and mechanic is met, and lists misses and warnings in plain words", () => {
    const r = ws().check();
    expect(r.ok).toBe(false);
    expect(r.size).toBe(6);
    expect(r.failing.map((f) => f.id).sort()).toEqual(["fly", "w-cre"]);
    expect(r.failing.find((f) => f.id === "w-cre")).toMatchObject({
      scope: "White", name: "White creatures", status: "near", value: 2, target: "≥ 3", rule: "count(t:creature) >= 3",
    });
    expect(r.warnings.map((f) => f.id)).toEqual(["wr"]);
  });
});

describe("explain", () => {
  it("shows a rule's value and the cards behind it", () => {
    const e = ws().explain("w-cre");
    expect(e).toMatchObject({ id: "w-cre", scope: "White", value: 2, status: "near", rule: "count(t:creature) >= 3" });
    expect(e.cards.map((c) => c.name).sort()).toEqual(["W1", "W2"]);
  });
  it("finds archetype mechanics too, and names the known ids when one is unknown", () => {
    expect(ws().explain("fly")).toMatchObject({ scope: "Azorius Flyers", value: 1 });
    expect(() => ws().explain("nope")).toThrowError(/Unknown rule "nope".*size.*fly/);
  });
});

describe("search", () => {
  it("finds cards outside the cube that match a filter and that the cube's 'every card' rules allow", () => {
    const names = ws().search("c=w").cards.map((c) => c.name);
    expect(names).toEqual(["Dawn Skirmisher"]);
    expect(ws().search("c=w", { respectCubeRules: false, sort: "wr" }).cards.map((c) => c.name)).toEqual(["Old White Flyer", "Dawn Skirmisher"]);
  });
  it("applies any 'every card' rule of the cube, letting through cards with no data for its metric", () => {
    const w = ws();
    w.setRule({ id: "sets", text: "every(r:common,uncommon)" });
    w.setRule({ id: "wr-floor", name: "WR floor", scope: "cube", text: "every(wr) >= 60%" });
    const pool = { ...cardsById, R1: card("R1", { name: "Rare White", colors: "W", rarity: "rare", wrAdj: 0.7 }), N1: card("N1", { name: "No Data White", colors: "W" }) };
    const names = createWorkspace(w.project, pool).search("c=w", { sort: "name" }).cards.map((c) => c.name);
    expect(names).toEqual(["Dawn Skirmisher", "No Data White", "Old White Flyer"]);
  });
  it("sorts by CubeCobra popularity by default, or by any metric", () => {
    const pool = { ...cardsById, P1: card("P1", { name: "Popular", colors: "W", ccCubes: 900, wrAdj: 0.5 }), P2: card("P2", { name: "Niche", colors: "W", ccCubes: 10, wrAdj: 0.65 }) };
    const w = createWorkspace(project(), pool);
    expect(w.search("c=w").cards.map((c) => c.name)).toEqual(["Popular", "Niche", "Dawn Skirmisher"]);
    expect(w.search("c=w", { sort: "wr" }).cards.map((c) => c.name)).toEqual(["Niche", "Dawn Skirmisher", "Popular"]);
  });
  it("limits the search to a colour or archetype", () => {
    const names = ws().search("t:creature", { scope: "wu" }).cards.map((c) => c.id).sort();
    expect(names).toEqual(["U2", "W4", "WU2"].filter((id) => cardsById[id].type.includes("Creature")));
  });
  it("explains a filter it cannot read", () => {
    expect(() => ws().search("foo:bar")).toThrowError(/Unknown filter "foo"/);
  });
});

describe("trying and applying changes", () => {
  it("shows which rules change before touching the cube", () => {
    const w = ws();
    const t = w.tryChanges({ add: ["Dawn Skirmisher"], remove: ["U1"] });
    expect(t.size).toEqual({ before: 6, after: 6 });
    expect(t.changed.find((x) => x.id === "w-cre")).toMatchObject({ before: { value: 2, status: "near" }, after: { value: 3, status: "ok" } });
    expect(w.project.current).toEqual(IN);
  });
  it("applies changes, tracks them against the original list and writes the changelist", () => {
    const w = ws();
    w.applyChanges({ add: ["dawn skirmisher"], remove: ["W1"] });
    expect(w.project.current).toContain("W4");
    expect(w.project.current).not.toContain("W1");
    expect(w.changes().text).toBe("Changes: 1 in, 1 out\n\nRemove:\n- W1\n\nAdd:\n+ Dawn Skirmisher (FDN) 1");
  });
  it("refuses unknown names with suggestions, and cards already in or not in the cube", () => {
    expect(() => ws().tryChanges({ add: ["Dawn Skirmishr"] })).toThrowError(/No card named "Dawn Skirmishr".*Dawn Skirmisher/);
    expect(() => ws().tryChanges({ add: ["W1"] })).toThrowError(/already in the cube/);
    expect(() => ws().tryChanges({ remove: ["W4"] })).toThrowError(/not in the cube/);
  });
});

describe("rules as text", () => {
  it("lists every rule with its scope and text", () => {
    expect(ws().rules().find((r) => r.id === "w-cre")).toEqual({
      id: "w-cre", name: "White creatures", scope: "color:W", priority: "primary", text: "count(t:creature) >= 3",
    });
  });
  it("adds, changes and removes rules written as text", () => {
    const w = ws();
    w.setRule({ id: "u-cre", name: "Blue creatures", scope: "color:U", text: "count(t:creature) >= 1" });
    expect(w.explain("u-cre")).toMatchObject({ value: 1, status: "ok" });
    w.setRule({ id: "u-cre", text: "count(t:creature) >= 2 " });
    expect(w.explain("u-cre")).toMatchObject({ status: "near", name: "Blue creatures" });
    w.setRule({ id: "every-arch", name: "Gold", scope: "allArchetypes", text: "count(c=scope) = 1 fixed" });
    expect(w.explain("every-arch").scope).toBe("each archetype");
    w.removeRule("u-cre");
    expect(w.rules().some((r) => r.id === "u-cre")).toBe(false);
  });
  it("rejects a rule it cannot read without changing anything", () => {
    const w = ws();
    expect(() => w.setRule({ id: "x", name: "x", scope: "cube", text: "count(foo:bar)" })).toThrowError(/Unknown filter/);
    expect(() => w.setRule({ id: "x", name: "x", scope: "colour:Q", text: "count()" })).toThrowError(/scope/);
    expect(w.rules().some((r) => r.id === "x")).toBe(false);
  });
});

describe("listeners", () => {
  it("tells listeners when the project changes, so the page can redraw", () => {
    const w = ws();
    let calls = 0;
    w.onChange(() => calls++);
    w.applyChanges({ remove: ["W1"] });
    w.setRule({ id: "size", text: "count() <= 5" });
    expect(calls).toBe(2);
  });
});

void CARDS;
