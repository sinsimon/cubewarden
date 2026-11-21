/** Filter fields, the operators each one accepts, and the metrics rules can average. */
import type { FieldId, Metric, Op } from "./model.ts";

export type DataSource = "cards" | "tags" | "wrAdj" | "wrRaw" | "cubecobra" | "cube" | "config";

export interface FieldInfo {
  id: FieldId;
  label: string;
  type: "text" | "tag" | "keyword" | "number" | "colors" | "bool" | "set" | "rarity" | "percent" | "member" | "query";
  ops: Op[];
  source: DataSource;
  hint?: string;
}

const NUM_OPS: Op[] = ["=", "<", "<=", ">", ">="];

export const FIELDS: FieldInfo[] = [
  { id: "name", label: "Name", type: "text", ops: ["is", "contains"], source: "cards" },
  { id: "tag", label: "Oracle tag", type: "tag", ops: ["is"], source: "tags", hint: "Scryfall Tagger functional tag, e.g. removal-creature" },
  { id: "type", label: "Type line", type: "text", ops: ["contains"], source: "cards" },
  { id: "text", label: "Rules text", type: "text", ops: ["contains"], source: "cards" },
  { id: "keyword", label: "Keyword", type: "keyword", ops: ["is"], source: "cards" },
  { id: "manaCost", label: "Mana cost", type: "text", ops: ["contains"], source: "cards" },
  { id: "mv", label: "Mana value", type: "number", ops: NUM_OPS, source: "cards" },
  { id: "power", label: "Power", type: "number", ops: NUM_OPS, source: "cards" },
  { id: "toughness", label: "Toughness", type: "number", ops: NUM_OPS, source: "cards" },
  { id: "colors", label: "Colours", type: "colors", ops: ["is", "includes", "within"], source: "cards", hint: "value '@scope' = the colours of the colour/archetype being checked" },
  { id: "colorCount", label: "Number of colours", type: "number", ops: NUM_OPS, source: "cards" },
  { id: "hybrid", label: "Hybrid", type: "bool", ops: ["is"], source: "cards" },
  { id: "set", label: "Printed in set", type: "set", ops: ["is", "in"], source: "cards" },
  { id: "rarity", label: "Rarity", type: "rarity", ops: ["is", "in"], source: "cards" },
  { id: "wrAdj", label: "Adjusted WR", type: "percent", ops: NUM_OPS, source: "wrAdj" },
  { id: "wrRaw", label: "Raw WR (GIH)", type: "percent", ops: NUM_OPS, source: "wrRaw" },
  { id: "games", label: "17Lands games", type: "number", ops: NUM_OPS, source: "wrRaw" },
  { id: "ccElo", label: "CubeCobra ELO", type: "number", ops: NUM_OPS, source: "cubecobra" },
  { id: "ccCubes", label: "CubeCobra cubes", type: "number", ops: NUM_OPS, source: "cubecobra", hint: "number of CubeCobra cubes that include the card" },
  { id: "ccPicks", label: "CubeCobra picks", type: "number", ops: NUM_OPS, source: "cubecobra" },
  { id: "ccTag", label: "CubeCobra tag", type: "text", ops: ["is"], source: "cube", hint: "a tag the card has in the imported CubeCobra cube" },
  { id: "member", label: "Mechanic member", type: "member", ops: ["is"], source: "config", hint: "a mechanic id = matches that mechanic of this colour or archetype; 'any' = at least one of its mechanics; 'primary' / 'secondary' = one of its primary / secondary mechanics" },
  { id: "scryfall", label: "Scryfall query", type: "query", ops: ["matches"], source: "cards", hint: "Subset of Scryfall syntax: t: o: otag: keyword: m: mv pow tou c: id: r: s: is:hybrid, 'or', '-'" },
];
export const FIELD = Object.fromEntries(FIELDS.map((f) => [f.id, f])) as Record<FieldId, FieldInfo>;

export const pct = (v: number | null | undefined) => (v == null ? "n/a" : (v * 100).toFixed(1) + "%");

export const METRICS: Record<Metric, { label: string; format: (v: number) => string; source: DataSource }> = {
  wrAdj: { label: "Adjusted WR", format: pct, source: "wrAdj" },
  wrRaw: { label: "Raw WR (GIH)", format: pct, source: "wrRaw" },
  mv: { label: "Mana value", format: (v) => v.toFixed(2), source: "cards" },
  power: { label: "Power", format: (v) => v.toFixed(1), source: "cards" },
  ccElo: { label: "CubeCobra ELO", format: (v) => v.toFixed(0), source: "cubecobra" },
  ccCubes: { label: "CubeCobra cubes", format: (v) => v.toFixed(0), source: "cubecobra" },
  ccPicks: { label: "CubeCobra picks", format: (v) => v.toFixed(0), source: "cubecobra" },
  colorCount: { label: "Number of colours", format: (v) => v.toFixed(0), source: "cards" },
};
