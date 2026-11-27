/** Changes and exports for CubeCobra. */
import type { Card, Config } from "./model.ts";
import type { Report } from "./evaluate.ts";

export interface Diff { adds: string[]; removes: string[] }

export function diff(originalIds: string[], currentIds: string[]): Diff {
  const o = new Set(originalIds), c = new Set(currentIds);
  return { adds: currentIds.filter((id) => !o.has(id)), removes: originalIds.filter((id) => !c.has(id)) };
}

/** Plain changelist to apply by hand on CubeCobra. */
export function changelist(d: Diff, cardsById: Record<string, Card>, opts: { maybeboard?: string[]; printings?: { name: string; from: string; to: string }[] } = {}): string {
  const name = (id: string) => cardsById[id]?.name ?? id;
  const lines = [`Changes: ${d.adds.length} in, ${d.removes.length} out`, ""];
  if (d.removes.length) lines.push("Remove:", ...d.removes.map((id) => "- " + name(id)), "");
  const withPrint = (id: string) => {
    const c = cardsById[id];
    return "+ " + name(id) + (c?.set ? ` (${c.set.toUpperCase()}) ${c.number || ""}`.trimEnd() : "");
  };
  if (d.adds.length) lines.push("Add:", ...d.adds.map(withPrint), "");
  if (opts.maybeboard?.length) lines.push("Maybeboard:", ...opts.maybeboard.map(withPrint), "");
  // A printing change is not an add or a remove: change the printing on CubeCobra, or upload the CSV.
  if (opts.printings?.length) lines.push("Printings:", ...opts.printings.map((x) => `~ ${x.name}: ${x.from} → ${x.to}`));
  return lines.join("\n").trimEnd();
}

/** The whole list as a CSV for CubeCobra's "Replace with CSV file upload". tags = { cardId: ["UG Ramp", …] }. */
export function exportCsv(ids: string[], cardsById: Record<string, Card>, opts: { tags?: Record<string, string[]>; maybeboard?: string[] } = {}): string {
  const tags = opts.tags || {};
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["name", "CMC", "Type", "Color", "Set", "Collector Number", "Rarity", "Color Category", "status", "Finish", "maybeboard",
    "image URL", "image Back URL", "tags", "Notes", "MTGO ID"].join(",")];
  const row = (id: string, maybe: boolean) => {
    const c = cardsById[id];
    if (c) rows.push([q(c.name), c.mv, q(c.type), c.colors, c.set || "", c.number || "", c.rarity || "", "", "Owned", "Non-foil", String(maybe), "", "",
      q((tags[id] || []).join(";")), "", ""].join(","));
  };
  ids.forEach((id) => row(id, false));
  (opts.maybeboard || []).forEach((id) => row(id, true));
  return rows.join("\n");
}

/** One CubeCobra tag per mechanic a card matches: "WU Flyers", "U Counterspells". */
export function mechanicTags(config: Config, report: Report): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (ids: string[], tag: string) => ids.forEach((id) => (out[id] ||= []).push(tag));
  for (const a of config.archetypes) {
    const r = report.archetypes[a.id];
    if (r && a.name) r.mechanics.forEach((m) => add(m.cards, `${a.colors} ${m.name}`));
  }
  for (const c of config.colors) report.colors[c.code]?.mechanics.forEach((m) => add(m.cards, `${c.code} ${m.name}`));
  return out;
}
