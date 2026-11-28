import { describe, expect, it } from "vitest";
import { cardTableView, evaluate, parseFilter } from "../src/index.ts";
import { ALL, BY_ID, config, rule } from "./fixtures/cards.ts";

// The page's card table for the selected rule or mechanic. The fixture's instants are W3 and U2; W3 alone is
// tagged removal and alone is printed outside fdn (set trk).
const cube = { kind: "cube" } as const;
const cubeRule = (text: string) => evaluate(config({ rules: [rule("r", cube, text)] }), ALL, BY_ID).cube.rules[0];
const removal = () => {
  const cfg = config();
  cfg.colors[0].mechanics = [{ id: "rem", name: "Removal", filter: parseFilter("otag:removal"), constraint: { kind: "min", min: 2 } }];
  return evaluate(cfg, ALL, BY_ID).colors.W.mechanics[0];
};
const W_CARDS = ["W1", "W2", "W3", "WU1", "WU2"];

describe("the card table with a mechanic or count rule selected", () => {
  it("lists only the cards it counts, without the All | Counted control, the value column or highlighting", () => {
    const v = cardTableView(W_CARDS, removal(), { show: "all", showOthers: false });
    expect(v.ids).toEqual(["W3"]);
    expect(v).toMatchObject({ showControl: false, valueColumn: false, marked: null, othersToggle: true });
  });

  it("ignores a stale All | Counted | Not counted choice while the others are hidden", () => {
    expect(cardTableView(ALL, cubeRule("count(t:instant) >= 1"), { show: "miss", showOthers: false }).ids).toEqual(["W3", "U2"]);
  });

  it("with Show others, lists every card as before: the control, the value column and the counted cards marked", () => {
    const v = cardTableView(W_CARDS, removal(), { show: "all", showOthers: true });
    expect(v.ids).toEqual(W_CARDS);
    expect(v).toMatchObject({ showControl: true, valueColumn: true, othersToggle: true });
    expect([...v.marked!]).toEqual(["W3"]);
    expect(cardTableView(ALL, cubeRule("count(t:instant) >= 1"), { show: "match", showOthers: true }).ids).toEqual(["W3", "U2"]);
    expect(cardTableView(W_CARDS, removal(), { show: "miss", showOthers: true }).ids).toEqual(["W1", "W2", "WU1", "WU2"]);
  });
});

describe("the card table for anything else", () => {
  it("with nothing selected lists every card, with the value column and no toggle", () => {
    const v = cardTableView(W_CARDS, null, { show: "all", showOthers: false });
    expect(v).toEqual({ ids: W_CARDS, marked: null, showControl: false, valueColumn: true, othersToggle: false });
  });

  it("keeps an 'every' rule as it was: all cards, Breaking | Passing, the breaking ones marked", () => {
    const v = cardTableView(ALL, cubeRule("every(s:fdn)"), { show: "all", showOthers: false });
    expect(v.ids).toEqual(ALL);
    expect(v).toMatchObject({ showControl: true, valueColumn: true, othersToggle: false });
    expect([...v.marked!]).toEqual(["W3"]);
    expect(cardTableView(ALL, cubeRule("every(s:fdn)"), { show: "match", showOthers: false }).ids).toEqual(["W3"]);
  });

  it("keeps an average as it was: its value column holds each card's number", () => {
    const v = cardTableView(ALL, cubeRule("avg(wr, t:instant) >= 0"), { show: "all", showOthers: false });
    expect(v.ids).toEqual(ALL);
    expect(v).toMatchObject({ showControl: true, valueColumn: true, othersToggle: false });
  });
});
