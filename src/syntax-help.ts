/** The text syntax in one page: shown by `cubewarden syntax`, in the page's cheat sheet and in llms.txt. */
export const SYNTAX_HELP = `Filters (CubeCobra / Scryfall style; space = and, "or", ( ), "-" = not)
  otag:removal          Scryfall oracle tag (functional tag)
  t:creature  o:"draw a card"  kw:flying  m:{X}  name:bolt  !"Exact Name"
  mv>=4  pow>=3  tou<=2  ncolors>=2
  spellmv<=2  spellmv>=5  any mana value the card can be cast for as a noncreature spell: its own, the spell side of
                        an adventure/omen/prepared creature, each split half, kicker, tiered, spree (all modes),
                        flashback, harmonize, escape, foretell, overload, mayhem, sneak, warp…; an X spell goes up
                        from its X=0 cost; creatures and lands never match (Scryfall cannot filter it)
  c=wu (exactly)  c>=u (includes)  c<=wu (within)  c:c (colourless)  c=scope (the colour/archetype being checked)
  is:hybrid  r:common  r:u,r  s:fdn,trk (printed in any of these sets)
  wr>=1.5  wr<0 (17Lands WR Δ: points above or below the average common/uncommon of the card's set)
  wrraw>=55% (raw GIH WR, in percent)  games>=500
  elo>=1300  cubes>=1000  picks>=100 (CubeCobra card data)
  tag:"UG Ramp"         a CubeCobra tag on the card in your cube
  member:<mechanic id>  matches that mechanic of the colour or archetype being checked
  member:any            matches any of its mechanics (member:primary, member:secondary by priority)
                        in a search: the mechanics of the colour or archetype given as scope

Rules
  count(F) >= 6         count(F) in 13..14      count(F) = 3     count(F) <= 360
  count(t:creature) >= 50%                      share of the scope instead of a number of cards
  count(c=scope -is:hybrid) = 3 fixed           "fixed": never scaled to the target cube size
  avg(wr, member:any) in 1..3.5                 average of wr, wrraw, mv, pow, elo, cubes, picks
  every(s:fdn,trk)                              every card in scope must match
  every(mv, t:creature) <= 5                    every creature must have mv <= 5
  otag:counterspell >= 6                        shorthand for count(otag:counterspell) >= 6
  count(member:removal) >= 4                    the cards of the scope's "removal" mechanic (colour or archetype)

Curves: a target per mana value for the cards matching the filter (curve() = every card in scope)
  curve(t:creature) 1:1..3 2:5..7 3:4..6 4:2..4 5:1..3 6+:0..2
  curve(t:creature) 2:20%..30% 3:15%..25%      percent of the filtered cards
  curve(-t:land) 1-2:8..12 3-4:6..9 5+:2..4    a bucket can cover a range of mana values
  2:5..7 = mana value 2 (rounded down) · 0:1 = zero-drops (they count only in a 0 bucket) · 6+ = 6 and above
  1-3:2..4 = mana value 1, 2 or 3 · buckets must not overlap, ranges go low to high, only the highest bucket can be +
  each bucket: a..b, a (exactly), >=a or <=b · buckets not written have no target
  counts are scaled to the target cube size like count(); "fixed" at the end never scales, percent never scales
  the rule is ok when every bucket is in range, near when each miss is 1 card off
  (a % bucket: moving one filtered card into or out of it reaches its range)

Scopes: cube · color:W U B R G · color:C (colourless nonland) · color:L (lands) · archetype:<id> · allColors · allArchetypes
`;
