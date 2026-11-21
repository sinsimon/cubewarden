import { describe, expect, it } from "vitest";
import { conditionToText, matches, parseFilter, parseRule, ruleToText, spellCosts, toScryfall, type Card } from "../src/index.ts";
import { card } from "./fixtures/cards.ts";

/**
 * Real cards, cut to the lines that matter (reminder text kept where it repeats a cost, to prove it is ignored).
 * Expected spell costs are worked out by hand from the printed costs.
 */
const C = {
  burstLightning: card("burst", { name: "Burst Lightning", type: "Instant", manaCost: "{R}", mv: 1,
    text: "Kicker {4} (You may pay an additional {4} as you cast this spell.)\nBurst Lightning deals 2 damage to any target." }),
  tomeBlast: card("tome", { name: "Tome Blast", type: "Sorcery", manaCost: "{1}{R}", mv: 2,
    text: "Tome Blast deals 2 damage to any target.\nFlashback {4}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)" }),
  channeledDragonfire: card("dragonfire", { name: "Channeled Dragonfire", type: "Sorcery", manaCost: "{R}", mv: 1,
    text: "Channeled Dragonfire deals 2 damage to any target.\nHarmonize {5}{R}{R} (You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by {X}, where X is its power. Then exile this spell.)" }),
  transporterMalfunction: card("transporter", { name: "Transporter Malfunction", type: "Sorcery", manaCost: "{1}{R}", mv: 2,
    text: "Transporter Malfunction deals 3 damage to any target.\nBeam me up {3}{R}{R}{R} (You may cast this card from your graveyard for {3}{R}{R}{R} if you also return a creature you control to its owner's hand. Then exile this spell.)" }),
  fireMagic: card("fire", { name: "Fire Magic", type: "Instant", manaCost: "{R}", mv: 1,
    text: "Tiered (Choose one additional cost.)\n• Fire — {0} — Fire Magic deals 1 damage to each creature.\n• Fira — {2} — Fire Magic deals 2 damage to each creature.\n• Firaga — {5} — Fire Magic deals 3 damage to each creature." }),
  vincentsLimitBreak: card("vincent", { name: "Vincent's Limit Break", type: "Instant", manaCost: "{1}{B}", mv: 2,
    text: "Tiered (Choose one additional cost.)\nUntil end of turn, target creature you control has the chosen base power and toughness.\n• Galian Beast — {0} — 3/2.\n• Death Gigas — {1} — 5/2.\n• Hellmasker — {3} — 7/2." }),
  bilbo: card("bilbo", { name: "Bilbo, Luckwearer // Burglar's Plot", manaCost: "{1}{U} // {4}{U}", mv: 2,
    type: "Legendary Creature — Halfling Rogue // Sorcery — Adventure",
    text: "Bilbo can't be blocked.\n//\nExchange control of two target nonland permanents that share a card type. (Then exile this card. You may cast the creature later from exile.)" }),
  runescale: card("runescale", { name: "Runescale Stormbrood // Chilling Screech", manaCost: "{3}{R} // {1}{U}", mv: 4,
    type: "Creature — Dragon // Instant — Omen",
    text: "Flying\n//\nCounter target spell with mana value 2 or less. (Then shuffle this card into its owner's library.)" }),
  jadzi: card("jadzi", { name: "Jadzi, Steward of Fate // Oracle's Gift", manaCost: "{2}{U} // {X}{X}{U}", mv: 3,
    type: "Legendary Creature — Human Wizard // Sorcery",
    text: "Jadzi enters prepared.\n//\nCreate X 0/0 green and blue Fractal creature tokens." }),
  mathemagics: card("math", { name: "Mathemagics", type: "Sorcery", manaCost: "{X}{X}{U}{U}", mv: 2,
    text: "Target player draws 2ˣ cards. (2⁰ = 1, 2¹ = 2, 2² = 4, and so on.)" }),
  chocoComet: card("choco", { name: "Choco-Comet", type: "Sorcery", manaCost: "{X}{R}{R}", mv: 2,
    text: "Choco-Comet deals X damage to any target." }),
  bear: card("bear", { name: "Grizzly Bears", type: "Creature — Bear", manaCost: "{1}{G}", mv: 2, text: "" }),
  flashbackCreature: card("flashbackCreature", { name: "Flashback creature", type: "Creature — Spirit", manaCost: "{1}{B}", mv: 2,
    text: "Flashback {3}{B}" }),
  island: card("island", { name: "Island", type: "Basic Land — Island", manaCost: "", mv: 0, text: "({T}: Add {U}.)" }),
  ishgard: card("ishgard", { name: "Ishgard, the Holy See // Faith & Grief", manaCost: "{3}{W}{W}", mv: 0,
    type: "Land — Town // Sorcery — Adventure", text: "{T}: Add {W}.\n//\nReturn up to two target artifact and/or enchantment cards from your graveyard to your hand." }),
  ceaseDesist: card("cease", { name: "Cease // Desist", manaCost: "{1}{B/G} // {4}{G/W}{G/W}", mv: 8, type: "Instant // Sorcery",
    text: "Exile up to two target cards from a single graveyard.\n//\nDestroy all artifacts and enchantments." }),
  transformCreature: card("werewolf", { name: "Day Wolf // Night Wolf", manaCost: "{2}{G}", mv: 3, type: "Creature — Human Werewolf // Creature — Werewolf",
    text: "Daybound\n//\nNightbound" }),
  battle: card("invasion", { name: "Invasion of Alara // Awaken the Maelstrom", manaCost: "{W}{U}{B}{R}{G}", mv: 5, type: "Battle — Siege // Sorcery",
    text: "When this Siege enters, exile cards from the top of your library.\n//\nTarget player draws seven cards." }),
  temporalFirestorm: card("firestorm", { name: "Temporal Firestorm", type: "Sorcery", manaCost: "{3}{R}{R}", mv: 5,
    text: "Kicker {1}{W} and/or {1}{U} (You may pay an additional {1}{W} and/or {1}{U} as you cast this spell.)\nTemporal Firestorm deals 5 damage to each creature and each planeswalker." }),
  multikicker: card("multikicker", { name: "Everflowing Chalice", type: "Artifact", manaCost: "{0}", mv: 0,
    text: "Multikicker {2} (You may pay an additional {2} any number of times as you cast this spell.)\nThis artifact enters with a charge counter on it for each time it was kicked." }),
  sacrificeKicker: card("sackick", { name: "Sacrifice kicker", type: "Sorcery", manaCost: "{2}{B}", mv: 3,
    text: "Kicker—Sacrifice an artifact or creature.\nDestroy target creature." }),
  danceOfTheTumbleweeds: card("dance", { name: "Dance of the Tumbleweeds", type: "Sorcery", manaCost: "{1}{G}", mv: 2,
    text: "Spree (Choose one or more additional costs.)\n+ {1} — Search your library for a basic land card, put it onto the battlefield, then shuffle.\n+ {3} — Create an X/X green Elemental creature token." }),
  clingToDust: card("cling", { name: "Cling to Dust", type: "Instant", manaCost: "{B}", mv: 1,
    text: "Exile target card from a graveyard.\nEscape—{3}{B}, Exile five other cards from your graveyard. (You may cast this card from your graveyard for its escape cost.)" }),
  tapFlashback: card("tapfb", { name: "Tap flashback", type: "Sorcery", manaCost: "{3}{G}", mv: 4,
    text: "Create two 1/1 Squirrel tokens.\nFlashback—Tap three untapped creatures you control." }),
  beholdTheMultiverse: card("behold", { name: "Behold the Multiverse", type: "Instant", manaCost: "{3}{U}", mv: 4,
    text: "Scry 2, then draw two cards.\nForetell {1}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)" }),
  fangsOfKalonia: card("fangs", { name: "Fangs of Kalonia", type: "Sorcery", manaCost: "{1}{G}", mv: 2,
    text: "Put a +1/+1 counter on target creature you control.\nOverload {4}{G}{G} (You may cast this spell for its overload cost.)" }),
  donatellosTechnique: card("donatello", { name: "Donatello's Technique", type: "Sorcery", manaCost: "{2}{U}", mv: 3,
    text: "Sneak {U} (You may cast this spell for {U} if you also return an unblocked attacker you control to hand during the declare blockers step.)\nDraw two cards." }),
  spiderSense: card("spidersense", { name: "Spider-Sense", type: "Instant", manaCost: "{1}{U}", mv: 2,
    text: "Web-slinging {U} (You may cast this spell for {U} if you also return a tapped creature you control to its owner's hand.)\nCounter target instant spell, sorcery spell, or triggered ability." }),
  eusocialEngineering: card("eusocial", { name: "Eusocial Engineering", type: "Enchantment", manaCost: "{3}{G}{G}", mv: 5,
    text: "Landfall — Whenever a land you control enters, create a 2/2 colorless Robot artifact creature token.\nWarp {1}{G} (You may cast this card from your hand for its warp cost.)" }),
  brimstoneRoundup: card("brimstone", { name: "Brimstone Roundup", type: "Enchantment", manaCost: "{1}{R}", mv: 2,
    text: "Whenever you cast your second spell each turn, create a 1/1 red Mercenary creature token.\nPlot {2}{R} (You may pay {2}{R} and exile this card from your hand. Cast it as a sorcery on a later turn without paying its mana cost.)" }),
  mayhemSpell: card("mayhem", { name: "Mayhem spell", type: "Instant", manaCost: "{2}{R}", mv: 3, text: "Deal 3 damage.\nMayhem {1}{R}" }),
  grantedFlashback: card("granted", { name: "Granted flashback", type: "Enchantment", manaCost: "{2}{U}", mv: 3,
    text: "Instant cards in your graveyard have \"Flashback {2}{U}.\"" }),
} satisfies Record<string, Card>;

