# Scorekeeper rules and presets

Rules are independent choices, stored with each game. Presets supply defaults and a description; they do not run a separate scoring implementation. Customize defaults before starting a game. Changes to a preset catalog must not change existing saved games.

| Dimension | Implemented options | Meaning |
|---|---|---|
| Play style | Turn-based, free-for-all | Turn-based advances through player order. Free-for-all explicitly scores the chosen player and keeps that player selected. |
| Score entry | Add points, enter current total | Additive entries are summed; total entries replace the displayed total for that player. History retains every entry. |
| Winner | Highest, lowest | Applied when the game finishes. Ties include all tied winners. |
| Ending | Manual, fixed rounds, score limit | Rounds require turn-based play and a recorded turn for every player. A score limit ends immediately when anyone's total reaches or exceeds it. |

The score-limit trigger is independent of the winner rule: a penalty game can end when anyone reaches 100, then award the lowest score. There is no automatic final lap, tiebreaker or collective end-of-hand update in this release. When those rules matter, use manual ending until a dedicated rule exists.

## Presets

New games offer **Custom** and **Scrabble**. The game-name field starts blank and remains unchanged when switching presets. Player entry is always visible and editable.

| Preset | Form behavior | Scoring |
|---|---|---|
| Custom | All scoring controls are editable below name and players | Choose play style, score entry, winner and ending |
| Scrabble | Hide scoring controls and show a written summary | Turn-based, add points, highest total wins, manual finish |

Switching to Scrabble does not erase the Custom configuration. Switching back restores it. A Scrabble game always saves the fixed Scrabble rules, even if the user previously selected different Custom settings. Selecting fixed rounds switches play style to turn-based; choosing free-for-all changes a fixed-round ending to manual. Limits are shown only when relevant.

Scrabble is a scorekeeping preset. Tile/word legality and endgame tile adjustments are handled by players. Previously saved games using removed presets retain their recorded rules and can still be resumed.

Publisher reference: https://instructions.hasbro.com/en-us/instruction/Scrabble-Game

## History and compatibility

Old games default to turn-based, additive scoring with their existing ending rule. Every new game stores its actual rule values plus the originating preset ID/version. The preset label is provenance, not proof that defaults remain unmodified. Scoring always uses the stored values.

In total mode, the newest entry for a player determines their score. Editing an older total changes history without replacing the newer total. Undo restores the preceding recorded total and reevaluates completion. A fixed round is the minimum entry count across all players; selecting one player repeatedly cannot finish it before everyone participates.

Free scoring commands require an explicit playerId belonging to the game. Turn-based commands may only supply the selected next player's ID. All cloud writes retain optimistic version checks; “free-for-all” describes entry order within this single-scorekeeper app, not simultaneous multiplayer sessions.

The API advertises `scoringRulesVersion: 2` in `/account`. Clients block advanced cloud setup/import until version 2 is active so older servers cannot silently ignore the new fields. Website publication does not deploy the Azure API or update the iPhone binary.

## Next strategy families

Add a separate tested rule only when it changes score interpretation, turn eligibility or completion. Do not add one engine per named game.

1. **Category scorecards:** Yahtzee sections, one use per category, automatic bonuses and joker rules. Requires structured categories rather than a stream of arbitrary points.
2. **Countdown games:** Starting scores, exact-zero completion, busts and checkout requirements for darts. These need explicit validity rules rather than negative additive entries.
3. **Final-turn and hand completion:** Farkle final lap, fair last turns and atomic per-hand score entry. End immediately remains the default for existing target games.
4. **Best-of series:** Round winners, ties, match wins and separate round/match state. A round win must not be confused with raw points.
5. **Elimination and lives:** Player eligibility, knockout thresholds and last-player-standing results. Keep eliminated-player history.
6. **Teams and custom presets:** Team ownership and aggregation; user-saved copies of a rule configuration.

Each family needs create/score/edit/undo/import tests and parity between the local engine and authoritative C# API before a preset claims that behavior.
