import { describe, expect, it } from "vitest";
import {
  createWorkspace, isLinkedRule, linkedRule, linkedRules, mechanicOfRule, mechanicTarget, parseFilter, removeMechanic, saveMechanic,
  type Config, type Mechanic, type Rule, type Scope,
} from "../src/index.ts";
import { BY_ID, config, rule } from "./fixtures/cards.ts";

// One archetype (wu) with three mechanics, and a black colour scope with one "must".
const WU: Scope = { kind: "archetype", id: "wu" };
const B: Scope = { kind: "color", color: "B" };
const fly: Mechanic = { id: "fly", name: "Flyers", filter: parseFilter("kw:flying") };
const cheap: Mechanic = { id: "cheap", name: "Cheap", priority: "secondary", filter: parseFilter("mv<=2") };
const spells: Mechanic = { id: "spells", name: "Spells", filter: parseFilter("t:instant") };
const removal: Mechanic = { id: "removal", name: "Removal", filter: parseFilter("tag:removal") };

function cfg(rules: Rule[], over: { wu?: Mechanic[]; b?: Mechanic[] } = {}): Config {
  const c = config({ archetypes: [{ id: "wu", name: "Azorius Flyers", colors: "WU", mechanics: over.wu ?? [fly, cheap, spells] }], rules });
  c.colors.find((x) => x.code === "B")!.mechanics = over.b ?? [removal];
  return c;
}

describe("linked rules: the rule that gives a mechanic its target", () => {
  it("is a count of exactly member:<mechanic> in the mechanic's scope, whatever its target, fixed or not", () => {
    for (const text of ["count(member:fly) >= 4", "count(member:fly) <= 6", "count(member:fly) in 3..5", "count(member:fly) = 2 fixed", "count(member:fly) >= 20%", "count(member:fly)"]) {
      expect(isLinkedRule(rule("x", WU, text), WU, "fly"), text).toBe(true);
    }
    expect(isLinkedRule(rule("x", B, "count(member:removal) >= 3"), B, "removal")).toBe(true);
  });

  it("is not linked when the filter holds more than the mechanic, negates it, or the rule measures something else", () => {
    for (const text of ["count(member:fly mv<=3) >= 2", "count(member:fly or member:cheap) >= 4", "count(-member:fly) <= 3", "count(member:any) >= 10",
      "avg(wr, member:fly) >= 1", "every(member:fly)", "curve(member:fly) 2:1..3"]) {
      expect(isLinkedRule(rule("x", WU, text), WU, "fly"), text).toBe(false);
    }
    expect(isLinkedRule({ ...rule("x", WU, "count(member:fly) >= 2"), filter: { op: "and", not: true, items: [{ field: "member", op: "is", value: "fly" }] } }, WU, "fly")).toBe(false);
  });

  it("is not linked in another scope, or to a mechanic its scope does not have", () => {
    expect(isLinkedRule(rule("x", { kind: "allArchetypes" }, "count(member:fly) >= 2"), WU, "fly")).toBe(false);
    expect(isLinkedRule(rule("x", B, "count(member:fly) >= 2"), WU, "fly")).toBe(false);
    expect(linkedRules(cfg([rule("x", WU, "count(member:ghost) >= 2")]), WU, "ghost")).toEqual([]);
  });

  it("is found by structure, not by id; with two, the first holds the target and the other stays a plain rule", () => {
    const c = cfg([rule("gold", WU, "count(ncolors>=2) <= 4"), rule("anything", WU, "count(member:fly) >= 4"), rule("second", WU, "count(member:fly) <= 8")]);
    expect(linkedRules(c, WU, "fly").map((r) => r.id)).toEqual(["anything", "second"]);
    expect(linkedRule(c, WU, "fly")?.id).toBe("anything");
    expect(mechanicOfRule(c, c.rules[1])?.id).toBe("fly");
    expect(mechanicOfRule(c, c.rules[2])).toBeNull();
    expect(mechanicOfRule(c, c.rules[0])).toBeNull();
    expect(linkedRule(c, WU, "cheap")).toBeNull();
  });
});

describe("a mechanic's target", () => {
  it("comes from the linked rule: its constraint and whether it is fixed", () => {
    const c = cfg([rule("r-fly", WU, "count(member:fly) in 3..5 fixed")]);
    expect(mechanicTarget(c, WU, "fly")).toEqual({ constraint: { kind: "range", min: 3, max: 5 }, absolute: true, ruleId: "r-fly" });
    expect(mechanicTarget(c, WU, "cheap")).toEqual({ constraint: null, absolute: false, ruleId: null });
  });

  it("comes from the mechanic itself in an older project that kept the target there", () => {
    const c = cfg([], { wu: [{ ...fly, constraint: { kind: "min", min: 2 } }] });
    expect(mechanicTarget(c, WU, "fly")).toEqual({ constraint: { kind: "min", min: 2 }, absolute: false, ruleId: null });
  });
});

