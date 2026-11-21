import { describe, expect, it } from "vitest";
import { createWorkspace, parseFilter, type Project } from "../src/index.ts";
import { BY_ID, CARDS, card, config, rule } from "./fixtures/cards.ts";

// The cube holds W1 W2 W3 U1 WU1 L1; the rest of CARDS plus two extra white cards are outside it.
const OUTSIDE = [
  card("W4", { name: "Dawn Skirmisher", colors: "W", mv: 2, wrDelta: 5, printSets: ["fdn"] }),
  card("W5", { name: "Old White Flyer", colors: "W", mv: 3, keywords: ["flying"], wrDelta: 7, printSets: ["m10"], set: "m10" }),
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
        rule("wr", { kind: "cube" }, "avg(wr) >= 8", { priority: "secondary", name: "High WR" }),
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

describe("curve rules", () => {
  // White creatures in the cube: W1 (mv 2), W2 (mv 3).
  const curve = () => {
    const w = ws();
    w.setRule({ id: "w-curve", name: "White curve", scope: "color:W", text: "curve(t:creature) 2:2..3 3:1 4+:10%..20%" });
    return w;
  };
  it("check lists a curve with each bucket, its value, target and status", () => {
    const f = curve().check().failing.find((x) => x.id === "w-curve");
    expect(f).toMatchObject({ status: "fail", value: 2, target: "MV2 2–3 · MV3 = 1 · MV4+ 10%–20%", rule: "curve(t:creature) 2:2..3 3:1 4+:10%..20%" });
    expect(f?.buckets).toEqual([
      { label: "2", value: 1, target: "2–3", status: "near" },
      { label: "3", value: 1, target: "= 1", status: "ok" },
      { label: "4+", value: 0, target: "10%–20%", status: "fail" },
    ]);
  });
  it("explain lists the counted cards with their mana value", () => {
    const e = curve().explain("w-curve");
    expect(e.cards.map((c) => [c.name, c.value]).sort()).toEqual([["W1", 2], ["W2", 3]]);
    expect(e.buckets?.map((b) => b.label)).toEqual(["2", "3", "4+"]);
  });
  it("labels a range bucket 1–3 in the target and in the buckets", () => {
    const w = ws();
    w.setRule({ id: "w-range", name: "White range", scope: "color:W", text: "curve(t:creature) 1-3:2..4 4+:0" });
    const e = w.explain("w-range");
    expect(e.target).toBe("MV1–3 2–4 · MV4+ = 0");
    expect(e.buckets).toEqual([
      { label: "1–3", value: 2, target: "2–4", status: "ok" },
      { label: "4+", value: 0, target: "= 0", status: "ok" },
    ]);
  });
  it("cannot turn a mechanic into a curve", () => {
    expect(() => ws().setMechanic({ id: "fly", text: "curve(kw:flying) 2:1" })).toThrowError(/counts cards/);
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
    w.setRule({ id: "wr-floor", name: "WR floor", scope: "cube", text: "every(wr) >= 4" });
    const pool = { ...cardsById, R1: card("R1", { name: "Rare White", colors: "W", rarity: "rare", wrDelta: 10 }), N1: card("N1", { name: "No Data White", colors: "W" }) };
    const names = createWorkspace(w.project, pool).search("c=w", { sort: "name" }).cards.map((c) => c.name);
    expect(names).toEqual(["Dawn Skirmisher", "No Data White", "Old White Flyer"]);
  });
  it("sorts by CubeCobra popularity by default, or by any metric", () => {
    const pool = { ...cardsById, P1: card("P1", { name: "Popular", colors: "W", ccCubes: 900, wrDelta: -5 }), P2: card("P2", { name: "Niche", colors: "W", ccCubes: 10, wrDelta: 9 }) };
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
  it("returns each card's WR Δ in points", () => {
    expect(ws().search("c=w").cards[0]).toMatchObject({ name: "Dawn Skirmisher", wrDelta: 5 });
  });
});

describe("search with member:", () => {
  // Outside the cube in WU: U2 (mv 2), WU2 (mv 2, hybrid), C1 (mv 2), W4 (mv 2), W5 (mv 3, flying).
  function memberProject(): Project {
    const p = project();
    p.config.archetypes = [{ id: "wu", name: "Azorius Flyers", colors: "WU", mechanics: [
      { id: "fly", name: "Flyers", filter: parseFilter("kw:flying") },
      { id: "cheap", name: "Cheap", priority: "secondary", filter: parseFilter("mv<=2 -c:c") },
      { id: "gold", name: "Gold", priority: "secondary", filter: parseFilter("c=scope") },
    ] }];
    p.config.colors.find((c) => c.code === "W")!.mechanics = [{ id: "w-fly", name: "White flyers", filter: parseFilter("kw:flying") }];
    return p;
  }
  const find = (filter: string, scope?: string) =>
    createWorkspace(memberProject(), cardsById).search(filter, { scope, respectCubeRules: false, sort: "name" }).cards.map((c) => c.id);
  it("matches the cards of one mechanic of the archetype given as scope", () => {
    expect(find("member:fly", "wu")).toEqual(["W5"]);
    expect(find("member:gold", "archetype:wu")).toEqual(["WU2"]);
  });
  it("matches any, primary or secondary mechanics, as in the archetype's rules", () => {
    expect(find("member:primary", "wu")).toEqual(["W5"]);
    expect(find("member:secondary", "wu")).toEqual(["W4", "U2", "WU2"]);
    expect(find("member:any", "wu")).toEqual(["W4", "W5", "U2", "WU2"]);
    expect(find("member:nope", "wu")).toEqual([]);
    expect(find("t:creature -member:any", "wu")).toEqual([]);
  });
  it("matches the mechanics of a colour given as scope", () => {
    expect(find("member:w-fly", "W")).toEqual(["W5"]);
    expect(find("member:any", "color:W")).toEqual(["W5"]);
  });
  it("asks for a colour or an archetype when there is no scope", () => {
    expect(() => find("member:any")).toThrowError(/member:.*scope.*colour or an archetype/);
    expect(() => find("member:any", "cube")).toThrowError(/member:.*scope.*colour or an archetype/);
  });
});

describe("rules saved with the old adjusted WR", () => {
  it("check, rules and explain still answer, and the rule reads as an error to rewrite", () => {
    const p = project();
    p.config.rules.push({ id: "old", name: "Old WR", scope: { kind: "cube" }, measure: { kind: "avg", metric: "wrAdj" as never }, constraint: { kind: "min", min: 0.55 } });
    const w = createWorkspace(p, cardsById);
    expect(w.check().failing.find((f) => f.id === "old")).toMatchObject({ status: "error", target: "≥ 0.55" });
    expect(w.rules().find((r) => r.id === "old")?.text).toBe("avg(wrAdj) >= 0.55");
    expect(w.explain("old").error).toMatch(/wrAdj/);
  });
});

describe("WR Δ targets", () => {
  it("reads targets in signed points", () => {
    const w = ws();
    w.setRule({ id: "wr-band", name: "WR band", scope: "cube", text: "avg(wr) in -1..3" });
    w.setRule({ id: "wr", text: "avg(wr) >= 8" });
    expect(w.explain("wr-band").target).toBe("−1.0 to +3.0");
    expect(w.explain("wr").target).toBe("≥ +8.0");
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

describe("maybeboard", () => {
  it("moves removed cards to the maybeboard and keeps candidates there", () => {
    const w = ws();
    w.applyChanges({ add: ["Dawn Skirmisher"], remove: ["U1"], toMaybeboard: true });
    w.maybeboard({ add: ["Old White Flyer"] });
    expect(w.project.maybeboard).toEqual(["U1", "W5"]);
    expect(w.project.current).not.toContain("U1");
  });
  it("takes a card out of the maybeboard when it goes back into the cube", () => {
    const w = ws();
    w.maybeboard({ add: ["Dawn Skirmisher"] });
    w.applyChanges({ add: ["Dawn Skirmisher"] });
    expect(w.project.maybeboard).toEqual([]);
  });
  it("lists the maybeboard changes in the changelist", () => {
    const w = ws();
    w.applyChanges({ remove: ["U1"], toMaybeboard: true });
    expect(w.changes().text).toBe("Changes: 0 in, 1 out\n\nRemove:\n- U1\n\nMaybeboard:\n+ U1 (FDN) 1");
  });
  it("refuses a card already in the cube", () => {
    expect(() => ws().maybeboard({ add: ["W1"] })).toThrowError(/in the cube/);
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

describe("mechanics as text", () => {
  it("lists the mechanics of colours and archetypes with their text", () => {
    expect(ws().mechanics()).toContainEqual({ id: "fly", name: "Flyers", scope: "archetype:wu", priority: "primary", text: "count(kw:flying) >= 2" });
  });
  it("adds, changes and removes a mechanic in a colour or an archetype", () => {
    const w = ws();
    w.setMechanic({ id: "w-rem", name: "Removal", scope: "color:W", text: "otag:removal >= 1" });
    expect(w.explain("w-rem")).toMatchObject({ kind: "mechanic", scope: "White", value: 1, status: "ok" });
    w.setMechanic({ id: "fly", text: "kw:flying >= 1", priority: "secondary" });
    expect(w.mechanics().find((m) => m.id === "fly")).toMatchObject({ name: "Flyers", priority: "secondary", text: "count(kw:flying) >= 1" });
    w.removeMechanic("w-rem");
    expect(w.mechanics().some((m) => m.id === "w-rem")).toBe(false);
  });
  it("needs a colour or archetype scope for a new mechanic", () => {
    expect(() => ws().setMechanic({ id: "x", name: "x", scope: "cube", text: "otag:removal" })).toThrowError(/colour or an archetype/);
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
