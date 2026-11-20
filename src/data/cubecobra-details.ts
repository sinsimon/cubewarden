/**
 * Oracle tags and CubeCobra statistics from CubeCobra's read-only card details endpoint
 * (POST cubecobra.com/cube/api/getdetailsforcards, no login, at most 100 Scryfall ids per call).
 */
import type { Card } from "../model.ts";
import { slug } from "../slug.ts";
import type { Http } from "./http.ts";

const URL_DETAILS = "https://cubecobra.com/cube/api/getdetailsforcards";
const BATCH = 100;

export interface CardDetails { scryfall_id: string; oracle_id?: string; oracle_tags?: string[]; elo?: number; cubeCount?: number; pickCount?: number; error?: boolean }

/** Details by Scryfall id. Ids CubeCobra does not know (it answers with an "Invalid Card" stub) are left out. */
export async function fetchDetails(http: Http, scryfallIds: string[]): Promise<Map<string, CardDetails>> {
  const out = new Map<string, CardDetails>();
  const ids = [...new Set(scryfallIds)];
  for (let i = 0; i < ids.length; i += BATCH) {
    const body = JSON.stringify({ cards: ids.slice(i, i + BATCH) });
    const r = await http.json<{ details?: (CardDetails | null)[] }>(URL_DETAILS, { method: "POST", body });
    for (const d of r.details || []) if (d && !d.error && d.oracle_id) out.set(d.scryfall_id, d);
  }
  return out;
}

/** The card with CubeCobra's oracle tags (slugged, sorted) and its ELO, cube count and pick count. */
export function withDetails(card: Card, d: CardDetails): Card {
  return {
    ...card, tags: [...new Set((d.oracle_tags || []).map(slug))].sort(),
    ccElo: d.elo ?? null, ccCubes: d.cubeCount ?? null, ccPicks: d.pickCount ?? null,
  };
}

/**
 * Adds details to every card, asking by the shown printing first, then once more with another printing
 * for the cards CubeCobra did not know (`alternatives` = other Scryfall ids by oracle id).
 */
export async function addDetails(http: Http, cards: Card[], alternatives: Map<string, string[]>): Promise<{ cards: Card[]; missing: string[] }> {
  const first = await fetchDetails(http, cards.flatMap((c) => (c.scryfallId ? [c.scryfallId] : [])));
  const retry = new Map<string, string>();
  for (const c of cards) {
    if (c.scryfallId && first.has(c.scryfallId)) continue;
    const alt = (alternatives.get(c.id) || []).find((x) => x !== c.scryfallId);
    if (alt) retry.set(c.id, alt);
  }
  const second = retry.size ? await fetchDetails(http, [...retry.values()]) : new Map<string, CardDetails>();
  const missing: string[] = [];
  const out = cards.map((c) => {
    const d = (c.scryfallId && first.get(c.scryfallId)) || second.get(retry.get(c.id) || "");
    if (!d) missing.push(c.id);
    return d ? withDetails(c, d) : c;
  });
  return { cards: out, missing };
}
