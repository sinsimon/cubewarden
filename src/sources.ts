/** Where each kind of data comes from, in one plain sentence (shown in the page and in llms.txt). */
export const SOURCES: Record<string, string> = {
  cards: "Scryfall: oracle text, types, mana cost, images (api.scryfall.com, cached).",
  tags: "Scryfall Tagger oracle tags (otag:), the community's functional labels for each card, read through CubeCobra.",
  wrRaw: "17Lands GIH WR: win rate of Premier Draft games where the card was drawn or in the opening hand (17Lands Public Datasets, CC BY 4.0).",
  wrAdj: "Adjusted WR: GIH WR minus the average win rate of the decks (colour pairs) the card was played in, plus the set average.",
  cube: "CubeCobra public cube JSON (cubecobra.com/cube/api/cubeJSON/<id>).",
  cubecobra: "CubeCobra card data: ELO from draft picks on CubeCobra, how many CubeCobra cubes include the card, how many times it was picked.",
};
