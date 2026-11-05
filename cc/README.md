# Contingency Contract

Data and art for the game's seasonal challenge mode. Each season has one combat stage, replayed with a chosen set of Test Criteria. Built by `scripts/update-cc.py`, which reads every row of `ActivityContingencyContractTable`, so a new season needs a rerun and no code.

## Rerunning

Run it on the owner's PC, where the dump lives:

```
python scripts/update-cc.py C:/Users/Albert/Development/EndfieldDataDump/output
```

Open the game and run `EndfieldDataDump\run_all.bat` first. `--no-art` skips exporting pictures; `--no-wiki` uses only the tables. The script prints the gaps. Afterwards commit `cc/` and purge changed art on jsDelivr.

## Files

| Path | What it is |
|---|---|
| `index.json` | Every season, newest first |
| `seasons/<id>.json` | One season in full |
| `art/<id>/key.webp` | Season art, 1280 wide |
| `art/<id>/banner.webp` | Push banner, 1160 wide |
| `art/tags/<criterion id>.webp` | Criterion icon, 124×124, white with alpha |
| `art/medals/<id>.webp`, `<id>-plated.webp` | Medals, 400×400, their native size |
| `art/items/<icon id>.webp` | Item icons, 128×128 |
| `art/logo.webp`, `art/points.webp` | Mode logo, white; Test Criteria point icon |

Every path in the JSON is relative to the repo root. Enemy `portrait` paths point at the existing `icons/enemies/`.

## Sources and licence

Game tables and art are our own extraction. Text from endfield.wiki.gg is CC BY-SA 4.0 and must be credited on any page showing it: "endfield.wiki.gg, CC BY-SA 4.0". Any file with wiki text has an `attribution` block, and `descSource` says where each description came from.

Dates always come from the tables. Two wiki dates for Indigo are wrong and are corrected here:

- Combat end: the wiki's estimate is 26 Nov Asia and 25 Nov Americas/Europe. Tables: 25 Nov 06:00 UTC+8 and 24 Nov 17:00 UTC-5.
- Shop close: the wiki says 3 Dec. Tables and the official notes: 2 Dec 04:00.

| Data | Source |
|---|---|
| Grid, conflicts, keys, unlocks | `ContingencyContractTable`, `CcTagTable`, `ContingencyContractKeyLockTable` |
| First-clear rewards | `ContingencyContractLevelTable`, `RewardTable` |
| Dates | `ActivityConditionalMultiStageTable`, `TimeRangeTable` |
| Missions | `ActivityConditionalMultiStageTaskConfigTable`, `ActivityContingencyContractTaskGroupTable` |
| Shop | `ShopGoodsTable`, `RewardTable` |
| Stage, medal | `DungeonTable`, `AchievementTable`, `InstructionBook` |
| Waves | `jsondata/Persistent/SpawnerConfig/<scene>/` |
| Enemies | `EnemyTable`, `EnemyAttributeTemplateTable`, `EnemyDisplayInfoTable`, `EnemyTemplateDisplayInfoTable`, `EnemyAbilityDescTable` |
| Text | `I18nTextTable_EN`, then the wiki |

## `index.json`

```json
{
  "attribution": { "text": "...", "url": "...", "license": "...", "fetched": "2026-11-05" },
  "seasons": [{
    "id": "indigo", "activityId": "...", "gameId": "indie_contract002",
    "name": "Indigo Experimental Operation", "shortName": "Indigo", "fullName": "Contingency Contract: ...",
    "desc": "...", "currency": { "name": "Vitrified Indigo", "icon": "cc/art/items/..." },
    "start": { "asia": "2026-11-05T12:00:00+08:00", "americas": "2026-11-05T12:00:00-05:00" },
    "batch2": {}, "end": {}, "shopClose": {},
    "art": "cc/art/indigo/key.webp", "banner": "cc/art/indigo/banner.webp",
    "criteria": 39, "complete": false
  }]
}
```