/** The mana values of a card's spell costs, low to high. */
const mvs = (c: Card) => spellCosts(c).map((s) => s.mv).sort((a, b) => a - b);
const hit = (c: Card, f: string) => matches(c, parseFilter(f));

describe("spell costs: every mana value a card can be cast for as a noncreature spell", () => {
  it("is the mana value of a noncreature, nonland card", () => {
    expect(spellCosts(C.tomeBlast)[0]).toEqual({ mv: 2, via: "cast" });
    expect(mvs(C.multikicker)).toContain(0);
  });
  it("adds a kicker to the mana value, each kicker of an and/or pair and both together", () => {
    expect(mvs(C.burstLightning)).toEqual([1, 5]);
    expect(mvs(C.temporalFirestorm)).toEqual([5, 7, 9]);
    expect(mvs(C.multikicker)).toEqual([0, 2]);
  });
  it("leaves out costs that are not mana (a kicker that sacrifices, a flashback that taps creatures)", () => {
    expect(mvs(C.sacrificeKicker)).toEqual([3]);
    expect(mvs(C.tapFlashback)).toEqual([4]);
  });
  it("reads recast and alternative costs: flashback, harmonize, beam me up, escape, foretell, overload, mayhem", () => {
    expect(mvs(C.tomeBlast)).toEqual([2, 5]);
    expect(mvs(C.channeledDragonfire)).toEqual([1, 7]);
    expect(mvs(C.transporterMalfunction)).toEqual([2, 6]);
    expect(mvs(C.clingToDust)).toEqual([1, 4]);
    expect(mvs(C.beholdTheMultiverse)).toEqual([2, 4]);
    expect(mvs(C.fangsOfKalonia)).toEqual([2, 6]);
    expect(mvs(C.mayhemSpell)).toEqual([2, 3]);
    expect(spellCosts(C.tomeBlast)).toContainEqual({ mv: 5, via: "flashback" });
  });
  it("reads the alternative costs that cast a spell from hand: sneak, web-slinging, warp", () => {
    expect(mvs(C.donatellosTechnique)).toEqual([1, 3]);
    expect(mvs(C.spiderSense)).toEqual([1, 2]);
    expect(mvs(C.eusocialEngineering)).toEqual([2, 5]);
  });
  it("leaves out plot: its cost exiles the card, which is later cast without paying a cost", () => {
    expect(mvs(C.brimstoneRoundup)).toEqual([2]);
  });
  it("reads each tier of a tiered spell and every mode of a spree spell together", () => {
    expect(mvs(C.fireMagic)).toEqual([1, 3, 6]);
    expect(mvs(C.vincentsLimitBreak)).toEqual([2, 3, 5]);
    expect(mvs(C.danceOfTheTumbleweeds)).toEqual([2, 6]);
  });
  it("counts the spell side of a creature (adventure, omen, prepared) and not the creature", () => {
    expect(spellCosts(C.bilbo)).toEqual([{ mv: 5, via: "Burglar's Plot" }]);
    expect(mvs(C.runescale)).toEqual([2]);
    expect(spellCosts(C.jadzi)).toEqual([{ mv: 1, x: 2, via: "Oracle's Gift" }]);
  });
  it("reads each half of a split card, and gives a lone cost to the face that can be cast", () => {
    expect(mvs(C.ceaseDesist)).toEqual([2, 6]);
    expect(mvs(C.ishgard)).toEqual([5]);
    expect(mvs(C.battle)).toEqual([5]);
  });
  it("has none for a creature, a transforming creature, a land, or a creature's own flashback", () => {
    expect(spellCosts(C.bear)).toEqual([]);
    expect(spellCosts(C.transformCreature)).toEqual([]);
    expect(spellCosts(C.island)).toEqual([]);
    expect(spellCosts(C.flashbackCreature)).toEqual([]);
  });
  it("ignores costs in reminder text and in abilities granted to other cards", () => {
    expect(mvs(C.grantedFlashback)).toEqual([3]);
  });
  it("marks an X cost with its number of X: the spell can be cast for more, in steps of that number", () => {
    expect(spellCosts(C.chocoComet)).toEqual([{ mv: 2, x: 1, via: "cast" }]);
    expect(spellCosts(C.mathemagics)).toEqual([{ mv: 2, x: 2, via: "cast" }]);
  });
});

