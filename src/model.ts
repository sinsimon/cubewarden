/**
 * The cubewarden model. The engine ships no rules of its own: every rule comes from the user's config.
 *
 *   Filter     = { op: "and" | "or", not?, items: (Condition | Filter)[] }
 *   Condition  = { field, op, value, not? }
 *   Constraint = min | max | exact | range, with unit "percent" on counts = share of the scope.
 *   Rule       = scope + measure (count | avg of a metric | every card | curve) + optional filter + constraint + priority.
 *   Curve      = a target per mana value bucket ("2" = mana value 2, "1-3" = 1 to 3, "6+" = 6 and above) over the
 *                filtered cards. Buckets do not overlap and only the highest can be "+".
 *   Archetype  = 2 to 5 colours + name + mechanics; a mechanic is a filter with an optional constraint. It draws from
 *                nonland cards in its colours and colourless nonland cards.
 */

export type Color = "W" | "U" | "B" | "R" | "G";
export type ScopeCode = Color | "C" | "L";

export type FieldId =
  | "name" | "tag" | "type" | "text" | "keyword" | "manaCost" | "mv" | "power" | "toughness"
  | "colors" | "colorCount" | "hybrid" | "set" | "rarity" | "wrDelta" | "wrRaw" | "games"
  | "ccElo" | "ccCubes" | "ccPicks" | "ccTag" | "member" | "scryfall";

export type Op = "is" | "contains" | "in" | "includes" | "within" | "matches" | "=" | "<" | "<=" | ">" | ">=";

export interface Condition {
  field: FieldId;
  op: Op;
  value: string | number | boolean | string[];
  not?: boolean;
}

export interface Filter {
  op: "and" | "or";
  not?: boolean;
  items: (Condition | Filter)[];
}

export type Constraint = (
  | { kind: "min"; min: number }
  | { kind: "max"; max: number }
  | { kind: "exact"; value: number }
  | { kind: "range"; min: number; max: number }
) & { unit?: "percent" };

export type Metric = "wrDelta" | "wrRaw" | "mv" | "power" | "ccElo" | "ccCubes" | "ccPicks" | "colorCount";

/**
 * One bucket of a curve: cards whose mana value (rounded down) is `mv`, from `mv` to `mvMax` when set, or `mv` and
 * above when `plus`. `mvMax` (> mv) and `plus` never go together.
 */
export interface CurveBucket {
  mv: number;
  mvMax?: number;
  plus?: boolean;
  /** Cards, or with unit "percent" a share of the cards matching the curve's filter. */
  constraint: Constraint;
}

export type Measure =
  | { kind: "count"; absolute?: boolean }
  | { kind: "avg"; metric: Metric }
  | { kind: "every"; metric?: Metric }
  | { kind: "curve"; buckets: CurveBucket[]; absolute?: boolean };

/** What a line of rule text holds: the measure, an optional filter and an optional target. */
export interface RuleBody {
  measure: Measure;
  filter: Filter | null;
  constraint: Constraint | null;
}

export type Priority = "primary" | "secondary";

export type Scope =
  | { kind: "cube" }
  | { kind: "color"; color: ScopeCode }
  | { kind: "archetype"; id: string }
  | { kind: "allColors" }
  | { kind: "allArchetypes" };

export interface Rule {
  id: string;
  name: string;
  description?: string;
  priority?: Priority;
  scope: Scope;
  measure: Measure;
  filter?: Filter | null;
  constraint?: Constraint | null;
}

export interface Mechanic {
  id: string;
  name: string;
  priority?: Priority;
  filter: Filter | null;
  constraint?: Constraint | null;
}

export interface Archetype {
  id: string;
  name: string;
  colors: string;
  description?: string;
  mechanics: Mechanic[];
}

export interface ColorConfig {
  code: ScopeCode;
  description?: string;
  mechanics: Mechanic[];
}

export interface Config {
  version: 1;
  cube: { name: string; targetSize?: number | null; description?: string };
  colors: ColorConfig[];
  archetypes: Archetype[];
  rules: Rule[];
  references?: { id: string; name: string }[];
}

export interface Card {
  id: string;
  name: string;
  colors: string;
  identity: string;
  manaCost: string;
  hybrid: boolean;
  type: string;
  mv: number;
  power: string | null;
  toughness: string | null;
  text: string;
  keywords: string[];
  tags: string[];
  set: string | null;
  number: string | null;
  rarity: string | null;
  printSets: string[];
  image: string | null;
  scryfallId?: string | null;
  /**
   * WR Δ, in percentage points: the 17Lands adjusted WR minus the mean adjusted WR of the commons and uncommons of
   * the set the win rate comes from (wrSet). Comparable across sets; 0 = an average common or uncommon of its set.
   */
  wrDelta?: number | null;
  /** 17Lands GIH WR, a fraction (0.55). */
  wrRaw?: number | null;
  games?: number | null;
  wrSet?: string | null;
  ccElo?: number | null;
  ccCubes?: number | null;
  ccPicks?: number | null;
  ccTags?: string[];
}
