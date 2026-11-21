# cubewarden

Keep a Magic: The Gathering cube balanced against **rules you write yourself**: for the whole cube, for each colour
and for each archetype. Import a cube from CubeCobra, write the rules, then edit the list until they pass. Changes go
back to CubeCobra as a changelist or a CSV.

cubewarden ships no rules of its own. "At most 360 cards", "3 gold cards per archetype" or "average win rate between
54% and 62%" are rules a designer writes for their cube.

## Rules in one minute

A rule is a **scope**, a **measure** and a **target**, written as text:

```
count() <= 360                                  whole cube: at most 360 cards
every(s:fdn,trk,dft)                            every card printed in one of these sets
count(t:creature) >= 55%                        each colour: at least 55% creatures
count(c=scope -is:hybrid) = 3 fixed             each archetype: exactly 3 gold cards (never scaled)
avg(wr, member:any) in 55%..60%                 archetype members average 55–60% adjusted win rate
otag:counterspell >= 4                          blue: at least 4 counterspells
curve(t:creature) 1:1..3 2:5..7 3:4..6 6+:0..2  creatures per mana value (6+ = six and above)
curve(t:creature) 2:20%..30% 3:15%..25%         the same in percent of the creatures
curve(-t:land) 1-2:8..12 3-4:6..9 5+:2..4       a bucket can cover a range of mana values (1-2 = one or two)
```

An **archetype** is 2 to 5 colours, a name and **mechanics**: a mechanic is a filter (with AND, OR, groups and NOT)
plus an optional target. Filters use CubeCobra and Scryfall syntax (`otag:`, `t:`, `o:`, `kw:`, `mv`, `c=`…).
`cubewarden syntax` prints the whole syntax.

Rules are **primary** (they must pass) or **secondary** (warnings). Counts in a colour or archetype can be read as if
the cube already had its target size.

## Use it

```sh
npx cubewarden import <CubeCobra cube id>     # cubewarden.json: rules + card list (rules restored if saved)
npx cubewarden data build                     # cards.json: card data for the cube and the cards you may add
npx cubewarden serve                          # the workbench on http://localhost:3300
npx cubewarden check                          # every rule not met; exit code 1 when a primary rule fails
```

Until cubewarden is on npm, run it from a clone: `git clone https://github.com/sinsimon/cubewarden && cd cubewarden
&& npm install && npm link`, then use `cubewarden` instead of `npx cubewarden`.

The workbench keeps your work in the browser. Changes → "Download project file" hands it to the command line, and
"Open project file" loads one an agent changed.

### Saving rules inside CubeCobra

CubeCobra has no write API. Overview → "About for CubeCobra" builds the text to paste into your cube's overview. It
ends with one hidden line (`[cubewarden-v1]: cw:…`, a markdown link definition CubeCobra never displays) that holds
your rules, so importing the cube again restores them.

## For AI agents

Every operation is available in three places, with the same names and results:

- **Command line**: `cubewarden check | explain | search | try | apply | rules | rule set | changes | about | export`,
  with `--json` and exit codes (0 ok, 1 primary rules not met, 2 bad input).
- **In the page**: `window.cubewarden` (`check()`, `explain(id)`, `search(filter)`, `tryChanges({add, remove})`,
  `applyChanges(…)`, `rules()`, `setRule(…)`), for agents that drive a browser.
- **WebMCP**: where the browser supports it, the page registers the same operations as tools (`cubewarden_check`…).

[`web/llms.txt`](web/llms.txt) is the agent-facing summary; [`skills/cubewarden/SKILL.md`](skills/cubewarden/SKILL.md)
is a ready-made skill for agent harnesses.

## Card data

| Data | Source |
|---|---|
| Oracle text, types, costs, images, printings | [Scryfall](https://scryfall.com/docs/api) |
| Oracle tags (functional tags), ELO, cube count, picks | [CubeCobra](https://cubecobra.com) card details (read only) |
| Win rates (optional) | [17Lands](https://www.17lands.com); adjusted WR = GIH WR minus the strength of the decks the card was played in |

`cubewarden data build` takes the pool from the sets your cube's "every card" rule allows (or `--pool "<Scryfall
query>"`). Win rates are optional: `--winrates <file>` reads precomputed win rates, `--winrates 17lands` reads 17Lands'
public card ratings, which today only carry games for sets still being drafted. Data is fetched on your computer
and cached in `.cache/` (`--refresh` to fetch again). Nothing is written to CubeCobra.

## Hosting

The public site (Vercel) is the page alone: `npm run build:site` without a project folder builds it, and
`vercel.json` serves the card data from this repo's `data` branch at `/data`. A nightly GitHub Action
(`.github/workflows/data.yml`) rebuilds that branch: one JSON file per released set with 17Lands Premier Draft
data, rebuilt only when something changed. People's cubes never leave their browser.

## Develop

```sh
npm install
npm test            # vitest
npm run typecheck
npm run build:web   # bundles src/browser.ts and the page's Vaadin components (web/ui.js) into web/dist/
```

`src/` is the engine (no I/O except `cli.ts`, `serve.ts` and `src/data/`). Tests sit on four public seams: the rule
syntax, rule evaluation, CubeCobra import/export, and the workspace API behind the CLI and the page.

## License

MIT
