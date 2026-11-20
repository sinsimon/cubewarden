/** Bundles src/browser.ts for the page: web/dist/cubewarden.js. */
import { build } from "esbuild";

await build({
  entryPoints: ["src/browser.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "web/dist/cubewarden.js",
  sourcemap: true,
  logLevel: "info",
});