Status isn't stored; derive it from the dates. `end` is when combat closes, `shopClose` when the shop does. Europe uses the `americas` clock. `complete` is false while any criterion lacks a name or description.

## `seasons/<id>.json`

| Field | Meaning |
|---|---|
| `attribution` | Present only if the file has wiki text |
| `rules`, `feature`, `stageRules` | Plain text: event rules, enemy notes, stage rules |
| `recommendLv` | Recommended operator level |
| `timer` | Stage time limit in seconds, or null. See "Not known yet" |
| `maxTotal`, `maxTotalByPhase` | Highest legal total, overall and by phase. See below |
| `ratingBands` | Result-screen tiers, from `rangeArray`: at or above the first value is tier 2, the second tier 3 |
| `importWarning` | The two totals where the game warns on importing a code, from `scoreBand` |
| `grid` | `{ cols, rows }`. `cols` is the game's `tagMaxColumn`; Re-Ignition's column 24 is empty |
| `keys` | Key id to `{ color, keyLabel, lockLabel }` |
| `criteria[]` | See below |
| `variants[]` | `{ id, note, inferred }`. Wave files; `note` is a reading of what differs |
| `waves[]` | `{ variant, wave, enemies: [{ id, count }] }` |
| `enemies` | Enemy id to its details, see below |
| `missions[]` | `{ id, group, name, desc, reward, opens }`. `opens` is per server; `name` can be null |
| `shop[]` | `{ id, item, count, price, limit, icon }`. `limit` 0 means no limit |
| `medal` | `{ name, desc, howTo, needs, icon, plate, plateIcon }`. `plate` is null if it can't be plated |
| `rewards[]` | The event's reward list. `count` is null where the game doesn't show one |
| `shareCode` | See below |

`criteria[]`:

| Field | Meaning |
|---|---|
| `id`, `col`, `row`, `points`, `icon` | Grid position is 1-based; `points` is 1–3 |
| `name`, `desc` | Null when unknown |
| `numeral` | `I`, `II`, `III` or an empty string |
| `descSource` | `game`, `wiki` or null |
| `matchedBy` | Only on criteria tied to the wiki without game text: `signature` or `icon` |
| `conflict` | Conflict group id, or null |
| `key` | Key id if this is a Key Criterion, or null |
| `locks` | Key ids this needs selected |
| `unlockTotal` | Best total the player must already have cleared |
| `unlockPhase` | 1, or 2 if it arrives with `batch2` |
| `firstClear` | Currency paid on first clear |

`enemies`: `name`, `level`, `hp`, `atk`, `def`, `hpBonus`, `stagger`, `res`, `abilities`, `portrait`, `desc`. `hp` is the base value; the fight's HP is `hp × (1 + hpBonus)`.

## Selection rules

From `CheckJoinedTagListValid` in `ContingencyContractUtils.lua`. A selection is legal when, for every selected criterion:

1. No other selected criterion has the same non-null `conflict`.
2. For each id in `locks`, a different selected criterion has that `key`.
3. `unlockTotal` is at most the player's best cleared total.
4. Its phase has opened. The game checks this in the picker, not on import.

Unselecting a key also drops its locked criteria; the game caches them and restores them if the key returns.

## `maxTotal`

Rules 1 and 2 only, since 3 and 4 depend on the player and date. Keys are the only choice that changes what else is legal, so:

1. Try every subset of the key criteria, skipping any with two from one conflict group.
2. For that subset, keep every non-key criterion whose locks are all met, leaving out groups a chosen key already uses.
3. Add the highest `points` in each conflict group, plus every criterion with no group, plus the chosen keys.
4. The best sum over all subsets is `maxTotal`. Filtering first to `unlockPhase <= p` gives `maxTotalByPhase[p]`.

Indigo gives 48 for phase 1, which matches the wiki, and 55 for phase 2. Re-Ignition gives 47 and 54.

## `shareCode`

The game exchanges selections as codes such as `<0000040G000001>`, in `GenShareCode` and `AnalyzeShareCode`.