describe("the spellmv filter", () => {
  it("reads and writes spellmv with the operators of mv", () => {
    expect(parseFilter("spellmv<=2").items[0]).toEqual({ field: "spellMv", op: "<=", value: 2 });
    expect(parseFilter("spellmv:3").items[0]).toEqual({ field: "spellMv", op: "=", value: 3 });
    expect(conditionToText({ field: "spellMv", op: ">=", value: 4 })).toBe("spellmv>=4");
    expect(conditionToText({ field: "spellMv", op: ">=", value: 4, not: true })).toBe("-spellmv>=4");
    expect(ruleToText(parseRule("count(spellmv<=2 c<=ur) >= 12"))).toBe("count(spellmv<=2 c<=ur) >= 12");
  });
  it("matches when any spell cost passes the comparison", () => {
    expect(hit(C.burstLightning, "spellmv<=2")).toBe(true);
    expect(hit(C.burstLightning, "spellmv>=4")).toBe(true);
    expect(hit(C.burstLightning, "spellmv=5")).toBe(true);
    expect(hit(C.burstLightning, "spellmv=3")).toBe(false);
    expect(hit(C.channeledDragonfire, "spellmv>6")).toBe(true);
    expect(hit(C.tomeBlast, "spellmv<2")).toBe(false);
    expect(hit(C.bilbo, "spellmv<=2")).toBe(false);
    expect(hit(C.bilbo, "spellmv>=5")).toBe(true);
    expect(hit(C.runescale, "spellmv<=2")).toBe(true);
  });
  it("never matches a card without spell costs, so its negation always does", () => {
    for (const f of ["spellmv<=2", "spellmv>=4", "spellmv=2", "spellmv>=0"]) expect(hit(C.bear, f)).toBe(false);
    expect(hit(C.bear, "-spellmv>=4")).toBe(true);
    expect(hit(C.island, "-spellmv<=2")).toBe(true);
  });
  it("reads an X spell as open upward: any >= or >, and <= or < from its X=0 cost", () => {
    expect(hit(C.chocoComet, "spellmv>=10")).toBe(true);
    expect(hit(C.chocoComet, "spellmv>1")).toBe(true);
    expect(hit(C.chocoComet, "spellmv<=2")).toBe(true);
    expect(hit(C.chocoComet, "spellmv<2")).toBe(false);
    expect(hit(C.chocoComet, "spellmv=7")).toBe(true);
    expect(hit(C.chocoComet, "spellmv=1")).toBe(false);
    expect(hit(C.mathemagics, "spellmv=4")).toBe(true);
    expect(hit(C.mathemagics, "spellmv=3")).toBe(false);
    expect(hit(C.jadzi, "spellmv<=1")).toBe(true);
    expect(hit(C.jadzi, "spellmv>=8")).toBe(true);
  });
  it("counts cheap and big spells in a rule", () => {
    const pool = Object.values(C);
    const cheap = pool.filter((c) => hit(c, "spellmv<=2")).map((c) => c.name);
    expect(cheap).toContain("Runescale Stormbrood // Chilling Screech");
    expect(cheap).not.toContain("Grizzly Bears");
    expect(cheap).not.toContain("Bilbo, Luckwearer // Burglar's Plot");
  });
});

describe("spellmv on Scryfall", () => {
  it("is left out of the Scryfall query and listed as skipped, like the win rates", () => {
    const r = toScryfall(parseFilter("spellmv<=2 t:instant"));
    expect(r.query).toBe("t:instant");
    expect(r.skipped).toEqual(["spell mana value <= 2"]);
  });
});
