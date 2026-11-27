/**
 * Builds a project's card database: the cube's cards plus every card a designer may add (the search pool),
 * from Scryfall (cards), CubeCobra (oracle tags and statistics) and optionally 17Lands (win rates).
 */
import type { Card } from "../model.ts";
import type { CubeCobraCube } from "../cubecobra.ts";
import { fetchCubeCobra } from "../cubecobra.ts";
import type { Project } from "../workspace.ts";
import { addDetails } from "./cubecobra-details.ts";
import { createHttp, type Http, type HostStats } from "./http.ts";
import {
  allowedSets, cardFromPrintings, fetchSetDates, groupByOracle, isPoolPrinting, pickPrinting, searchAll, setPrintings, setsQuery, type ScryfallCard,
} from "./scryfall-cards.ts";
import { fetch17Lands, readWinRateFile, setCentres, withWinRate, type WinRateTable } from "./winrates.ts";

export interface BuildOptions {
  /** The project, for its set rule and its cube; null builds from --pool alone. */
  project: Project | null;
  /** A Scryfall query for the pool, used when the project has no set rule (and preferred over it when given). */
  pool?: string;
  /** Path to a precomputed win rate file, "17lands", or nothing for no win rates. */
  winrates?: string;
  cacheDir: string;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
  log?: (s: string) => void;
}

export interface Provenance {
  cards: number;
  pool: { query: string; cards: number; printings: number };
  cube: { cards: number; outsidePool: number; source: string | null; notFound: string[] };
  tags: { cards: number; missing: number };
  winrates: { source: string | null; cards: number; delta: number; sets: Record<string, string | null>; unmatched: number };
  http: Record<string, HostStats>;
}

export interface BuildResult { cards: Card[]; provenance: Provenance }

export class BuildError extends Error {}

function poolQueryOf(o: BuildOptions, sets: string[] | null): string {
  if (o.pool) return o.pool;
  if (sets?.length) return setsQuery(sets);
  throw new BuildError("No pool: add a cube rule limiting the sets (every card: set in …) or pass --pool \"<Scryfall query>\". " +
    "The whole of Magic is too big to build.");
}

/** The pool: one card per oracle id, from every allowed printing. Also every printing id by oracle id. */
async function buildPool(http: Http, query: string) {
  const prints = (await searchAll(http, query)).filter(isPoolPrinting);
  const groups = groupByOracle(prints);
  const cards = [...groups.values()].map((p) => ({ ...cardFromPrintings(p), printings: setPrintings(p) }));
  const printIds = new Map([...groups].map(([id, p]) => [id, p.map((x) => x.id)]));
  return { cards, printIds, printings: prints.length };
}

/** A cube card outside the pool, from all its Scryfall printings, shown in the cube's own printing when known. */
async function cardOutsidePool(http: Http, oracleId: string, cubePrinting: string | null | undefined): Promise<{ card: Card; prints: ScryfallCard[] } | null> {
  const prints = await searchAll(http, `oracleid:${oracleId}`);
  if (!prints.length) return null;
  const paper = prints.filter(isPoolPrinting);
  const shown = prints.find((p) => p.id === cubePrinting) ?? pickPrinting(paper.length ? paper : prints);
  return { card: { ...cardFromPrintings(prints, shown), printings: setPrintings(paper.length ? paper : prints) }, prints };
}

async function readCube(project: Project | null, http: Http, log?: (s: string) => void): Promise<CubeCobraCube | null> {
  if (!project?.cubeId) return null;
  try {
    return await fetchCubeCobra(project.cubeId, {}, http.fetch);
  } catch (e) {
    log?.(`  CubeCobra cube ${project.cubeId} not read (${e instanceof Error ? e.message : e}): cube cards come from Scryfall alone`);
    return null;
  }
}

async function loadWinRates(o: BuildOptions, http: Http, sets: string[], cards: Card[]): Promise<WinRateTable | null> {
  if (!o.winrates) return null;
  if (o.winrates === "17lands") return fetch17Lands(http, sets, cards, await fetchSetDates(http), o.log);
  return readWinRateFile(o.winrates);
}

