/** The text syntax in one page: shown by `cubewarden syntax`, in the page's cheat sheet and in llms.txt. */
export const SYNTAX_HELP = `Filters (CubeCobra / Scryfall style; space = and, "or", ( ), "-" = not)
  otag:removal          Scryfall oracle tag (functional tag)
  t:creature  o:"draw a card"  kw:flying  m:{X}  name:bolt  !"Exact Name"
  mv>=4  pow>=3  tou<=2  ncolors>=2
  c=wu (exactly)  c>=u (includes)  c<=wu (within)  c:c (colourless)  c=scope (the colour/archetype being checked)
  is:hybrid  r:common  r:u,r  s:fdn,trk (printed in any of these sets)
  wr>=55% (17Lands adjusted WR)  wrraw>=55% (GIH WR)  games>=500
  elo>=1300  cubes>=1000  picks>=100 (CubeCobra card data)
  tag:"UG Ramp"         a CubeCobra tag on the card in your cube
  member:any            member of the archetype (matches one of its mechanics); member:<mechanic id>

Rules
  count(F) >= 6         count(F) in 13..14      count(F) = 3     count(F) <= 360
  count(t:creature) >= 50%                      share of the scope instead of a number of cards
  count(c=scope -is:hybrid) = 3 fixed           "fixed": never scaled to the target cube size
  avg(wr, member:any) in 55%..60%               average of wr, wrraw, mv, pow, elo, cubes, picks
  every(s:fdn,trk)                              every card in scope must match
  every(mv, t:creature) <= 5                    every creature must have mv <= 5
  otag:counterspell >= 6                        shorthand for count(otag:counterspell) >= 6

Scopes: cube · color:W U B R G · color:C (colourless nonland) · color:L (lands) · archetype:<id> · allColors · allArchetypes
`;
