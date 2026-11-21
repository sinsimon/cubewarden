/** Shared hard-coded data for the React mockups (no engine). Cards come from the page's #cards JSON. */
export type Card = { name: string; cost: string; type: string; mv: number; wrAdj: number; wrRaw: number; set: string; rarity: string; rules: string[] };
export type Status = "pass" | "warn" | "fail";
export type Rule = { id: string; name: string; min: number; max?: number; count: number; status: Status; target: string };
export type Scope = { id: string; name: string; status: Status; count: number | string; pips?: string; desc?: string };

// Foundations (FDN) white cards with 17Lands win rates: a 25-card sample.
export const CARDS: Card[] = JSON.parse(document.getElementById("cards")!.textContent!);

export const RULES: Rule[] = ([
  { id: "removal", name: "Removal", min: 6 },
  { id: "tricks", name: "Combat tricks", min: 6 },
  { id: "protection", name: "Protection", min: 4 },
  { id: "flying", name: "Flying", min: 5 },
  { id: "lifegain", name: "Lifegain", min: 5 },
  { id: "counters", name: "+1/+1 counters", min: 4 },
  { id: "creatures", name: "Creatures", min: 12, max: 15 },
  { id: "size", name: "Cards in colour", min: 30, max: 30 },
] as Omit<Rule, "count" | "status" | "target">[]).map((r) => {
  const count = r.id === "size" ? CARDS.length : CARDS.filter((c) => c.rules.includes(r.id)).length;
  const max = r.max ?? Infinity;
  const off = count < r.min ? r.min - count : count > max ? count - max : 0;
  const status: Status = off === 0 ? "pass" : off === 1 ? "warn" : "fail";
  const target = r.max === undefined || r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
  return { ...r, count, status, target };
});

export const STATUS = { pass: "Pass", warn: "Close", fail: "Fail" } as const;
export const GLYPH = { pass: "✓", warn: "⚠", fail: "✕" } as const;

export const SECTIONS: { id: string; name: string; items: Scope[] }[] = [
  { id: "sec-cube", name: "Whole cube", items: [{ id: "cube", name: "Standard Limited All Stars", status: "fail", count: 435 }] },
  { id: "sec-colours", name: "Colours", items: [
    { id: "all-colours", name: "All colours", status: "fail", count: "3 rules" },
    { id: "white", name: "White", status: RULES.some((r) => r.status === "fail") ? "fail" : "pass", count: CARDS.length, pips: "W", desc: "Mono-white nonland cards. This mockup shows a 25-card sample from Foundations." },
    { id: "blue", name: "Blue", status: "pass", count: 65, pips: "U" },
    { id: "black", name: "Black", status: "fail", count: 61, pips: "B" },
    { id: "red", name: "Red", status: "warn", count: 62, pips: "R" },
    { id: "green", name: "Green", status: "pass", count: 59, pips: "G" },
    { id: "colourless", name: "Colourless", status: "pass", count: 26, pips: "C" },
    { id: "lands", name: "Lands", status: "warn", count: 55, pips: "N" },
  ] },
  { id: "sec-archetypes", name: "Archetypes", items: [
    { id: "all-archetypes", name: "All archetypes", status: "fail", count: "3 rules" },
    { id: "azorius", name: "Azorius Flying Tempo", status: "pass", count: 94, pips: "WU" },
    { id: "orzhov", name: "Orzhov Aristocrats", status: "pass", count: 62, pips: "WB" },
    { id: "boros", name: "Boros Go Wide Aggro", status: "warn", count: 50, pips: "RW" },
    { id: "selesnya", name: "Selesnya +1/+1 Counters", status: "warn", count: 52, pips: "GW" },
    { id: "dimir", name: "Dimir Graveyard", status: "pass", count: 63, pips: "UB" },
    { id: "izzet", name: "Izzet Spells", status: "fail", count: 130, pips: "UR" },
    { id: "simic", name: "Simic Ramp", status: "pass", count: 74, pips: "GU" },
    { id: "rakdos", name: "Rakdos Sacrifice", status: "pass", count: 67, pips: "BR" },
    { id: "golgari", name: "Golgari Graveyard", status: "pass", count: 51, pips: "BG" },
    { id: "gruul", name: "Gruul Ramp", status: "warn", count: 74, pips: "RG" },
  ] },
];
export const SCOPES = SECTIONS.flatMap((s) => s.items);
