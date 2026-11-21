/** Bundles the React Aria mockup: web/proto/react-aria.tsx -> web/proto/react-aria.js (committed, served as is). */
import { build } from "esbuild";

await build({
  entryPoints: ["web/proto/react-aria.tsx"],
  bundle: true,
  minify: true,
  format: "esm",
  jsx: "automatic",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  outfile: "web/proto/react-aria.js",
  logLevel: "info",
});
