import { describe, expect, it } from "vitest";
import { evaluate, formatConstraint, parseFilter, ruleToText, validateFilter, type Rule } from "../src/index.ts";
import { ALL, BY_ID, card, config, rule } from "./fixtures/cards.ts";

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
    const r = cubeRule("avg(wr) in -1..2");
    expect(r.value).toBeCloseTo(0.625, 5);
    expect(r.n).toBe(8);
    expect(r.noData).toBe(2);
    expect(r.status).toBe("ok");
  });
  it("is 'near' when an average misses by at most one win-rate point", () => {
    expect(cubeRule("avg(wr) >= 1.5").status).toBe("near");
    expect(cubeRule("avg(wr) >= 2").status).toBe("fail");
    expect(cubeRule("avg(wrraw) >= 58%").status).toBe("nodata");
  });
  it("reports a rule saved with the old adjusted WR (wrAdj) as an error that says how to rewrite it", () => {
    const legacy = { id: "old", name: "Old WR", scope: cube, measure: { kind: "avg", metric: "wrAdj" }, constraint: { kind: "min", min: 0.55 } } as unknown as Rule;
    const oldFilter = { id: "old2", name: "Old filter", scope: cube, measure: { kind: "count" }, filter: { op: "and", items: [{ field: "wrAdj", op: ">=", value: 0.55 }] } } as unknown as Rule;
    const r = evaluate(config({ rules: [legacy, oldFilter] }), ALL, BY_ID).cube.rules;
    expect(r.map((x) => x.status)).toEqual(["error", "error"]);
    for (const x of r) expect(x.error).toMatch(/wrAdj.*wr.*WR Δ/);
    expect(formatConstraint(legacy.constraint, (legacy.measure as unknown as { metric: never }).metric)).toBe("≥ 0.55");
    expect(ruleToText(legacy)).toBe("avg(wrAdj) >= 0.55");
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
    expect(r.error).toMatch(/inside a colour or an archetype/);
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
  it("reads member: in a colour as the cards matching that colour's mechanics: by id, any, primary or secondary", () => {
    const W = { kind: "color", color: "W" } as const;
    const cfg = config({ rules: ["rem", "any", "primary", "secondary", "nope"].map((v) => rule(v, W, `count(member:${v})`)) });
    cfg.colors[0].mechanics = [
      { id: "rem", name: "Removal", filter: parseFilter("otag:removal") },
      { id: "fly", name: "Flyers", filter: parseFilter("kw:flying"), priority: "secondary" },
    ];
    const w = evaluate(cfg, ALL, BY_ID).colors.W.rules;
    expect(w.map((x) => [x.id, x.cards.sort()])).toEqual([
      ["rem", ["W3"]], ["any", ["W2", "W3"]], ["primary", ["W3"]], ["secondary", ["W2"]], ["nope", []],
    ]);
  });
  it("resolves member:<id> in an 'all colours' rule against each colour's own mechanics", () => {
    const cfg = config({ rules: [rule("rem", { kind: "allColors" }, "count(member:rem) >= 1")] });
    cfg.colors[0].mechanics = [{ id: "rem", name: "Removal", filter: parseFilter("otag:removal") }];
    cfg.colors[1].mechanics = [{ id: "rem", name: "Counters", filter: parseFilter("otag:counterspell") }];
    const r = evaluate(cfg, ALL, BY_ID);
    expect(r.colors.W.rules[0]).toMatchObject({ cards: ["W3"], status: "ok" });
    expect(r.colors.U.rules[0]).toMatchObject({ cards: ["U2"], status: "ok" });
    expect(r.colors.B.rules[0]).toMatchObject({ value: 0, status: "near" });
    expect(r.allColors.rules[0].counts).toEqual({ ok: 2, near: 3, fail: 0, error: 0 });
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
    const cfg = config({ archetypes: [WU], rules: [rule("wr", { kind: "archetype", id: "wu" }, "avg(wr, member:any) >= 0.5")] });
    expect(evaluate(cfg, ALL, BY_ID).archetypes.wu.rules[0].value).toBeCloseTo(1, 5);
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

describe("curve rules", () => {
  // Creatures by mana value: 2 = W1 U1 WU2, 3 = W2 WU1, 4 = G1. Every card: 0 = L1, 1 = W3, 2 = W1 U1 U2 WU2 C1, 3 = W2 WU1, 4 = G1.
  const buckets = (r: { buckets?: { label: string; value: number | null; status: string }[] }) => r.buckets?.map((b) => [b.label, b.value, b.status]);
  it("counts the filtered cards by mana value and checks each bucket, N+ taking N and above", () => {
    const r = cubeRule("curve(t:creature) 2:3 3:1..2 4+:0..1");
    expect(r).toMatchObject({ status: "ok", value: 0 });
    expect(buckets(r)).toEqual([["2", 3, "ok"], ["3", 2, "ok"], ["4+", 1, "ok"]]);
    expect(r.cards.sort()).toEqual(["G1", "U1", "W1", "W2", "WU1", "WU2"]);
    expect(r.perCard).toEqual({ W1: 2, W2: 3, U1: 2, WU1: 3, WU2: 2, G1: 4 });
    expect(buckets(cubeRule("curve() 0:1 1:1 2+:8"))).toEqual([["0", 1, "ok"], ["1", 1, "ok"], ["2+", 8, "ok"]]);
  });
  it("counts a range bucket as every mana value from its lowest to its highest, labelled 1–3", () => {
    const r = cubeRule("curve(t:creature) 1-3:4..5 4:1");
    expect(r).toMatchObject({ status: "ok", value: 0 });
    expect(buckets(r)).toEqual([["1–3", 5, "ok"], ["4", 1, "ok"]]);
    expect(r.buckets?.[0]).toMatchObject({ mv: 1, mvMax: 3 });
    expect(buckets(cubeRule("curve() 0-1:2 2-3:6 4+:1"))).toEqual([["0–1", 2, "ok"], ["2–3", 7, "near"], ["4+", 1, "ok"]]);
    expect(cubeRule("curve() 0-1:2 2-3:4..5 4+:1")).toMatchObject({ value: 1, status: "fail" });
  });
  it("gives a range bucket in percent its share of the filtered cards", () => {
    expect(buckets(cubeRule("curve(t:creature) 2-3:80%..90% 4+:10%"))).toEqual([["2–3", 83.3, "ok"], ["4+", 16.7, "fail"]]);
  });
  it("counts the buckets out of range: near when every miss is within one card, fail beyond", () => {
    expect(cubeRule("curve(t:creature) 2:4..5 3:2")).toMatchObject({ value: 1, status: "near" });
    const r = cubeRule("curve(t:creature) 2:5..6 3:0 4:1");
    expect(r).toMatchObject({ value: 2, status: "fail" });
    expect(buckets(r)).toEqual([["2", 3, "fail"], ["3", 2, "fail"], ["4", 1, "ok"]]);
  });
  it("reads percent targets as a share of the filtered cards, near within one point", () => {
    expect(buckets(cubeRule("curve(t:creature) 2:50% 3:30%..40% 4:10%"))).toEqual([["2", 50, "ok"], ["3", 33.3, "ok"], ["4", 16.7, "fail"]]);
    expect(cubeRule("curve(t:creature) 3:33% 4:16%")).toMatchObject({ value: 2, status: "near" });
  });
  it("rounds a fractional mana value down", () => {
    const cards = { X: card("X", { mv: 2.5 }) };
    const r = evaluate(config({ rules: [rule("r", cube, "curve() 2:1 3:0")] }), ["X"], cards).cube.rules[0];
    expect(buckets(r)).toEqual([["2", 1, "ok"], ["3", 0, "ok"]]);
    const range = evaluate(config({ rules: [rule("r", cube, "curve() 0-1:0 2-3:1")] }), ["X"], cards).cube.rules[0];
    expect(buckets(range)).toEqual([["0–1", 0, "ok"], ["2–3", 1, "ok"]]);
  });
  it("scales bucket counts in a colour like counts, unless fixed or in percent", () => {
    const W = { kind: "color", color: "W" } as const;
    const run = (text: string) => evaluate(config({ cube: { name: "t", targetSize: 20 }, rules: [rule("r", W, text)] }), ALL, BY_ID).colors.W.rules[0];
    expect(run("curve(t:creature) 2:2 3:2").buckets).toMatchObject([{ label: "2", value: 2, raw: 1 }, { label: "3", value: 2, raw: 1 }]);
    expect(buckets(run("curve(t:creature) 2:1 3:1 fixed"))).toEqual([["2", 1, "ok"], ["3", 1, "ok"]]);
    expect(buckets(run("curve(t:creature) 2:50%"))).toEqual([["2", 50, "ok"]]);
  });
  it("has no status without buckets, and reports a filter that cannot run as an error", () => {
    expect(cubeRule("curve(t:creature)")).toMatchObject({ status: "none", value: 0, buckets: [] });
    expect(cubeRule("curve(member:any) 2:1")).toMatchObject({ status: "error" });
  });
  it("runs as a shared rule in each colour", () => {
    const r = evaluate(config({ rules: [rule("c", { kind: "allColors" }, "curve(t:creature) 2:1")] }), ALL, BY_ID);
    expect(r.allColors.rules[0].counts).toEqual({ ok: 2, near: 3, fail: 0, error: 0 });
  });
});
