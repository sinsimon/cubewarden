/** The About text to paste into a CubeCobra cube: descriptions, archetypes, optional current numbers, and the saved rules. */
import type { Config, Mechanic, Rule } from "./model.ts";
import type { Report, Result } from "./evaluate.ts";
import { WUBRG } from "./colors.ts";
import { formatConstraint } from "./constraint.ts";
import { encodeRules, cubeCobraListUrl } from "./cubecobra.ts";
import { pct } from "./fields.ts";
import { toScryfall, type ScryfallScope } from "./scryfall.ts";

export const REPO_URL = "https://github.com/sinsimon/cubewarden";
const COLOR_NAME: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colourless", L: "Lands" };

export interface AboutOptions {
  cube?: boolean;
  colors?: boolean;
  archetypes?: boolean;
  /** List each archetype's primary mechanics (when numbers are off). */
  mechanics?: boolean;
  /** Current count of each mechanic, with links. */
  numbers?: boolean;
  /** Rules that have a description, as "Design rules". */
  rules?: boolean;
  /** End with the hidden line that stores the rules (default true). */
  saveRules?: boolean;
  /** CubeCobra cube id, for "see on CubeCobra" links. */
  cubeId?: string | null;
  /** Allowed sets, added to Scryfall links. */
  sets?: string[];
}

const mana = (colors: string) => [...colors].map((c) => `{${c}}`).join("");
const mdUrl = (u: string) => u.replace(/\(/g, "%28").replace(/\)/g, "%29");
const oneLine = (s: string) => s.trim().replace(/\s*\n\s*/g, " ");

function valueText(x: Result, report: Report): string {
  if (x.status === "error" || x.value == null) return "error";
  if (x.constraint?.unit === "percent") return `${x.value}%`;
  if (x.measure.kind === "avg") return x.measure.metric.startsWith("wr") ? pct(x.value) : x.value.toFixed(2);
  const scaled = x.measure.kind === "count" && !x.measure.absolute && report.factor !== 1;
  return `${x.value} cards${scaled ? ` at ${report.targetSize}` : ""}`;
}

function mechanicLines(mechs: Mechanic[], results: Result[], prefix: string, scope: ScryfallScope, report: Report, o: AboutOptions): string[] {
  return mechs.map((m) => {
    const x = results.find((y) => y.id === m.id);
    if (!x) return `- ${m.name}`;
    const links: string[] = [];
    if (o.cubeId) links.push(`[see on CubeCobra](${mdUrl(cubeCobraListUrl(o.cubeId, `tag:"${prefix} ${m.name}"`))})`);
    const sq = toScryfall(m.filter, { scope, sets: o.sets });
    if (sq.query) links.push(`[Scryfall](${mdUrl(sq.url)})`);
    const target = x.constraint ? ` (target ${formatConstraint(x.constraint)})` : "";
    return `- ${m.name}: ${valueText(x, report)}${target}${links.length ? " · " + links.join(" · ") : ""}`;
  });
}

function scopeLabel(r: Rule, config: Config): string {
  const sc = r.scope;
  if (sc.kind === "allColors") return "each colour";
  if (sc.kind === "allArchetypes") return "each archetype";
  if (sc.kind === "cube") return "whole cube";
  if (sc.kind === "color") return COLOR_NAME[sc.color] || sc.color;
  return config.archetypes.find((a) => a.id === sc.id)?.name || "archetype";
}

export async function aboutMarkdown(config: Config, report: Report, opts: AboutOptions = {}): Promise<string> {
  const o: AboutOptions = { cube: true, colors: true, archetypes: true, mechanics: true, numbers: false, rules: false, saveRules: true, ...opts };
  const out: string[] = [`# ${config.cube.name || "My cube"}`, ""];
  if (o.cube && config.cube.description?.trim()) out.push(config.cube.description.trim(), "");
  if (o.colors) {
    const cols = config.colors.filter((c) => c.description?.trim() || (o.numbers && c.mechanics?.length));
    if (cols.length) {
      out.push("## Colours", "");
      for (const c of cols) {
        const label = `${COLOR_NAME[c.code] || c.code}${WUBRG.includes(c.code) ? " " + mana(c.code) : ""}`;
        if (o.numbers) {
          out.push(`### ${label}`, "");
          if (c.description?.trim()) out.push(c.description.trim(), "");
          if (c.mechanics?.length) out.push(...mechanicLines(c.mechanics, report.colors[c.code]?.mechanics || [], c.code, { kind: "color", color: c.code }, report, o), "");
        } else out.push(`- **${label}**: ${oneLine(c.description || "")}`);
      }
      out.push("");
    }
  }
  if (o.archetypes) {
    const arcs = config.archetypes.filter((a) => a.name?.trim());
    if (arcs.length) {
      out.push("## Archetypes", "");
      for (const a of arcs) {
        out.push(`### ${a.name.trim()} ${mana(a.colors)}`, "");
        if (a.description?.trim()) out.push(a.description.trim(), "");
        if (o.numbers && a.mechanics.length) {
          out.push(...mechanicLines(a.mechanics, report.archetypes[a.id]?.mechanics || [], a.colors, { kind: "archetype", colors: a.colors }, report, o), "");
        } else if (o.mechanics) {
          const mech = a.mechanics.filter((m) => m.priority !== "secondary");
          if (mech.length) out.push(...mech.map((m) => `- ${m.name}`), "");
        }
      }
    }
  }
  if (o.rules) {
    const rules = config.rules.filter((r) => r.description?.trim());
    if (rules.length) {
      out.push("## Design rules", "");
      for (const r of rules) out.push(`- **${r.name}** (${scopeLabel(r, config)}): ${oneLine(r.description!)}`);
      out.push("");
    }
  }
  out.push("", `*Rules checked with [cubewarden](${REPO_URL}).*`);
  if (o.saveRules) out.push("", await encodeRules(config, { hidden: true }));
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
