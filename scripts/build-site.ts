/**
 * Static site: site/ = the page, its bundle and llms.txt.
 *   node scripts/build-site.ts                      hosted build (Vercel): card data from /data (the data branch)
 *   node scripts/build-site.ts <project folder>     one project's cube and cards baked into data.js
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataJs } from "../src/serve.ts";

const project = process.argv[2] ? resolve(process.argv[2]) : null;
const out = resolve("site");
// Keep site/.vercel (the link to the Vercel project); replace everything else.
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) if (f !== ".vercel") await rm(join(out, f), { recursive: true, force: true });
await mkdir(join(out, "dist"), { recursive: true });
await cp("web/llms.txt", join(out, "llms.txt"));
await cp("web/dist", join(out, "dist"), { recursive: true });
let html = await readFile("web/index.html", "utf8");
if (project) await writeFile(join(out, "data.js"), await dataJs(join(project, "cubewarden.json"), join(project, "cards.json")));
else html = html.replace('<script src="data.js"></script>\n', "");
await writeFile(join(out, "index.html"), html);
console.log(project ? `site/ built from ${project}` : "site/ built for hosting (card data from /data)");
