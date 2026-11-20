import { describe, expect, it } from "vitest";
import { filterToText, parseFilter, parseRule, ruleToText } from "../src/index.ts";

describe("rule text syntax", () => {
  it("reads a count with a minimum", () => {
    expect(parseRule("count(otag:removal) >= 6")).toEqual({
      measure: { kind: "count" },
      filter: { op: "and", items: [{ field: "tag", op: "is", value: "removal" }] },
      constraint: { kind: "min", min: 6 },
    });
  });
});

describe("targets", () => {
  const target = (src: string) => parseRule(src).constraint;
  it("reads ranges, exact values and maximums", () => {
    expect(target("count(otag:ramp) in 13..14")).toEqual({ kind: "range", min: 13, max: 14 });
    expect(target("count(otag:ramp) 13..14")).toEqual({ kind: "range", min: 13, max: 14 });
    expect(target("count() <= 360")).toEqual({ kind: "max", max: 360 });
    expect(target("count(otag:ramp) = 3")).toEqual({ kind: "exact", value: 3 });
  });
  it("turns strict comparisons on card counts into whole cards", () => {
    expect(target("count(otag:ramp) > 5")).toEqual({ kind: "min", min: 6 });
    expect(target("count(otag:ramp) < 5")).toEqual({ kind: "max", max: 4 });
  });
  it("reads a percentage target on a count as a share of the scope", () => {
    expect(target("count(t:creature) >= 50%")).toEqual({ kind: "min", min: 50, unit: "percent" });
  });
  it("marks a count as fixed, never scaled to the target size", () => {
    expect(parseRule("count(otag:ramp) = 3 fixed").measure).toEqual({ kind: "count", absolute: true });
  });
  it("has no target when none is written", () => {
    expect(target("count(otag:ramp)")).toBeNull();
  });
});

describe("filter terms", () => {
  const one = (src: string) => {
    const f = parseFilter(src);
    expect(f.items).toHaveLength(1);
    return f.items[0];
  };
  it("reads text fields as case-insensitive 'contains'", () => {
    expect(one("t:Creature")).toEqual({ field: "type", op: "contains", value: "creature" });
    expect(one('o:"draw a card"')).toEqual({ field: "text", op: "contains", value: "draw a card" });
    expect(one("kw:Flying")).toEqual({ field: "keyword", op: "is", value: "flying" });
    expect(one("m:{X}")).toEqual({ field: "manaCost", op: "contains", value: "{X}" });
  });
  it("reads numbers and win rates", () => {
    expect(one("mv>=4")).toEqual({ field: "mv", op: ">=", value: 4 });
    expect(one("pow:3")).toEqual({ field: "power", op: "=", value: 3 });
    expect(one("wr>=55%")).toEqual({ field: "wrAdj", op: ">=", value: 0.55 });
    expect(one("wrraw<60")).toEqual({ field: "wrRaw", op: "<", value: 0.6 });
    expect(one("elo>=1300")).toEqual({ field: "ccElo", op: ">=", value: 1300 });
  });
  it("reads colours: exact, at least, at most, colourless and the scope's own colours", () => {
    expect(one("c=wu")).toEqual({ field: "colors", op: "is", value: "WU" });
    expect(one("c>=u")).toEqual({ field: "colors", op: "includes", value: "U" });
    expect(one("c<=uw")).toEqual({ field: "colors", op: "within", value: "WU" });
    expect(one("c:c")).toEqual({ field: "colors", op: "is", value: "" });
    expect(one("c=scope")).toEqual({ field: "colors", op: "is", value: "@scope" });
  });
  it("reads sets, rarities, names, hybrid, archetype members and CubeCobra tags", () => {
    expect(one("s:fdn,trk")).toEqual({ field: "set", op: "in", value: ["fdn", "trk"] });
    expect(one("s:fdn")).toEqual({ field: "set", op: "is", value: "fdn" });
    expect(one("r:u")).toEqual({ field: "rarity", op: "is", value: "uncommon" });
    expect(one('!"Lightning Bolt"')).toEqual({ field: "name", op: "is", value: "Lightning Bolt" });
    expect(one("name:bolt")).toEqual({ field: "name", op: "contains", value: "bolt" });
    expect(one("is:hybrid")).toEqual({ field: "hybrid", op: "is", value: true });
    expect(one("member:any")).toEqual({ field: "member", op: "is", value: "any" });
    expect(one('tag:"UG Ramp"')).toEqual({ field: "ccTag", op: "is", value: "UG Ramp" });
    expect(one("ncolors>=2")).toEqual({ field: "colorCount", op: ">=", value: 2 });
  });
  it("negates a term with a minus and with !=", () => {
    expect(one("-is:hybrid")).toEqual({ field: "hybrid", op: "is", value: true, not: true });
    expect(one("mv!=3")).toEqual({ field: "mv", op: "=", value: 3, not: true });
  });
  it("keeps Scryfall terms it does not model as a Scryfall query", () => {
    expect(one("id<=wu")).toEqual({ field: "scryfall", op: "matches", value: "id<=wu" });
  });
});