export async function buildCards(o: BuildOptions): Promise<BuildResult> {
  const log = o.log ?? (() => {});
  const http = createHttp({ cacheDir: o.cacheDir, refresh: o.refresh, fetchImpl: o.fetchImpl, log });
  const ruleSets = allowedSets(o.project?.config);
  const query = poolQueryOf(o, ruleSets);

  log(`Scryfall pool: ${query}`);
  const pool = await buildPool(http, query);
  log(`  ${pool.printings} printings, ${pool.cards.length} cards`);
  const byId = new Map<string, Card>(pool.cards.map((c) => [c.id, c]));
  const printIds = pool.printIds;

  const cubeIds = [...new Set([...(o.project?.original || []), ...(o.project?.current || [])])];
  const cube = await readCube(o.project, http, log);
  const outside = cubeIds.filter((id) => !byId.has(id));
  const notFound: string[] = [];
  if (outside.length) log(`Cube cards outside the pool: ${outside.length}`);
  for (const id of outside) {
    const found = await cardOutsidePool(http, id, cube?.cards[id]?.scryfallId);
    const card = found?.card ?? cube?.cards[id];
    if (!card) { notFound.push(id); continue; }
    byId.set(id, card);
    if (found) printIds.set(id, found.prints.map((p) => p.id));
  }
  // Cube cards keep the printing chosen in the cube (its set picks the win rate) and their CubeCobra tags.
  if (cube) for (const [id, c] of Object.entries(cube.cards)) {
    const b = byId.get(id);
    if (!b) continue;
    const printing = c.scryfallId && c.scryfallId !== b.scryfallId
      ? { set: c.set, number: c.number, rarity: c.rarity ?? b.rarity, scryfallId: c.scryfallId, image: c.image ?? b.image,
          printSets: [...new Set([...b.printSets, ...(c.set ? [c.set] : [])])].sort(),
          // The list's printing is one the cube can switch back to.
          printings: c.set ? [{ set: c.set, number: c.number, scryfallId: c.scryfallId, image: c.image ?? b.image },
            ...(b.printings || []).filter((x) => x.set !== c.set || x.number !== c.number)] : b.printings }
      : {};
    byId.set(id, { ...b, ...printing, ...(c.ccTags?.length ? { ccTags: c.ccTags } : {}) });
  }

  log(`CubeCobra card details for ${byId.size} cards`);
  const detailed = await addDetails(http, [...byId.values()], printIds);
  let cards = detailed.cards;

  const sets = ruleSets ?? [...new Set(pool.cards.flatMap((c) => c.printSets))].sort();
  if (o.winrates) log(`Win rates: ${o.winrates === "17lands" ? "17Lands" : o.winrates}`);
  const table = await loadWinRates(o, http, sets, cards);
  if (table) {
    const centres = setCentres(table, cards);
    cards = cards.map((c) => withWinRate(c, table, sets, centres));
  }
  cards.sort((a, b) => a.name.localeCompare(b.name));

  const provenance: Provenance = {
    cards: cards.length,
    pool: { query, cards: pool.cards.length, printings: pool.printings },
    cube: { cards: cubeIds.length, outsidePool: outside.length - notFound.length, source: o.project?.cubeId ? `CubeCobra ${o.project.cubeId}${cube ? "" : " (not read)"}` : null, notFound },
    tags: { cards: cards.filter((c) => c.tags.length).length, missing: detailed.missing.length },
    winrates: {
      source: table?.source ?? null,
      cards: cards.filter((c) => c.wrRaw != null).length,
      delta: cards.filter((c) => c.wrDelta != null).length,
      sets: table ? Object.fromEntries(sets.map((s) => [s, table.sets[s]?.asOf ?? null])) : {},
      unmatched: Object.values(table?.unmatched || {}).reduce((n, l) => n + l.length, 0),
    },
    http: http.stats,
  };
  return { cards, provenance };
}

/** A short, readable account of where the data came from. */
export function provenanceText(p: Provenance): string {
  const pc = (n: number) => `${n} (${p.cards ? Math.round((100 * n) / p.cards) : 0}%)`;
  const dates = (host: string) => {
    const s = p.http[host];
    if (!s) return "";
    const when = s.oldest === s.newest ? s.oldest : `${s.oldest} to ${s.newest}`;
    return ` — fetched ${when}, ${s.network} network call(s), ${s.cached} from cache`;
  };
  const wrSets = Object.entries(p.winrates.sets).map(([s, d]) => `${s} ${d ?? "no data"}`).join(", ");
  return [
    `${p.cards} cards: ${p.pool.cards} in the pool (${p.pool.printings} printings), ${p.cube.outsidePool} cube cards outside it`,
    `  Scryfall: ${p.pool.query}${dates("api.scryfall.com")}`,
    `  Cube: ${p.cube.cards} cards${p.cube.source ? ", " + p.cube.source + dates("cubecobra.com") : ""}` +
      (p.cube.notFound.length ? `; not found anywhere: ${p.cube.notFound.join(", ")}` : ""),
    `  Oracle tags and CubeCobra stats: ${pc(p.tags.cards)} with tags, ${p.tags.missing} unknown to CubeCobra`,
    p.winrates.source
      ? `  Win rates: ${pc(p.winrates.cards)} with GIH WR, ${pc(p.winrates.delta)} with WR Δ — ${p.winrates.source}` +
        (p.http["www.17lands.com"] ? dates("www.17lands.com") : "") + `\n    as of: ${wrSets}` +
        (p.winrates.unmatched ? `\n    ${p.winrates.unmatched} 17Lands names matched no card printed in their set` : "")
      : "  Win rates: none (pass --winrates <file> or --winrates 17lands)",
  ].join("\n");
}
