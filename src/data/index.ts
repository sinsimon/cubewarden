/** The card-data pipeline (Node only: it reads and writes files). Kept out of src/index.ts, which runs in the browser. */
export { BuildError, buildCards, provenanceText, type BuildOptions, type BuildResult, type Provenance } from "./build.ts";
export { DATA_HELP, PUBLISH_HELP, runDataCommand } from "./command.ts";
export { isReleased, publish, publishSummary, rebuildReason, recentre, candidates, CANDIDATE_TYPES, CANDIDATES_SINCE, DEFAULT_BUDGET_MINUTES, RECENT_DAYS, RECENT_REFRESH_DAYS, STALE_DAYS, type DataIndex, type PublishOptions, type PublishResult, type SetEntry, type Shard } from "./publish.ts";
export { addDetails, fetchDetails, withDetails, type CardDetails } from "./cubecobra-details.ts";
export { createHttp, USER_AGENT, type Http, type HttpOptions, type HostStats, type RequestOptions } from "./http.ts";
export {
  allowedSets, cardFromPrintings, fetchSetDates, fetchSets, groupByOracle, isPoolPrinting, oracleIdOf, pickPrinting, searchAll, setsQuery, type ScryfallCard,
} from "./scryfall-cards.ts";
export {
  adjustedFromPairs, adjustedOf, CENTRE_RARITIES, centreOf, deltaOf, setCentres, cardRatingsForSet, hasLiveRatings, deckBaselines, eventOf, EVENTS, fetch17Lands, nameMatcher, printedNames, MIN_GAMES, pickWinRateSet, readWinRateFile, withWinRate, type WinRate, type WinRateTable,
} from "./winrates.ts";
