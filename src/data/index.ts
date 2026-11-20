/** The card-data pipeline (Node only: it reads and writes files). Kept out of src/index.ts, which runs in the browser. */
export { BuildError, buildCards, provenanceText, type BuildOptions, type BuildResult, type Provenance } from "./build.ts";
export { DATA_HELP, runDataCommand } from "./command.ts";
export { addDetails, fetchDetails, withDetails, type CardDetails } from "./cubecobra-details.ts";
export { createHttp, USER_AGENT, type Http, type HttpOptions, type HostStats, type RequestOptions } from "./http.ts";
export {
  allowedSets, cardFromPrintings, fetchSetDates, groupByOracle, isPoolPrinting, oracleIdOf, pickPrinting, searchAll, setsQuery, type ScryfallCard,
} from "./scryfall-cards.ts";
export {
  adjustedFromPairs, deckBaselines, EVENTS, fetch17Lands, MIN_GAMES, pickWinRateSet, readWinRateFile, withWinRate, type WinRate, type WinRateTable,
} from "./winrates.ts";
