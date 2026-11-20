/**
 * Card data from Scryfall's search API (read only): the pool of printings, grouped into one card per oracle id.
 */
import type { Card, Config, Filter } from "../model.ts";
import { colorSet } from "../colors.ts";
import { isHybridCost } from "../cubecobra.ts";
import type { Http } from "./http.ts";

const API = "https://api.scryfall.com";

interface ScryfallFace {
  name?: string; printed_name?: string; oracle_id?: string; mana_cost?: string; type_line?: string; oracle_text?: string;
  colors?: string[]; power?: string; toughness?: string; image_uris?: { normal?: string };
}
export interface ScryfallCard extends ScryfallFace {
  id: string; name: string; layout: string; set: string; set_type?: string; collector_number: string; rarity: string;
  released_at: string; digital?: boolean; booster?: boolean; cmc?: number; color_identity?: string[]; keywords?: string[];
  card_faces?: ScryfallFace[];
}
interface SearchPage { object: string; data?: ScryfallCard[]; has_more?: boolean; next_page?: string; code?: string }
export interface ScryfallSet { code: string; name?: string; set_type?: string; released_at?: string; digital?: boolean; card_count?: number }

const NOT_CARDS = new Set(["token", "double_faced_token", "emblem", "art_series"]);

/** Every result of a search, following next_page. A search with no results gives []. */
export async function searchAll(http: Http, query: string, unique = "prints"): Promise<ScryfallCard[]> {
  const out: ScryfallCard[] = [];
  let url: string | undefined = `${API}/cards/search?` + new URLSearchParams({ q: query, unique, order: "released" });
  while (url) {
    const page: SearchPage = await http.json<SearchPage>(url, { notFoundOk: true });
    if (page.object === "error") {
      if (page.code === "not_found") break;
      throw new Error(`Scryfall refused the search "${query}": ${JSON.stringify(page)}`);
    }
    out.push(...(page.data || []));
    url = page.has_more ? page.next_page : undefined;
  }
  return out;
}

/** Every set Scryfall knows. */
export async function fetchSets(http: Http): Promise<ScryfallSet[]> {
  return (await http.json<{ data: ScryfallSet[] }>(`${API}/sets`)).data;
}

/** Release date of every set Scryfall knows, by code. */
export async function fetchSetDates(http: Http): Promise<Record<string, string>> {
  const r = await http.json<{ data: ScryfallSet[] }>(`${API}/sets`);
  return Object.fromEntries(r.data.filter((s) => s.released_at).map((s) => [s.code, s.released_at!]));
}

export const oracleIdOf = (c: ScryfallCard): string | undefined => c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
const frontType = (c: ScryfallCard) => (c.type_line ?? c.card_faces?.[0]?.type_line ?? "").split(" // ")[0];
const isBasicLand = (c: ScryfallCard) => /\bBasic\b/.test(frontType(c)) && /\bLand\b/.test(frontType(c));

/** A paper printing of a real card: no basic lands, tokens, art series or digital-only printings. */
export function isPoolPrinting(c: ScryfallCard): boolean {
  return !!oracleIdOf(c) && !c.digital && !NOT_CARDS.has(c.layout) && c.set_type !== "token" && c.set_type !== "memorabilia" && !isBasicLand(c);
}

const numberOf = (c: ScryfallCard) => parseInt(c.collector_number, 10) || Number.MAX_SAFE_INTEGER;

/** The printing a card shows: the most recent, and within a set the regular frame (lowest collector number). */
export function pickPrinting(prints: ScryfallCard[]): ScryfallCard {
  return [...prints].sort((a, b) => b.released_at.localeCompare(a.released_at) || numberOf(a) - numberOf(b))[0];
}

/** "A // B" from the faces; empty face costs (the back of a transforming card) are left out, as CubeCobra does. */
function manaCostOf(c: ScryfallCard): string {
  if (c.mana_cost != null && !c.card_faces) return c.mana_cost;
  const faces = (c.card_faces || []).map((f) => f.mana_cost || "").filter(Boolean);
  return faces.length ? faces.join(" // ") : c.mana_cost || "";
}

const textOf = (c: ScryfallCard) => c.oracle_text ?? (c.card_faces || []).map((f) => f.oracle_text || "").join("\n//\n");
const imageOf = (c: ScryfallCard) => c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? null;

/** One card from all its printings: oracle data from the shown printing, printSets from every printing. */
export function cardFromPrintings(prints: ScryfallCard[], shown: ScryfallCard = pickPrinting(prints)): Card {
  const front = shown.card_faces?.[0];
  const manaCost = manaCostOf(shown);
  return {
    id: oracleIdOf(shown)!, name: shown.name,
    colors: colorSet((shown.colors ?? front?.colors ?? []).join("")), identity: colorSet((shown.color_identity || []).join("")),
    manaCost, hybrid: isHybridCost(manaCost), type: shown.type_line ?? (shown.card_faces || []).map((f) => f.type_line).join(" // "),
    mv: shown.cmc ?? 0, power: shown.power ?? front?.power ?? null, toughness: shown.toughness ?? front?.toughness ?? null,
    text: textOf(shown), keywords: (shown.keywords || []).map((k) => k.toLowerCase()), tags: [],
    set: shown.set, number: shown.collector_number, rarity: shown.rarity,
    printSets: [...new Set(prints.map((p) => p.set))].sort(), image: imageOf(shown), scryfallId: shown.id,
    wrAdj: null, wrRaw: null, games: null, wrSet: null, ccElo: null, ccCubes: null, ccPicks: null,
  };
}

/** Printings grouped by oracle id. */
export function groupByOracle(prints: ScryfallCard[]): Map<string, ScryfallCard[]> {
  const by = new Map<string, ScryfallCard[]>();
  for (const p of prints) {
    const id = oracleIdOf(p);
    if (id) by.set(id, [...(by.get(id) || []), p]);
  }
  return by;
}

/** "(set:trk or set:fdn)", the Scryfall query for a list of sets. */
export const setsQuery = (sets: string[]) => "(" + sets.map((s) => `set:${s}`).join(" or ") + ")";

/** Set codes of a filter that are an allow-list: a non-negated set condition at the top level of an "and" (or of a one-item filter). */
function allowListOf(filter: Filter | null | undefined): string[] | null {
  if (!filter || filter.not || (filter.op !== "and" && filter.items.length !== 1)) return null;
  for (const item of filter.items) {
    if ("field" in item && item.field === "set" && !item.not && (item.op === "in" || item.op === "is")) {
      return ([] as unknown[]).concat(item.value).map((s) => String(s).toLowerCase());
    }
  }
  return null;
}

/** The sets every card of the cube must come from, from the cube's "every card" rules, or null when no rule limits them. */
export function allowedSets(config: Config | null | undefined): string[] | null {
  let out: string[] | null = null;
  for (const r of config?.rules || []) {
    if (r.scope.kind !== "cube" || r.measure.kind !== "every") continue;
    const sets = allowListOf(r.filter);
    if (sets) out = out ? out.filter((s) => sets.includes(s)) : sets;
  }
  return out;
}
