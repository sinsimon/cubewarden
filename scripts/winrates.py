#!/usr/bin/env python3
"""17Lands win rates of one draft event, from the 17Lands Public Dataset (CC BY 4.0).

Reads the raw game_data archive of the event (one row per game, with the deck's main colours and,
per card, how many copies were in the opening hand and drawn) and writes, per 17Lands card name:

- GIH WR: win rate of the games where at least one copy was in the opening hand or drawn;
- adjusted WR: the same games, minus the strength of the decks the card was in. Each game's deck
  colours get a baseline (the win rate of all the event's games with those main colours); the card's
  residual is its wins minus the sum of its games' baselines, per game, and adjWr = the event's
  overall win rate + residual. Only games whose deck colours are known count for adjWr.

Cards under MIN_GAMES games in hand get no entry; adjWr is left out under MIN_GAMES known-deck games.
Basic lands are left out.

Usage: uv run --with duckdb python scripts/winrates.py --event FDN --format PremierDraft --out fdn.json
       [--archive <local .csv.gz>]   (otherwise downloaded to a temporary file and deleted)
Output: {event, format, asOf, overall, games, cards: {<name>: {games, wins, gihWr, adjWr, adjGames, deck}}}
asOf is the archive's Last-Modified date in UTC.
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import gzip
import json
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

GAME_URL = "https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.{event}.{format}.csv.gz"
USER_AGENT = "cubewarden/0.1"
MIN_GAMES = 500
BASICS = {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"}

# Games and wins of one group of games: a deck colour, or the games a card was in hand.
Tally = tuple[int, int]


def download(url: str, target: Path) -> str:
    """Downloads the archive; returns its Last-Modified date (UTC, YYYY-MM-DD)."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(request, timeout=600) as source, target.open("wb") as out:
        shutil.copyfileobj(source, out, length=1 << 20)
        modified = source.headers.get("Last-Modified")
    stamp = email.utils.parsedate_to_datetime(modified) if modified else dt.datetime.now(dt.timezone.utc)
    return stamp.astimezone(dt.timezone.utc).date().isoformat()


def plain_csv(archive: Path, tmp: Path) -> Path:
    """The archive as DuckDB can read it. Most archives are a gzipped CSV; the older ones 17Lands republished
    (Last-Modified 2024-01-11: MID, VOW, ...) are a gzipped tar holding the CSV, extracted here."""
    with gzip.open(archive, "rb") as f:
        head = f.read(512)
    if head[257:262] != b"ustar":
        return archive
    with tarfile.open(archive, "r:gz") as tar:
        member = next(m for m in tar.getmembers() if m.isfile() and m.name.endswith(".csv"))
        target = tmp / "game_data.csv"
        with tar.extractfile(member) as source, target.open("wb") as out:
            shutil.copyfileobj(source, out, length=1 << 20)
    return target


