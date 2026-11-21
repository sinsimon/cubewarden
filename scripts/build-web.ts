/**
 * Bundles the page scripts into web/dist/:
 *   cubewarden.js  the engine (src/browser.ts);
 *   ui.js          the Vaadin web components the page uses (web/ui.js);
 *   aura/          the Aura theme stylesheet and its font.
 */
import { cp, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build, type Plugin } from "esbuild";

await build({
  entryPoints: ["src/browser.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "web/dist/cubewarden.js",
  sourcemap: true,
  logLevel: "info",
});

// Vaadin's development-time usage statistics: always bundle the opt-out module, whatever npm's install scripts did.
const require = createRequire(import.meta.url);
const statsDir = dirname(require.resolve("@vaadin/vaadin-usage-statistics/package.json"));
const noUsageStats: Plugin = {
  name: "no-vaadin-usage-statistics",
  setup(b) {
    b.onResolve({ filter: /^@vaadin\/vaadin-usage-statistics(\/vaadin-usage-statistics(\.js)?)?$/ }, () => ({
      path: join(statsDir, "vaadin-usage-statistics-optout.js"),
    }));
  },
};

await build({
  entryPoints: ["web/ui.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: "web/dist/ui.js",
  legalComments: "linked",
  plugins: [noUsageStats],
  logLevel: "info",
});
if ((await readFile("web/dist/ui.js", "utf8")).includes("usage-stats/submit")) {
  throw new Error("web/dist/ui.js contains Vaadin's usage statistics collector");
}

const aura = dirname(require.resolve("@vaadin/aura/package.json"));
await cp(join(aura, "dist"), "web/dist/aura", { recursive: true });
// Licences travel with the files: Aura (Apache-2.0) and its Instrument Sans font (SIL OFL).
await cp(join(aura, "LICENSE"), "web/dist/aura/LICENSE");
await cp(join(aura, "src/fonts/InstrumentSans/LICENSE.txt"), "web/dist/aura/fonts/InstrumentSans/LICENSE.txt");