```json
{
  "digits": "octal", "bitsPerColumn": 3, "rowWeights": [1, 2, 4],
  "alphabet": "0123456789ABCDEFGHJKMNPQRSTVWXYZ", "length": 14, "wrap": "<CODE>",
  "columns": [{ "col": 1, "rows": [110001, 110002, null] }],
  "examples": [{ "criteria": [110001, 110101], "total": 2, "code": "00000000000009" }]
}
```

Encode:

1. Each column is one octal digit: add `rowWeights[row - 1]` for each selected criterion in it. Several rows of a column can be set when they don't conflict.
2. Read the digits as one big number, with the **last** column as the most significant digit. Equivalently: value = sum of `digit(col) × 8^(col - 1)`. Use BigInt: 23 columns is 69 bits.
3. Write it in base 32 with `alphabet`, which leaves out I, L, O and U.
4. Pad on the left with `0` to `length`, which is `ceil(cols × 3 / 5)`.

Decode:

1. Take the text between `<` and `>` if present, otherwise the whole string. Upper-case it.
2. Reject it if its length isn't `length`, or a character isn't in `alphabet`.
3. Convert from base 32. Reject it if the value needs more than `cols` octal digits.
4. For each column, read its digit and map set bits to `columns[col - 1].rows`. A set bit on a null row, or an illegal selection, is an invalid code.

Worked examples, all checked against a line-for-line port of the game's base conversion:

Indigo, `[110001, 110101]`: 110001 is column 1 row 1, weight 1. 110101 is column 2 row 1, so its digit 1 is worth 8. The value is 9, which is base 32 `9`, padded to `00000000000009`.

Indigo, `[110001, 110302, 112901]`:

| Criterion | Column | Row | Worth |
|---|---|---|---|
| 110001 | 1 | 1 | 1 |
| 110302 | 12 | 2 | 2 × 8^11 |
| 112901 | 15 | 1 | 1 × 8^14 |

The total is `0000040G000001` in base 32, with 110302 as the key for 112901.

Re-Ignition, `[102801, 102103]`: 102801 is column 1 row 1, worth 1. 102103 is column 3 row 3, worth 4 × 8² = 256. The value is 257, and 257 = 8 × 32 + 1, so the code is `000000000000081`.

## Waves

Wave files are named `sc_<scene>_<number>.json`, and `variant` is the last digit. What selects a file isn't recorded, so `note` is a reading of what differs and `inferred` is true:

- Indigo 0 is two on-looking Rockhowlers, not a wave of the stage.
- Indigo 2 adds an Armored Manglerbeast.
- Re-Ignition 2 and 3 swap in α enemies.

## Not known yet

- **Indigo text:** the tables have no text for Indigo's criteria in any language, and only 18 of 39 are tied to wiki rows. See the gaps below. Rerun after the next dump.
- **Numbers in descriptions:** the game fills them from compiled code. The wiki supplies them, so a new season's descriptions need its wiki page.
- **`timer`:** always null. The script `CcStartStageSwitchTimer` is only the rest countdown between waves; the base limit wasn't found. Time Limit criteria take 45–300 s off it.

## Gaps on 2026-11-05

Indigo has no name or description for these 21 criteria. 7 are the 12 Nov batch, which the wiki doesn't list yet: 113201, 113803, 110502, 113402, 113701, 113702, 112303.

The other 14 are on the wiki, but nothing yet ties a row to an id: 110703, 112801, 112701, 110403, 110302, 113502, 112901, 112903, 110901, 110903, 111602, 113603, 113302, 111703.

Their wiki names are Edit: Fruity Slippers, Ambient: Aggro Focus, Ambient: Volatile Gains, Team: Lethargy, Ambient: Silence, Ambient: Combo Lock, Edit: Light Protection I and III, Edit: Blood Rush I and III, Edit: Solid Body, Team: Apathy, Edit: Hard Stacks, Team: Blunted Weapons.

`matchedBy` shows how the other 18 were tied: `icon` means the icon is the same as a Re-Ignition criterion of that name, and `signature` means points, numeral and key or lock left only one possibility.
