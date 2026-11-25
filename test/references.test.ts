import { describe, expect, it } from "vitest";
import { referenceCounts, sortCards, type ReferenceState } from "../src/index.ts";
import { card } from "./fixtures/cards.ts";

const ok = (name: string, ids: string[], names: Record<string, string> = {}): ReferenceState => ({
  status: "ok", name, ids,
  cardsById: Object.fromEntries(ids.map((id) => [id, card(id, { name: names[id] ?? id })])),
});

describe("referenceCounts", () => {
  it("counts the loaded reference cubes that play each card, out of the loaded ones", () => {
    const rc = referenceCounts([ok("Vintage", ["A", "B"]), ok("Pauper", ["A"]), ok("Peasant", ["C"])])!;
    expect(rc.of).toBe(3);
    expect(rc.count(card("A"))).toBe(2);
    expect(rc.count(card("C"))).toBe(1);
    expect(rc.count(card("Z"))).toBe(0);
    expect(rc.names(card("A"))).toEqual(["Vintage", "Pauper"]);
  });

  it("counts a cube once even when it lists the card twice", () => {
    const rc = referenceCounts([ok("Vintage", ["A", "A"])])!;
    expect(rc.count(card("A"))).toBe(1);
  });

  it("matches another printing by name when the id differs", () => {
    const rc = referenceCounts([ok("Vintage", ["other-oracle"], { "other-oracle": "Lightning Bolt" })])!;
    expect(rc.count(card("A", { name: "lightning bolt" }))).toBe(1);
  });

  it("gives nothing while a reference is still loading, or when none is configured or loaded", () => {
    expect(referenceCounts([])).toBeNull();
    expect(referenceCounts([ok("Vintage", ["A"]), { status: "loading", name: "Pauper" }])).toBeNull();
    expect(referenceCounts([{ status: "error", name: "Pauper" }])).toBeNull();
  });

  it("leaves a reference that failed to load out of the total", () => {
    const rc = referenceCounts([ok("Vintage", ["A"]), { status: "error", name: "Pauper" }])!;
    expect(rc.of).toBe(1);
    expect(rc.count(card("A"))).toBe(1);
  });
});

describe("sortCards with a value getter", () => {
  it("sorts high to low by the getter, missing values last, then by name", () => {
    const cards = [card("c", { name: "Cee" }), card("a", { name: "Ay" }), card("b", { name: "Bee" }), card("d", { name: "Dee" })];
    const v: Record<string, number | null> = { a: 1, b: 2, c: 1, d: null };
    expect(sortCards(cards, (c) => v[c.id]).map((c) => c.id)).toEqual(["b", "a", "c", "d"]);
  });
});
