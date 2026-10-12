# Shared scoring API

All endpoints require `Authorization: Bearer <API access token>` from the configured External ID customer tenant. Base path is `/api`. Results use camelCase JSON. No cookie-based authentication.

| Method / path | Body | Result |
|---|---|---|
| GET `/games` | — | Up to 200 game summaries, most recently updated first |
| GET `/games/{id}` | — | GameView or 404 |
| POST `/games` | `{id,name,players:["A","B"],winner:"high"}` | 201 GameView; duplicate ID returns 409 |
| POST `/games/{id}/actions` | `{expectedVersion,action,points?,playerId?,entryId?}` | GameView with updated version |
| POST `/games/import` | Game state with original player/entry IDs | 201 GameView; duplicate ID returns 409 |

Actions: `score`, `select`, `edit`, `undo`, `finish`, `resume`. Score/edit points must be integers within ±1,000,000. Supports 2–20 players and at most 10,000 turns per game. High/low ties produce multiple winner IDs. No winner is declared before finishing or for a game with no turns.

GameView is `{game,totals,winnerIds}`. Game includes `id,name,players,winner,entries,next,finished,version,updated`. Totals are a map keyed by player GUID. Updated is an ISO timestamp; do not use it as the concurrency token.

Every action includes the last fetched game version. SQL updates compare the version atomically. A stale version returns 409 and does not mutate the game. Do not automatically retry writes: after a timeout the server may have committed. Fetch the current game, inspect history and let the user decide whether another entry is needed. A repeated create/import ID returns 409 without creating a duplicate.

Storage uses one JSON aggregate per game in SQL, with owner/version/index columns. This keeps turn changes atomic and avoids several per-turn SQL queries. It is suitable for the small app; analytical reporting or much larger histories would justify a normalized schema later. List responses are deliberately capped at 200; pagination is a future extension.

401 = missing/invalid token or delegated scope; 400 = invalid command/import; 404 = not found for current owner; 409 = version/ID conflict; 503 = temporary service/database failure.
