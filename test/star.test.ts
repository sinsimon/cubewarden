import { describe, expect, it } from "vitest";
import { chordBadgeT, enemyLabel, fitLines } from "../src/index.ts";

// The Overview's star: centre (410, 316), colours on a circle of radius 186, colour circles r=31, badges r=17.
// Worked by hand: W (410, 130), U (586.896, 258.523), B (519.327, 466.477), R (300.673, 466.477), G (233.104, 258.523).
// A diagonal is 2·186·sin 72° = 353.793 long; the other diagonals cut it at 353.793/φ² = 135.137 from each end.
const STAR = { cx: 410, cy: 316, radius: 186, nodeRadius: 31, badgeRadius: 17 };
const chars = (s: string) => s.length * 6; // a fake font: every character 6 units wide

describe("badges along a chord", () => {
  it("keeps one archetype in the middle and spreads several by a fifth of the chord", () => {
    expect(chordBadgeT(0, 1)).toBe(0.5);
    expect([chordBadgeT(0, 2), chordBadgeT(1, 2)].map((t) => +t.toFixed(6))).toEqual([0.4, 0.6]);
    expect([0, 1, 2].map((k) => +chordBadgeT(k, 3).toFixed(6))).toEqual([0.3, 0.5, 0.7]);
  });
});

describe("enemy archetype names on the star", () => {
  it("leaves allied pairs, single colours and three or more colours to the other labels", () => {
    for (const c of ["WU", "UB", "BR", "RG", "WG", "W", "WUB", "WUBRG", "", "WX"]) expect(enemyLabel(c, ["Name"], STAR, chars)).toBeNull();
    expect(enemyLabel("WB", [], STAR, chars)).toBeNull();
  });

  it("writes Simic on the horizontal U–G diagonal, above it, between Green and the first crossing", () => {
    const l = enemyLabel("UG", ["Simic Ramp"], STAR, chars)!;
    expect(l.angle).toBeCloseTo(0, 6);
    expect(l.y).toBeCloseTo(258.523, 2);
    // Free stretch: from 31 + 6 past Green's centre to 6 before the crossing at 135.137, so 37..129.137, centre 83.07.
    expect(l.x).toBeCloseTo(233.104 + 83.068, 2);
    expect(l.width).toBeCloseTo(92.137, 2);
    expect(l.lines).toEqual([{ text: "Simic Ramp", dy: -9 }]); // one line, above the chord (towards White)
  });

  it("turns each diagonal's text to read left to right, on the side towards the colour between the pair", () => {
    const angle = (c: string) => Math.round(enemyLabel(c, ["X"], STAR, chars)!.angle);
    expect({ WB: angle("WB"), UR: angle("UR"), BG: angle("BG"), WR: angle("WR"), UG: angle("UG") })
      .toEqual({ WB: 72, UR: -36, BG: 36, WR: -72, UG: 0 });
    // Text sits above its chord (negative dy) when the colour in between is above the text's baseline, else below.
    const dy = (c: string) => enemyLabel(c, ["X"], STAR, chars)!.lines[0].dy;
    expect({ WB: dy("WB"), UR: dy("UR"), BG: dy("BG"), WR: dy("WR"), UG: dy("UG") })
      .toEqual({ WB: -9, UR: 15, BG: 15, WR: -9, UG: -9 });
  });

  it("places the five names as one shape turned by a fifth of a circle each time", () => {
    const polar = ["UG", "WB", "UR", "BG", "WR"].map((c) => {
      const l = enemyLabel(c, ["X"], STAR, chars)!;
      return { d: Math.hypot(l.x - 410, l.y - 316), a: (Math.atan2(l.y - 316, l.x - 410) * 180) / Math.PI };
    });
    for (const p of polar) expect(p.d).toBeCloseTo(polar[0].d, 6);
    const turns = polar.map((p) => Math.round((p.a - polar[0].a + 360) % 360) % 360).sort((a, b) => a - b);
    expect(turns).toEqual([0, 72, 144, 216, 288]);
  });

  it("wraps a long name onto a second line, further from the chord, in a shorter stretch", () => {
    const l = enemyLabel("UG", ["Orzhov Tokens & Lifegain"], STAR, chars)!;
    // Two lines reach 18 + 14 = 32 from the chord: the pentagon edge from Green (36° away) clears it from 32·cot 36° + 4 = 48.04.
    expect(l.width).toBeCloseTo(129.137 - 48.044, 2);
    expect(l.lines).toEqual([{ text: "Orzhov Tokens", dy: -23 }, { text: "& Lifegain", dy: -9 }]);
  });

  it("stops short of the badges when several archetypes share the pair", () => {
    // Three on U–G: badges at 0.3, 0.5, 0.7 of the chord from Blue; the nearest to Green is at x = 339.24.
    const l = enemyLabel("UG", ["A", "B", "C"], STAR, chars)!;
    expect(l.x + l.width / 2).toBeLessThanOrEqual(339.24 - 17);
    expect(l.lines.map((x) => x.text)).toEqual(["A", "B", "C"]);
    // Two: badges at 0.4 and 0.6; the one towards Green sits past the crossing, edge at x = 357.62.
    const two = enemyLabel("UG", ["A", "B"], STAR, chars)!;
    expect(two.x + two.width / 2).toBeLessThanOrEqual(357.62);
  });
});

describe("fitting a name into a width", () => {
  it("keeps a name that fits", () => {
    expect(fitLines("Simic Ramp", 92, chars, 1)).toEqual(["Simic Ramp"]);
  });
  it("wraps at spaces and cuts the last line with an ellipsis", () => {
    expect(fitLines("Orzhov Tokens & Lifegain", 92, chars, 2)).toEqual(["Orzhov Tokens &", "Lifegain"]);
    expect(fitLines("Orzhov Tokens & Lifegain", 60, chars, 1)).toEqual(["Orzhov To…"]);
    expect(fitLines("Golgari Graveyard Value Engine", 60, chars, 2)).toEqual(["Golgari", "Graveyard…"]);
  });
  it("cuts a single word too long for the line", () => {
    expect(fitLines("Supercalifragilistic Deck", 60, chars, 2)).toEqual(["Supercali…"]);
  });
});
