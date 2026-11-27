/**
 * Geometry of the Overview's archetype star: the five colours on a pentagon (White at the top, then clockwise
 * Blue, Black, Red, Green) and each two-colour archetype as the line between its colours. Allied pairs are the
 * pentagon's edges and keep their names outside it (drawn by the page). Enemy pairs are the diagonals: their names
 * go along the diagonal itself, on the stretch between a colour circle and the first crossing, the only free space
 * inside the star (the middle stretch holds the badge, the centre the five-colour badges).
 *
 * Which stretch and which side follow one rule, repeated by the star's five-fold symmetry: for the diagonal from
 * colour i to colour i+2, the stretch next to i, on the side of the colour in between (i+1). That side is the
 * triangle between the diagonal and the allied edge i–(i+1), so each of the five triangles holds one name.
 */
import { WUBRG } from "./colors.ts";

export interface StarGeometry { cx: number; cy: number; radius: number; nodeRadius: number; badgeRadius: number }
export interface ChordLabel {
  /** Centre of the text block on the diagonal, in the star's coordinates. */
  x: number; y: number;
  /** Rotation in degrees, between -90 and 90 so the text reads left to right. */
  angle: number;
  /** Length of the free stretch the lines fit in. */
  width: number;
  /** Each line with its baseline offset from the diagonal, in the rotated frame (negative: above). */
  lines: { text: string; dy: number }[];
}

/** Where along its line (0 = first colour in WUBRG order) the k-th of n archetypes on one pair puts its badge. */
export function chordBadgeT(k: number, n: number): number { return 0.5 + (k - (n - 1) / 2) * 0.2; }

const GAP = 6, LINE = 14, ASCENT = 9, DESCENT = 3, PAD = 6, BADGE_PAD = 5;
const PHI2 = ((1 + Math.sqrt(5)) / 2) ** 2;
/** How far from the diagonal n lines of text reach. */
const reach = (n: number) => GAP + ASCENT + DESCENT + (n - 1) * LINE;

/**
 * Up to maxLines lines of text no wider than width: wrapped at spaces, the last line cut with an ellipsis when the
 * rest does not fit. measure gives a string's width in the same units.
 */
export function fitLines(text: string, width: number, measure: (s: string) => number, maxLines: number): string[] {
  const cut = (s: string) => {
    if (measure(s) <= width) return s;
    let n = s.length;
    while (n > 1 && measure(s.slice(0, n).trimEnd() + "…") > width) n--;
    return s.slice(0, n).trimEnd() + "…";
  };
  const words = text.trim().split(/\s+/).filter(Boolean), out: string[] = [];
  let i = 0;
  while (i < words.length && out.length < maxLines) {
    if (out.length === maxLines - 1) { out.push(cut(words.slice(i).join(" "))); break; }
    if (measure(words[i]) > width) { out.push(cut(words.slice(i).join(" "))); break; }
    let line = words[i++];
    while (i < words.length && measure(line + " " + words[i]) <= width) line += " " + words[i++];
    out.push(line);
  }
  return out;
}

/**
 * The names of the archetypes on one enemy pair, placed along their diagonal, or null for anything else (allied
 * pairs, one colour, three or more). names: the named archetypes on that pair, in the order their badges are drawn.
 */
export function enemyLabel(colors: string, names: string[], g: StarGeometry, measure: (s: string) => number): ChordLabel | null {
  if (colors.length !== 2 || !names.length) return null;
  const a = WUBRG.indexOf(colors[0]), b = WUBRG.indexOf(colors[1]);
  if (a < 0 || b < 0) return null;
  const i = (b - a + 5) % 5 === 2 ? a : (a - b + 5) % 5 === 2 ? b : -1;
  if (i < 0) return null;
  const pos = (k: number) => {
    const t = ((-90 + 72 * (k % 5)) * Math.PI) / 180;
    return [g.cx + g.radius * Math.cos(t), g.cy + g.radius * Math.sin(t)];
  };
  const [x0, y0] = pos(i), [x2, y2] = pos(i + 2), [x1, y1] = pos(i + 1);
  const len = Math.hypot(x2 - x0, y2 - y0), ux = (x2 - x0) / len, uy = (y2 - y0) / len;
  // Badges on this diagonal, as distances from colour i; the stretch ends before the first crossing and any badge.
  const fromI = names.map((_, k) => (WUBRG[i] === colors[0] ? chordBadgeT(k, names.length) : 1 - chordBadgeT(k, names.length)) * len);
  const end = Math.min(len / PHI2 - PAD, ...fromI.map((d) => d - g.badgeRadius - BADGE_PAD));
  // The allied edge from colour i leaves at 36° from the diagonal: n lines clear it from reach(n)·cot 36° on.
  const start = (n: number) => Math.max(g.nodeRadius + PAD, reach(n) / Math.tan(Math.PI / 5) + 4);
  // Upright angle, and which side of the baseline the colour in between lies on (+1 below, -1 above).
  let angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (angle > 90) angle -= 180; else if (angle <= -90) angle += 180;
  const r = (angle * Math.PI) / 180, side = (-Math.sin(r) * (x1 - x0) + Math.cos(r) * (y1 - y0)) > 0 ? 1 : -1;

  const slot = (n: number) => ({ from: start(n), width: Math.max(0, end - start(n)) });
  let s = slot(1), texts: string[];
  if (names.length === 1) {
    texts = fitLines(names[0], s.width, measure, 1);
    if (texts[0] !== names[0].trim()) { s = slot(2); texts = fitLines(names[0], s.width, measure, 2); }
    s = slot(texts.length);
  } else {
    s = slot(names.length);
    texts = names.map((n) => fitLines(n, s.width, measure, 1)[0] ?? "");
  }
  const mid = s.from + s.width / 2, n = texts.length;
  return {
    x: x0 + ux * mid, y: y0 + uy * mid, angle, width: s.width,
    lines: texts.map((text, k) => ({ text, dy: side < 0 ? -(GAP + DESCENT) - (n - 1 - k) * LINE : GAP + ASCENT + k * LINE })),
  };
}
