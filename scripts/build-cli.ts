/** Bundles the command line for the npm package: dist/cli.js (Node does not strip types under node_modules). */
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/cli.js",
  external: ["esbuild"],
  logLevel: "info",
});