def quote(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def gih_from_game_data(path: Path) -> tuple[dict[str | None, Tally], dict[str, dict[str | None, Tally]]]:
    """One pass over a raw archive, grouped by the deck's main colours ("WR", "WBR", "G";
    None when 17Lands has none). Returns (games, wins) per deck colour and, per card name,
    (games in hand, wins) per deck colour: the GIH WR is their sum over all colours."""
    import duckdb

    connection = duckdb.connect()
    connection.execute(f"SET memory_limit='{os.environ.get('DUCKDB_MEMORY_LIMIT', '3GB')}'")
    connection.execute("SET threads=4")
    source = f"read_csv_auto({quote(str(path)).replace(chr(34), chr(39))}, header=true, sample_size=1000)"
    columns = [row[0] for row in connection.execute(f"DESCRIBE SELECT * FROM {source}").fetchall()]
    present = set(columns)
    names = sorted(column[len("drawn_"):] for column in columns
                   if column.startswith("drawn_") and f"opening_hand_{column[len('drawn_'):]}" in present)
    names = [name for name in names if name not in BASICS]
    # The oldest archives (KHM, STX) have no main_colors: every game then counts as "deck unknown", so the
    # GIH WR is exact and the adjusted WR is left out.
    deck_column = "main_colors" if "main_colors" in present else "NULL::VARCHAR"
    expressions = [deck_column, "COUNT(*)::BIGINT", "SUM(CASE WHEN won THEN 1 ELSE 0 END)::BIGINT"]
    for name in names:
        seen = f"(COALESCE({quote('opening_hand_' + name)}, 0) + COALESCE({quote('drawn_' + name)}, 0) > 0)"
        expressions.append(f"SUM(CASE WHEN {seen} THEN 1 ELSE 0 END)::BIGINT")
        expressions.append(f"SUM(CASE WHEN {seen} AND won THEN 1 ELSE 0 END)::BIGINT")
    rows = connection.execute(f"SELECT {', '.join(expressions)} FROM {source} GROUP BY 1").fetchall()
    decks: dict[str | None, Tally] = {}
    cards: dict[str, dict[str | None, Tally]] = {name: {} for name in names}
    for row in rows:
        deck = row[0] or None
        games, wins = decks.get(deck, (0, 0))
        decks[deck] = (games + int(row[1]), wins + int(row[2]))
        for i, name in enumerate(names):
            seen, won = int(row[3 + 2 * i]), int(row[4 + 2 * i])
            if seen:
                before = cards[name].get(deck, (0, 0))
                cards[name][deck] = (before[0] + seen, before[1] + won)
    return decks, cards


def deck_baselines(decks: dict[str | None, Tally]) -> tuple[float, dict[str, Tally], dict[str, float]]:
    """The event's overall win rate (every game, deck colours known or not), the deck
    colours' (games, wins) and their win rate, the baseline of a game in that colour."""
    games = sum(games for games, _ in decks.values())
    wins = sum(wins for _, wins in decks.values())
    known = {deck: tally for deck, tally in decks.items() if deck and tally[0]}
    return wins / games, known, {deck: deck_wins / deck_games for deck, (deck_games, deck_wins) in known.items()}


def adjusted_from_decks(by_deck: dict[str | None, Tally], baselines: dict[str, float], overall: float) -> dict | None:
    """GIH WR above its decks: over the games the card was in hand (and the deck colours
    are known), mean(won) - mean(baseline of the game's deck colours), put back on the
    event's scale as overall + residual. Also the deck colours it was most often in."""
    known = [(deck, games, wins) for deck, (games, wins) in by_deck.items() if deck in baselines and games]
    games = sum(games for _, games, _ in known)
    if not games:
        return None
    wins = sum(wins for _, _, wins in known)
    expected = sum(games * baselines[deck] for deck, games, _ in known)
    deck, deck_games, _ = max(known, key=lambda item: (item[1], item[0]))
    return {"adjWr": overall + (wins - expected) / games, "adjGames": games, "deck": deck}


def summarize(decks: dict[str | None, Tally], by_card: dict[str, dict[str | None, Tally]]) -> tuple[float, int, dict[str, dict]]:
    overall, _, baselines = deck_baselines(decks)  # no known deck colours: baselines is empty, adjWr stays None
    out: dict[str, dict] = {}
    for name, tallies in by_card.items():
        games = sum(n for n, _ in tallies.values())
        wins = sum(w for _, w in tallies.values())
        if games < MIN_GAMES:
            continue
        entry = {"games": games, "wins": wins, "gihWr": wins / games, "adjWr": None, "adjGames": None, "deck": None}
        adjusted = adjusted_from_decks(tallies, baselines, overall)
        if adjusted and adjusted["adjGames"] >= MIN_GAMES:
            entry.update(adjusted)
        out[name] = entry
    return overall, sum(games for games, _ in decks.values()), out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--event", required=True)
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--out", required=True)
    parser.add_argument("--archive", help="a local copy of the archive (its mtime is the asOf date)")
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="cubewarden-17lands-") as tmp:
        if args.archive:
            archive = Path(args.archive)
            as_of = dt.datetime.fromtimestamp(archive.stat().st_mtime, dt.timezone.utc).date().isoformat()
        else:
            # DuckDB picks the decompression from the extension: keep .csv.gz.
            archive = Path(tmp) / f"{args.event}.{args.format}.csv.gz"
            as_of = download(GAME_URL.format(event=args.event, format=args.format), archive)
        decks, by_card = gih_from_game_data(plain_csv(archive, Path(tmp)))
    overall, games, cards = summarize(decks, by_card)
    payload = {"event": args.event, "format": args.format, "asOf": as_of, "overall": overall, "games": games,
               "deckColors": any(deck for deck in decks), "cards": cards}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{args.event} {args.format}: {games} games, {len(cards)} cards with >= {MIN_GAMES} games, as of {as_of}", file=sys.stderr)


if __name__ == "__main__":
    main()
