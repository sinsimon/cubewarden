import { describe, expect, it } from "vitest";
import { evaluate, parseFilter, validateFilter } from "../src/index.ts";
import { ALL, BY_ID, config, rule } from "./fixtures/cards.ts";

const cube = { kind: "cube" } as const;
const cubeRule = (text: string, over = {}) => {
  const r = evaluate(config({ rules: [rule("r", cube, text, over)] }), ALL, BY_ID);
  return r.cube.rules[0];
};

describe("whole-cube rules", () => {
  it("counts the cube and grades the result: ok inside, near within one card, fail beyond", () => {
    expect(cubeRule("count() <= 10")).toMatchObject({ value: 10, status: "ok" });
    expect(cubeRule("count() <= 9")).toMatchObject({ value: 10, status: "near", gap: 1 });
    expect(cubeRule("count() <= 8")).toMatchObject({ value: 10, status: "fail", gap: 2 });
    expect(cubeRule("count() = 12")).toMatchObject({ status: "fail", gap: -2 });
  });
  it("counts the cards matching a filter and lists them", () => {
    const r = cubeRule("count(t:creature) >= 1");
    expect(r.value).toBe(6);
    expect(r.cards.sort()).toEqual(["G1", "U1", "W1", "W2", "WU1", "WU2"]);
  });
  it("averages a metric over the cards that have it, and counts the ones without data", () => {
    const r = cubeRule("avg(wr) in 54%..62%");
    expect(r.value).toBeCloseTo(0.57125, 5);
    expect(r.n).toBe(8);
    expect(r.noData).toBe(2);
    expect(r.status).toBe("ok");
  });
  it("is 'near' when an average misses by at most one win-rate point", () => {
    expect(cubeRule("avg(wr) >= 58%").status).toBe("near");
    expect(cubeRule("avg(wr) >= 59%").status).toBe("fail");
  });
  it("has no status when there is no target", () => {
    expect(cubeRule("count(t:creature)").status).toBe("none");
  });
  it("lists the cards that break an 'every card' rule", () => {
    const r = cubeRule("every(s:fdn)");
    expect(r).toMatchObject({ value: 1, cards: ["W3"], status: "near" });
    const mv = cubeRule("every(mv, t:creature) <= 2");
    expect(mv.cards.sort()).toEqual(["G1", "W2", "WU1"]);
    expect(mv.status).toBe("fail");
  });
  it("uses any printing of a card for set conditions", () => {
    const r = evaluate(config({ rules: [rule("r", cube, "every(s:fdn)")] }), ["W3"], {
      W3: { ...BY_ID.W3, printSets: ["trk", "fdn"] },
    });
    expect(r.cube.rules[0].status).toBe("ok");
  });
  it("reports a rule that cannot run here as an error instead of a number", () => {
    const r = cubeRule("count(member:any) >= 1");
    expect(r.status).toBe("error");
    expect(r.error).toMatch(/inside an archetype/);
  });
});

describe("colour scopes", () => {
  it("puts mono-coloured nonland cards in their colour, colourless nonland cards in C and lands in L", () => {
    const r = evaluate(config(), ALL, BY_ID);
    expect(r.colors.W.cards.sort()).toEqual(["W1", "W2", "W3"]);
    expect(r.colors.U.cards.sort()).toEqual(["U1", "U2"]);
    expect(r.colors.C.cards).toEqual(["C1"]);
    expect(r.colors.L.cards).toEqual(["L1"]);
    expect(r.colors.B.cards).toEqual([]);
  });
  it("evaluates a colour's own rules and its mechanics", () => {
    const cfg = config({ rules: [rule("wc", { kind: "color", color: "W" }, "count(t:creature) = 2")] });
    cfg.colors[0].mechanics = [{ id: "rem", name: "Removal", filter: parseFilter("otag:removal"), constraint: { kind: "min", min: 2 } }];
    const w = evaluate(cfg, ALL, BY_ID).colors.W;
    expect(w.rules[0]).toMatchObject({ value: 2, status: "ok" });
    expect(w.mechanics[0]).toMatchObject({ kind: "mechanic", value: 1, cards: ["W3"], status: "near" });
    expect(w.status).toEqual({ primary: "near", all: "near" });
  });
  it("applies an 'all colours' rule to W U B R G but not to colourless or lands", () => {
    const cfg = config({ rules: [rule("cre", { kind: "allColors" }, "count(t:creature) >= 1")] });
    const r = evaluate(cfg, ALL, BY_ID);
    expect(r.colors.W.rules[0]).toMatchObject({ inherited: true, from: "allColors", value: 2, status: "ok" });
    expect(r.colors.B.rules[0]).toMatchObject({ value: 0, status: "near" });
    expect(r.colors.C.rules).toEqual([]);
    expect(r.colors.L.rules).toEqual([]);
    expect(r.allColors.rules[0].counts).toEqual({ ok: 3, near: 2, fail: 0, error: 0 });
    expect(Object.keys(r.allColors.rules[0].byScope).sort()).toEqual(["B", "G", "R", "U", "W"]);
  });
});

