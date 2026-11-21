# Working on cubewarden

- Language: TypeScript, ESM, run directly by Node (type stripping, Node ≥ 22.18). No build step except the page bundle.
- Tests: `npm test`. Write the failing test first, at one of the four seams (syntax, evaluate, CubeCobra, workspace/CLI),
  through `src/index.ts` or `src/cli.ts`. Expected values come from hand-made fixtures (`test/fixtures/cards.ts`) or
  recorded CubeCobra JSON, never from the code under test.
- `src/index.ts` is also bundled for the browser: keep `node:` imports out of it (they live in `cli.ts`, `serve.ts`,
  `src/data/`).
- The engine has no built-in rules. A rule a designer wants ("3 gold per archetype") is data in their project.
- CubeCobra is read only. Rules travel in the cube's own text (`src/cubecobra.ts`).
- Win rates: cards carry `wrRaw` (GIH WR, a fraction, `wrraw` in text, percent) and `wrDelta` (WR Δ in points, `wr` in
  text): the adjusted WR minus the mean of its set's commons and uncommons, computed in the data step
  (`src/data/winrates.ts`, `src/data/publish.ts`). One name per quantity: the adjusted WR itself stays inside the
  data step.
- Project data (`cubewarden.json`, `cards.json`, `data.js`) and caches are gitignored: never commit someone's cube or
  third-party card data.
- The page (`web/index.html`) is built on Vaadin web components with the Aura theme (`web/ui.js`, bundled by
  `npm run build:web`; see `docs/design-systems.md`). It calls the engine through `window.CubeEngine` (built by `src/browser.ts`) and exposes
  `window.cubewarden` for agents; keep the CLI, `window.cubewarden`, WebMCP tools and `web/llms.txt` in step.
