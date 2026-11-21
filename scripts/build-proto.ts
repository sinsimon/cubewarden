/**
 * Bundles the React mockups (committed, served as is):
 *   web/proto/react-aria.tsx -> web/proto/react-aria.js
 *   web/proto/mantine.tsx    -> web/proto/mantine.js + mantine.css
 */
import { build } from "esbuild";

await build({
  entryPoints: ["web/proto/react-aria.tsx", "web/proto/mantine.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  jsx: "automatic",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  outdir: "web/proto",
  logLevel: "info",
});
