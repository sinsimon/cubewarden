/**
 * `cubewarden data build`: writes the project's cards.json. Exit codes as the rest of the CLI:
 * 0 = done, 2 = bad input or a source that failed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Project } from "../workspace.ts";
import { BuildError, buildCards, provenanceText } from "./build.ts";

export const DATA_HELP = `  data build                    write cards.json: the cube's cards plus every card that may be added
                                (Scryfall, CubeCobra tags and stats). Pool = the sets of the cube's
                                "every card: set in …" rule, or --pool "<Scryfall query>".
                                --winrates <file> | 17lands   add 17Lands win rates (default: none)
                                --refresh                     ignore the .cache/ folder next to the project
`;

interface DataArgs { _: string[]; flags: Record<string, string>; bool: Set<string> }
const BOOL = new Set(["refresh", "json"]);

function parse(argv: string[]): DataArgs {
  const a: DataArgs = { _: [], flags: {}, bool: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) a._.push(t);
    else if (BOOL.has(t.slice(2))) a.bool.add(t.slice(2));
    else a.flags[t.slice(2)] = argv[++i] ?? "";
  }
  return a;
}

async function readProject(path: string): Promise<Project | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** `args` = what follows `data` on the command line, e.g. ["build", "--winrates", "17lands"]. */
export async function runDataCommand(args: string[], io: { cwd: string; write: (s: string) => void }): Promise<number> {
  const a = parse(args);
  if (a._[0] !== "build") {
    io.write("use: cubewarden data build [--pool \"<Scryfall query>\"] [--winrates <file>|17lands] [--refresh]\n");
    return 2;
  }
  const projectPath = resolve(io.cwd, a.flags.project || "cubewarden.json");
  const cardsPath = resolve(io.cwd, a.flags.cards || "cards.json");
  try {
    const project = await readProject(projectPath);
    if (!project && !a.flags.pool) throw new BuildError(`No project at ${projectPath}: run cubewarden import first, or pass --pool.`);
    const winrates = a.flags.winrates && a.flags.winrates !== "17lands" ? resolve(io.cwd, a.flags.winrates) : a.flags.winrates;
    const r = await buildCards({
      project, pool: a.flags.pool, winrates, refresh: a.bool.has("refresh"),
      cacheDir: resolve(dirname(projectPath), ".cache"), log: (s) => process.stderr.write(s + "\n"),
    });
    await writeFile(cardsPath, JSON.stringify(r.cards) + "\n");
    io.write((a.bool.has("json") ? JSON.stringify(r.provenance, null, 2) : `Wrote ${cardsPath}\n${provenanceText(r.provenance)}`) + "\n");
    return 0;
  } catch (e) {
    io.write((e instanceof Error ? e.message : String(e)) + "\n");
    return 2;
  }
}
