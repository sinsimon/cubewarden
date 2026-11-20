/**
 * Static site for hosting (e.g. Vercel): site/ = the page, its bundle, llms.txt and data.js built from a project
 * folder (cubewarden.json + cards.json). Usage: node scripts/build-site.ts <project folder>
 */
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dataJs } from "../src/serve.ts";

const project = resolve(process.argv[2] || ".");
const out = resolve("site");
// Keep site/.vercel (the link to the Vercel project); replace everything else.
await mkdir(out, { recursive: true });
for (const f of await readdir(out)) if (f !== ".vercel") await rm(join(out, f), { recursive: true, force: true });
await mkdir(join(out, "dist"), { recursive: true });
for (const f of ["index.html", "llms.txt"]) await cp(join("web", f), join(out, f));
await cp("web/dist", join(out, "dist"), { recursive: true });
await writeFile(join(out, "data.js"), await dataJs(join(project, "cubewarden.json"), join(project, "cards.json")));
console.log(`site/ built from ${project}`);