const WU = { id: "wu", name: "Azorius Flyers", colors: "WU", mechanics: [
  { id: "fly", name: "Flyers", filter: parseFilter("kw:flying") },
  { id: "rem", name: "Removal", filter: parseFilter("otag:removal") },
] };

describe("archetypes", () => {
  it("draws from nonland cards in the archetype's colours plus colourless ones, and counts as members the cards matching a mechanic", () => {
    const a = evaluate(config({ archetypes: [WU] }), ALL, BY_ID).archetypes.wu;
    expect(a.cards.sort()).toEqual(["C1", "U1", "U2", "W1", "W2", "W3", "WU1", "WU2"]);
    expect(a.members.sort()).toEqual(["W2", "W3"]);
  });
  it("reads 'c=scope' as the archetype's colours, so gold and hybrid slots can be one shared rule", () => {
    const cfg = config({ archetypes: [WU], rules: [
      rule("gold", { kind: "allArchetypes" }, "count(c=scope -is:hybrid) = 1 fixed"),
      rule("hyb", { kind: "allArchetypes" }, "count(c=scope is:hybrid) = 1 fixed"),
    ] });
    const a = evaluate(cfg, ALL, BY_ID).archetypes.wu;
    expect(a.rules.map((x) => [x.id, x.cards])).toEqual([["gold", ["WU1"]], ["hyb", ["WU2"]]]);
  });
  it("averages a metric over the archetype's members", () => {
    const cfg = config({ archetypes: [WU], rules: [rule("wr", { kind: "archetype", id: "wu" }, "avg(wr, member:any) >= 55%")] });
    expect(evaluate(cfg, ALL, BY_ID).archetypes.wu.rules[0].value).toBeCloseTo(0.575, 5);
  });
  it("counts members of the primary mechanics apart from the secondary ones", () => {
    const arch = { ...WU, mechanics: [WU.mechanics[0], { ...WU.mechanics[1], priority: "secondary" as const }] };
    const cfg = config({ archetypes: [arch], rules: [
      rule("p", { kind: "archetype", id: "wu" }, "count(member:primary)"),
      rule("s", { kind: "archetype", id: "wu" }, "count(member:secondary)"),
    ] });
    const r = evaluate(cfg, ALL, BY_ID).archetypes.wu.rules;
    expect(r.map((x) => [x.id, x.cards])).toEqual([["p", ["W2"]], ["s", ["W3"]]]);
  });
  it("leaves unnamed archetypes out of the 'all archetypes' summary", () => {
    const cfg = config({ archetypes: [WU, { id: "ug", name: "", colors: "UG", mechanics: [] }],
      rules: [rule("any", { kind: "allArchetypes" }, "count() >= 1")] });
    expect(Object.keys(evaluate(cfg, ALL, BY_ID).allArchetypes.rules[0].byScope)).toEqual(["wu"]);
  });
});

describe("primary and secondary rules", () => {
  it("lets a failing secondary rule warn without failing the scope", () => {
    const cfg = config({ rules: [
      rule("a", cube, "count() <= 10"),
      rule("b", cube, "count() <= 5", { priority: "secondary" }),
    ] });
    expect(evaluate(cfg, ALL, BY_ID).cube.status).toEqual({ primary: "ok", all: "fail" });
  });
});

describe("scaling to a target cube size", () => {
  const W = { kind: "color", color: "W" } as const;
  const cfg = (text: string) => config({ cube: { name: "t", targetSize: 5 }, rules: [rule("r", W, text)] });
  it("scales colour and archetype counts by target size / cube size", () => {
    const r = evaluate(cfg("count(t:creature) = 1"), ALL, BY_ID);
    expect(r.factor).toBe(0.5);
    expect(r.colors.W.rules[0]).toMatchObject({ raw: 2, value: 1, status: "ok" });
  });
  it("never scales fixed counts, shares in percent or whole-cube counts", () => {
    expect(evaluate(cfg("count(t:creature) = 2 fixed"), ALL, BY_ID).colors.W.rules[0].value).toBe(2);
    expect(evaluate(cfg("count(t:creature) >= 50%"), ALL, BY_ID).colors.W.rules[0].value).toBe(66.7);
    const c = config({ cube: { name: "t", targetSize: 5 }, rules: [rule("r", cube, "count() <= 10")] });
    expect(evaluate(c, ALL, BY_ID).cube.rules[0].value).toBe(10);
  });
  it("can be turned off, and does nothing without a target size", () => {
    expect(evaluate(cfg("count(t:creature) = 2"), ALL, BY_ID, { scale: false }).colors.W.rules[0].value).toBe(2);
    expect(evaluate(config(), ALL, BY_ID).factor).toBe(1);
  });
});

describe("checking a filter built in the editor", () => {
  it("names unknown fields, wrong operators and Scryfall terms the engine cannot run", () => {
    expect(validateFilter(parseFilter("otag:removal mv>=2"))).toEqual([]);
    expect(validateFilter({ op: "and", items: [{ field: "tag", op: ">=", value: "x" }] })).toEqual(['Operator ">=" not valid for Oracle tag']);
    expect(validateFilter({ op: "and", items: [{ field: "scryfall", op: "matches", value: "is:commander" }] })[0]).toMatch(/not supported/);
  });
});
