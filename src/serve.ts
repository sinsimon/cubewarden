/**
 * `cubewarden serve`: the page on this computer, on the project in a folder. The page reads the project's cards
 * and starting cube from /data.js; the person's work stays in the browser (localStorage), and "Download project
 * file" hands it back to the command line.
 */
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SOURCES } from "./sources.ts";
import type { Project } from "./workspace.ts";

const WEB = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".map": "application/json",
  ".txt": "text/plain; charset=utf-8", ".json": "application/json", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

async function ensureBundle() {
  // The page's Vaadin components and theme ship prebuilt in the npm package; a clone builds them once.
  if (!existsSync(join(WEB, "dist/ui.js")) || !existsSync(join(WEB, "dist/aura/aura.css"))) {
    throw new Error(`Missing ${join(WEB, "dist/ui.js")}: run npm install and npm run build:web in the cubewarden folder first`);
  }
  if (existsSync(join(WEB, "dist/cubewarden.js"))) return;
  const { build } = await import("esbuild");
  await build({ entryPoints: [fileURLToPath(new URL("./browser.ts", import.meta.url))], bundle: true, format: "iife", target: "es2022", outfile: join(WEB, "dist/cubewarden.js") });
}

export async function dataJs(projectPath: string, cardsPath: string): Promise<string> {
  const project: Project = JSON.parse(await readFile(projectPath, "utf8"));
  const raw = JSON.parse(await readFile(cardsPath, "utf8"));
  const cards = Array.isArray(raw) ? raw : raw.cards;
  const built = (await stat(cardsPath)).mtime.toISOString().slice(0, 10);
  const data = {
    builtAt: built, cards, sources: SOURCES,
    // The cube's CubeCobra id travels with the rules, so the hosted page can reload the cube's cards later.
    seed: project.cubeId ? { ...project.config, cube: { ...project.config.cube, cubeCobraId: project.cubeId } } : project.config,
    cube: { name: project.config.cube?.name || "My cube", source: project.cubeId ? `CubeCobra cube ${project.cubeId}` : projectPath,
      original: project.original, current: project.current },
  };
  return "window.CUBE_DATA = " + JSON.stringify(data) + ";\n";
}

export async function serve(opts: { cwd: string; project?: string; cards?: string; port?: number; write: (s: string) => void }): Promise<Server> {
  const projectPath = resolve(opts.cwd, opts.project || "cubewarden.json");
  const cardsPath = resolve(opts.cwd, opts.cards || "cards.json");
  for (const p of [projectPath, cardsPath]) if (!existsSync(p)) throw new Error(`Missing ${p}: run cubewarden import <CubeCobra id> and cubewarden data build first`);
  await ensureBundle();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/data.js") {
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
        res.end(await dataJs(projectPath, cardsPath));
        return;
      }
      const rel = normalize(url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, ""));
      const file = join(WEB, rel);
      if (!file.startsWith(WEB) || !existsSync(file)) { res.writeHead(404).end("Not found"); return; }
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(await readFile(file));
    } catch (e) {
      res.writeHead(500).end(String((e as Error).message));
    }
  });
  const port = opts.port ?? 3300;
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(port, "127.0.0.1", ok); });
  opts.write(`cubewarden on http://localhost:${port} (project ${projectPath}). Ctrl+C to stop.\n`);
  return server;
}