describe("filter structure", () => {
  it("joins terms with and, or, parentheses and negated groups", () => {
    expect(parseFilter("otag:removal or kw:flying")).toEqual({
      op: "or",
      items: [{ field: "tag", op: "is", value: "removal" }, { field: "keyword", op: "is", value: "flying" }],
    });
    expect(parseFilter("t:creature -(kw:flying or kw:reach)")).toEqual({
      op: "and",
      items: [
        { field: "type", op: "contains", value: "creature" },
        { op: "or", not: true, items: [{ field: "keyword", op: "is", value: "flying" }, { field: "keyword", op: "is", value: "reach" }] },
      ],
    });
  });
  it("reads an empty filter as 'every card'", () => {
    expect(parseFilter("")).toEqual({ op: "and", items: [] });
  });
});

describe("unreadable text", () => {
  it("names the unknown key and suggests the right ones", () => {
    expect(() => parseFilter("foo:bar")).toThrowError(/Unknown filter "foo".*otag:/);
  });
  it("reports a missing parenthesis", () => {
    expect(() => parseFilter("(t:creature or kw:flying")).toThrowError(/closing parenthesis/);
  });
  it("only accepts is:hybrid", () => {
    expect(() => parseFilter("is:commander")).toThrowError(/is:hybrid/);
  });
});

describe("measures", () => {
  it("reads an average of a metric over a filter, with a win-rate range", () => {
    expect(parseRule("avg(wr, member:any) in 55%..60%")).toEqual({
      measure: { kind: "avg", metric: "wrAdj" },
      filter: { op: "and", items: [{ field: "member", op: "is", value: "any" }] },
      constraint: { kind: "range", min: 0.55, max: 0.6 },
    });
    expect(parseRule("avg(mv, t:creature) <= 3").constraint).toEqual({ kind: "max", max: 3 });
  });
  it("reads 'every card must match' and 'every card's metric must be inside the target'", () => {
    expect(parseRule("every(s:fdn,trk)")).toEqual({
      measure: { kind: "every" },
      filter: { op: "and", items: [{ field: "set", op: "in", value: ["fdn", "trk"] }] },
      constraint: null,
    });
    expect(parseRule("every(mv, t:creature) <= 5")).toEqual({
      measure: { kind: "every", metric: "mv" },
      filter: { op: "and", items: [{ field: "type", op: "contains", value: "creature" }] },
      constraint: { kind: "max", max: 5 },
    });
  });
  it("reads the shorthand 'filter >= n' as a count", () => {
    expect(parseRule("otag:counterspell >= 6")).toEqual(parseRule("count(otag:counterspell) >= 6"));
  });
  it("rejects an unknown metric and lists the known ones", () => {
    expect(() => parseRule("avg(speed) >= 3")).toThrowError(/Unknown metric "speed".*wr, wrraw, mv/);
  });
});

describe("writing rules back as text", () => {
  const examples = [
    "count(otag:removal) >= 6",
    "count(otag:ramp) in 13..14",
    "count(t:creature) >= 50%",
    "count(c=scope -is:hybrid) = 3 fixed",
    "count(c=scope is:hybrid) = 2 fixed",
    "count() <= 360",
    "avg(wr, member:any) in 55%..60%",
    "avg(wrraw) in 54%..62%",
    "avg(mv, t:creature) <= 3",
    "every(s:fdn,trk)",
    "every(mv, t:creature) <= 5",
    'count(t:creature -(kw:flying or kw:reach) o:"draw a card")',
    'count(otag:removal or (kw:flying pow>=3)) >= 4',
    'count(!"Lightning Bolt" or name:bolt)',
    'count(tag:"UG Ramp" c<=wu c>=g c:c r:common)',
  ];
  it.each(examples)("writes %s back unchanged", (src) => {
    expect(ruleToText(parseRule(src))).toBe(src);
  });
  it("writes a group holding a single group without extra parentheses", () => {
    const f = { op: "or" as const, items: [{ op: "and" as const, items: [parseFilter("kw:flying").items[0], parseFilter("mv<=3").items[0]] }] };
    expect(ruleToText({ measure: { kind: "count" }, filter: f })).toBe("count(kw:flying mv<=3)");
  });
  it("writes a filter on its own", () => {
    expect(filterToText(parseFilter("otag:removal or kw:flying"))).toBe("otag:removal or kw:flying");
  });
});
