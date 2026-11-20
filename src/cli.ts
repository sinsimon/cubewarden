/**
 * cubewarden command line: the workspace API for people and agents. Files: a project (cubewarden.json:
 * rules + card list) and a card database (cards.json). Exit codes: 0 = done / all primary rules met,
 * 1 = check found primary rules not met, 2 = bad input.
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Card } from "./model.ts";
import { aboutMarkdown } from "./about.ts";
import { fetchCubeCobra } from "./cubecobra.ts";
import { exportCsv, mechanicTags } from "./export.ts";
import { SYNTAX_HELP } from "./syntax-help.ts";
import { createWorkspace, type Finding, type Project, type SortKey } from "./workspace.ts";

export interface Io { cwd: string; write: (s: string) => void; fetch?: typeof fetch }

const HELP = `cubewarden: keep a cube balanced against your own rules.

Usage: cubewarden <command> [options]   (--project cubewarden.json --cards cards.json --json)

  check                         every rule and mechanic not met; exit 1 if a primary one is not met
  explain <rule id>             a rule's value, target and the cards behind it
  search "<filter>"             cards outside the cube that match (--scope W|wu, --limit 50,
                                --sort cubes|elo|picks|wr|wrraw|mv|name (default cubes: most used on
                                CubeCobra), --all-cards to ignore the cube's "every card" rules)
  try --add <card> --remove <card>    effect of a swap on every rule, without saving
  apply --add <card> --remove <card>  make the swap and save the project
  rules                         every rule as text
  rule set <id> --text "<rule>" [--scope color:W] [--name "…"] [--priority secondary]
  rule rm <id>
  changes                       adds and removes against the imported list
  about [--numbers] [--cube-id <id>]  About text for CubeCobra, ending with the hidden rules line
  export csv                    the whole list as a CSV for CubeCobra, with mechanic tags
  import <CubeCobra id> [--force]  start a project from a public CubeCobra cube (read only); --force replaces
                                an existing project in this folder
  serve [--port 3300]           open the page on this project, for you and for agents in the browser
  data build [--winrates <file>|17lands] [--pool "<Scryfall query>"] [--refresh]
                                cards.json: the cube's cards and every card you may add (see data help)
  syntax                        the filter and rule syntax
`;

interface Args { _: string[]; flags: Record<string, string[]>; bool: Set<string> }
const BOOL = new Set(["json", "numbers", "all-cards", "help", "force", "refresh"]);
function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], flags: {}, bool: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const k = t.slice(2);
      if (BOOL.has(k)) a.bool.add(k);
      else (a.flags[k] ||= []).push(argv[++i] ?? "");
    } else a._.push(t);
  }
  return a;
}

class UsageError extends Error {}

export async function run(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const flag = (k: string) => args.flags[k]?.at(-1);
  const json = args.bool.has("json");
  const out = (v: unknown, text: string) => io.write((json ? JSON.stringify(v, null, 2) : text) + "\n");
  const projectPath = resolve(io.cwd, flag("project") || "cubewarden.json");
  const cardsPath = resolve(io.cwd, flag("cards") || "cards.json");

  async function load() {
    const project: Project = JSON.parse(await readFile(projectPath, "utf8"));
    const raw = JSON.parse(await readFile(cardsPath, "utf8"));
    const list: Card[] = Array.isArray(raw) ? raw : raw.cards;
    return createWorkspace(project, Object.fromEntries(list.map((c) => [c.id, c])));
  }
  const save = (p: Project) => writeFile(projectPath, JSON.stringify(p, null, 1) + "\n");
  const line = (f: Finding) => `  ${f.scope} · ${f.name}: ${f.value ?? "?"} (target ${f.target}) ${f.status}${f.error ? " — " + f.error : ""}\n      ${f.rule}`;

  try {
    const [cmd, ...rest] = args._;
    switch (cmd) {
      case undefined: case "help": io.write(HELP); return 0;
      case "syntax": io.write(SYNTAX_HELP); return 0;
      case "check": {
        const r = (await load()).check();
        const text = [
          `${r.size} cards${r.targetSize ? ` (target ${r.targetSize})` : ""}: ${r.ok ? "every primary rule is met" : `${r.failing.length} primary rule(s) not met`}`,
          ...(r.failing.length ? ["Not met:", ...r.failing.map(line)] : []),
          ...(r.warnings.length ? ["Warnings (secondary):", ...r.warnings.map(line)] : []),
        ].join("\n");
        out(r, text);
        return r.ok ? 0 : 1;
      }
      case "explain": {
        if (!rest[0]) throw new UsageError("explain needs a rule id (see `cubewarden rules`)");
        const e = (await load()).explain(rest[0]);
        const text = [line(e).trimStart(), ...(e.byScope || []).map((s) => `  ${s.scope}: ${s.value ?? "?"} ${s.status}`),
          ...e.cards.map((c) => `  ${c.name}${typeof c.value === "number" ? ` — ${c.value}` : ""}`)].join("\n");
        out(e, text);
        return 0;
      }
      case "search": {
        if (!rest[0]) throw new UsageError('search needs a filter, e.g. cubewarden search "otag:removal c=w"');
        const r = (await load()).search(rest[0], { scope: flag("scope"), limit: flag("limit") ? Number(flag("limit")) : undefined, respectCubeRules: !args.bool.has("all-cards"), sort: flag("sort") as SortKey | undefined });
        out(r, [`${r.total} card(s)`, ...r.cards.map((c) => `  ${c.name} (${c.colors || "C"}, mv ${c.mv}${c.wrAdj != null ? `, wr ${(c.wrAdj * 100).toFixed(1)}%` : ""})`)].join("\n"));
        return 0;
      }
      case "try": case "apply": {
        const w = await load();
        const ch = { add: args.flags.add || [], remove: args.flags.remove || [] };
        if (!ch.add.length && !ch.remove.length) throw new UsageError(`${cmd} needs --add and/or --remove`);
        const d = cmd === "try" ? w.tryChanges(ch) : w.applyChanges(ch);
        if (cmd === "apply") await save(w.project);
        out(d, [`Size ${d.size.before} → ${d.size.after}${cmd === "apply" ? " (saved)" : " (not saved)"}`,
          ...d.changed.map((c) => `  ${c.scope} · ${c.name}: ${c.before.value} ${c.before.status} → ${c.after.value} ${c.after.status}`)].join("\n"));
        return 0;
      }
      case "rules": {
        const r = (await load()).rules();
        out(r, r.map((x) => `${x.id}  ${x.scope}  ${x.priority}  ${x.name}: ${x.text}`).join("\n"));
        return 0;
      }
      case "rule": {
        const w = await load();
        if (rest[0] === "set" && rest[1]) {
          const r = w.setRule({ id: rest[1], text: flag("text"), scope: flag("scope"), name: flag("name"), priority: flag("priority") as "primary" | undefined, description: flag("description") });
          await save(w.project);
          out(r, `saved ${r.id}: ${r.text}`);
          return 0;
        }
        if (rest[0] === "rm" && rest[1]) { w.removeRule(rest[1]); await save(w.project); out({ removed: rest[1] }, `removed ${rest[1]}`); return 0; }
        throw new UsageError('use: rule set <id> --text "<rule>" … or rule rm <id>');
      }
      case "changes": {
        const c = (await load()).changes();
        out(c, c.text);
        return 0;
      }
      case "about": {
        const w = await load();
        io.write(await aboutMarkdown(w.project.config, w.report(), { numbers: args.bool.has("numbers"), cubeId: flag("cube-id") || w.project.cubeId }));
        return 0;
      }
      case "export": {
        if (rest[0] !== "csv") throw new UsageError("use: export csv");
        const w = await load();
        io.write(exportCsv(w.project.current, w.cardsById, { tags: mechanicTags(w.project.config, w.report()) }) + "\n");
        return 0;
      }
      case "import": {
        if (!rest[0]) throw new UsageError("import needs a CubeCobra cube id");
        for (const p of [projectPath, cardsPath]) {
          if (!args.bool.has("force") && existsSync(p)) throw new UsageError(`${p} already exists: import would replace it. Use another folder, or --force to replace it.`);
        }
        const cube = await fetchCubeCobra(rest[0], {}, io.fetch ?? fetch);
        const project: Project = {
          version: 1, cubeId: cube.id, original: cube.mainboard, current: [...cube.mainboard],
          config: cube.config ?? { version: 1, cube: { name: cube.name }, colors: "WUBRGCL".split("").map((code) => ({ code: code as "W", mechanics: [] })), archetypes: [], rules: [] },
        };
        await save(project);
        await writeFile(cardsPath, JSON.stringify(Object.values(cube.cards)) + "\n");
        out({ cubeId: cube.id, cards: cube.mainboard.length, rulesRestored: !!cube.config },
          `Imported "${cube.name}": ${cube.mainboard.length} cards, ${cube.config ? "rules restored from the cube's text" : "no saved rules found"}.\n` +
          (cube.duplicates ? `${cube.duplicates} repeated card(s) counted once.\n` : "") +
          `cards.json now holds the cube's cards only. Next: cubewarden data build, which adds the cards you may add\n` +
          `(from the sets your rules allow, e.g. cubewarden rule set sets --scope cube --name "Sets" --text "every(s:fdn,tla)",\n` +
          `or with --pool "<Scryfall query>"). Then cubewarden check, or cubewarden serve for the page.`);
        return 0;
      }
      case "data": {
        const { runDataCommand } = await import("./data/command.ts");
        return await runDataCommand(argv.slice(argv.indexOf("data") + 1), io);
      }
      case "serve": {
        const { serve } = await import("./serve.ts");
        await serve({ cwd: io.cwd, project: flag("project"), cards: flag("cards"), port: flag("port") ? Number(flag("port")) : undefined, write: io.write });
        return await new Promise<number>(() => {});
      }
      default:
        throw new UsageError(`Unknown command "${cmd}". Run cubewarden help.`);
    }
  } catch (e) {
    io.write((e instanceof Error ? e.message : String(e)) + "\n");
    return 2;
  }
}
