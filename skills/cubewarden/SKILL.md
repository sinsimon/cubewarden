---
name: cubewarden
description: Check and edit a Magic the Gathering cube against the designer's own rules (whole cube, colours, archetypes) with the cubewarden CLI or the cubewarden page. Use when asked to balance a cube, check cube rules, find cards to add or cut for an archetype or colour, or write cube rules.
---

# cubewarden

The cube lives in a project folder: `cubewarden.json` (rules + card list) and `cards.json` (card data).
If the person has the page open (`cubewarden serve`), work in the page through `window.cubewarden` so they see your
changes; otherwise use the CLI in the project folder.

## Loop

1. `cubewarden check --json`: what is not met. `failing` = primary rules, `warnings` = secondary.
2. `cubewarden explain <id> --json`: the value, the target and the cards behind one rule or mechanic.
3. `cubewarden search "<filter>" --scope <colour or archetype id> --json`: candidates outside the cube. Only cards the
   cube's "every card" rules allow. Default order: most used on CubeCobra (`--sort cubes`); `--sort wr` for win rate.
   With `--scope`, `member:<mechanic id>` or `member:any` finds cards that fit that colour's or archetype's mechanics.
4. `cubewarden try --add "<card>" --remove "<card>" --json`: the effect on every rule. Nothing is saved.
5. Show the person the swap and its effect. Run `cubewarden apply …` only after they agree.
   Cards the person wants to keep in view without counting them go to the maybeboard: `cubewarden maybeboard --add "<card>"`,
   or `cubewarden apply --remove "<card>" --to-maybeboard` for a cut.

## Rules

`cubewarden syntax` prints the syntax. Write rules with `cubewarden rule set <id> --scope <scope> --name "<name>" --text "<rule>"`.
Scopes: `cube`, `color:W`…`color:G`, `color:C`, `color:L`, `archetype:<id>`, `allColors`, `allArchetypes`.
Every rule is the person's: never add one they did not ask for.

## Rules of conduct

- Nothing is written to CubeCobra. To publish, give the person `cubewarden changes` (a changelist) or
  `cubewarden export csv`, and `cubewarden about` (About text whose last line stores the rules).
- Win rates are a choice of the designer, not a quality score: do not suggest cuts by win rate unless a rule says so.
- `wr` is the WR Δ in points above (+) or below (−) the average common or uncommon of the card's set
  (`avg(wr, member:any) in 1..3.5`, `wr>=1.5`); `wrraw` is the raw GIH WR in percent. Never write `wr` in percent.