describe("saving a mechanic with its target", () => {
  it("creates the linked rule r-<id> in the same scope, named and prioritised like the mechanic", () => {
    const c = saveMechanic(cfg([]), WU, cheap, { constraint: { kind: "min", min: 6 } });
    expect(c.rules).toEqual([{ id: "r-cheap", name: "Cheap", priority: "secondary", scope: WU, measure: { kind: "count" },
      filter: { op: "and", items: [{ field: "member", op: "is", value: "cheap" }] }, constraint: { kind: "min", min: 6 } }]);
    const b = saveMechanic(cfg([]), B, removal, { constraint: { kind: "range", min: 3, max: 4 }, absolute: true });
    expect(b.rules[0]).toMatchObject({ id: "r-removal", scope: B, measure: { kind: "count", absolute: true } });
    expect(isLinkedRule(b.rules[0], B, "removal")).toBe(true);
  });

  it("picks a free id when r-<id> is taken by another rule", () => {
    const c = saveMechanic(cfg([rule("r-fly", WU, "count(t:creature) >= 1")]), WU, fly, { constraint: { kind: "min", min: 4 } });
    expect(c.rules.map((r) => r.id)).toEqual(["r-fly", "r-fly-2"]);
  });

  it("updates the linked rule in place: new target, fixed flag, name and priority; id, description and position stay", () => {
    const start = cfg([rule("gold", WU, "count(ncolors>=2) <= 4"), rule("my-fly", WU, "count(member:fly) >= 4", { name: "Old name", description: "Why flyers" }), rule("size", { kind: "cube" }, "count() <= 360")]);
    const c = saveMechanic(start, WU, { ...fly, name: "Evasion", priority: "secondary" }, { constraint: { kind: "max", max: 7 }, absolute: true });
    expect(c.rules.map((r) => r.id)).toEqual(["gold", "my-fly", "size"]);
    expect(c.rules[1]).toEqual({ id: "my-fly", name: "Evasion", priority: "secondary", description: "Why flyers", scope: WU,
      measure: { kind: "count", absolute: true }, filter: { op: "and", items: [{ field: "member", op: "is", value: "fly" }] }, constraint: { kind: "max", max: 7 } });
    expect(c.archetypes[0].mechanics[0]).toEqual({ ...fly, name: "Evasion", priority: "secondary" });
    expect(start.rules[1].name).toBe("Old name"); // the input is left as it was
  });

  it("makes the linked rule primary again when the mechanic is primary", () => {
    const start = cfg([rule("r-fly", WU, "count(member:fly) >= 4", { priority: "secondary" })]);
    expect(saveMechanic(start, WU, fly, { constraint: { kind: "min", min: 4 } }).rules[0].priority).toBe("primary");
  });

  it("changes nothing when the mechanic is saved with the target it already has", () => {
    const start = cfg([rule("r-fly", WU, "count(member:fly) >= 4", { name: "Flyers" })]);
    expect(saveMechanic(start, WU, fly, mechanicTarget(start, WU, "fly"))).toEqual(start);
  });

  it("removes the linked rule when the target becomes 'no target', and keeps other linked rules", () => {
    const start = cfg([rule("r-fly", WU, "count(member:fly) >= 4"), rule("cap", WU, "count(member:fly) <= 9")]);
    const c = saveMechanic(start, WU, fly, { constraint: null });
    expect(c.rules.map((r) => r.id)).toEqual(["cap"]);
    expect(saveMechanic(cfg([]), WU, fly, { constraint: null }).rules).toEqual([]);
  });

  it("adds a new mechanic to the scope", () => {
    const fresh: Mechanic = { id: "big", name: "Big", filter: parseFilter("mv>=5") };
    const c = saveMechanic(cfg([]), WU, fresh, { constraint: { kind: "min", min: 2 } });
    expect(c.archetypes[0].mechanics.map((m) => m.id)).toEqual(["fly", "cheap", "spells", "big"]);
    expect(linkedRule(c, WU, "big")?.id).toBe("r-big");
  });

  it("moves an older project's target off the mechanic into the linked rule, with the same result", () => {
    // In the cube: W2 and WU... flyers. The legacy target sits on the mechanic.
    const legacy = cfg([], { wu: [{ ...fly, constraint: { kind: "min", min: 2 } }, cheap] });
    const ids = ["W1", "W2", "W3", "U1", "WU1", "L1"];
    const before = createWorkspace({ version: 1, original: ids, current: ids, config: legacy }, BY_ID).check();
    const c = saveMechanic(legacy, WU, legacy.archetypes[0].mechanics[0], mechanicTarget(legacy, WU, "fly"));
    expect(c.archetypes[0].mechanics[0]).toEqual(fly);
    expect(c.rules).toEqual([expect.objectContaining({ id: "r-fly", constraint: { kind: "min", min: 2 } })]);
    const after = createWorkspace({ version: 1, original: ids, current: ids, config: c }, BY_ID).check();
    expect(after.ok).toBe(before.ok);
    expect(before.failing.map((f) => [f.kind, f.id, f.status, f.value])).toEqual([["mechanic", "fly", "near", 1]]);
    expect(after.failing.map((f) => [f.kind, f.id, f.status, f.value])).toEqual([["rule", "r-fly", "near", 1]]);
  });
});

describe("deleting a mechanic", () => {
  it("deletes every rule linked to it and keeps rules that use it inside a larger filter", () => {
    const start = cfg([rule("r-fly", WU, "count(member:fly) >= 4"), rule("cap", WU, "count(member:fly) <= 9"), rule("cheap-fly", WU, "count(member:fly mv<=2) >= 1"), rule("gold", WU, "count(ncolors>=2) <= 4")]);
    const c = removeMechanic(start, WU, "fly");
    expect(c.archetypes[0].mechanics.map((m) => m.id)).toEqual(["cheap", "spells"]);
    expect(c.rules.map((r) => r.id)).toEqual(["cheap-fly", "gold"]);
    expect(removeMechanic(cfg([rule("r-removal", B, "count(member:removal) >= 3")]), B, "removal").rules).toEqual([]);
  });
});
