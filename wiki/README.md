# wiki/

Operator, weapon and gear data snapshotted from the
[Arknights: Endfield Wiki](https://endfield.wiki.gg/) by
`scripts/update-wiki.mjs` (`npm run wiki`), keyed by game id.

- `operators.json`: class, element, weapon, attributes, HP/ATK/attributes at
  levels 1/20/40/60/80/90, potentials, combat skills with per-rank values
  (ranks 1-12), talents, base skills, promotion costs.
- `weapons.json`: type, rarity, base ATK at 6 levels, potential, tuning costs,
  skills with their values at ranks 1-9.
- `gear.json`: gear pieces (defense, stats, set) and gear set effects.
- `events.json`: each event's rewards, keyed by its id in `schedule.json`
  (`scripts/event-rewards.mjs`, `npm run events`): the wiki page, `groups`
  of reward rows (a mission, a sign-in day, a milestone: its `label` and
  `[item, count]` rewards), and `totals` per item. Shops and exchanges are
  left out, except one paid in the event's own currency (AIC Support's Goods
  Exchange): its whole stock counts, in groups with `exchange` naming the
  currency. `partial: true` when the page names rewards without (all) their
  amounts (story events: "Oroberyl and other rewards"): its totals are a
  lower bound, and those items have a null count.
- `income.json`: regular income (`scripts/income.mjs`, `npm run
  income`): `daily` (Operational Manual → Daily, every day), `weekly` (Weekly
  Routine, every week), `passes` (each Protocol Pass season, its UTC
  `start`/`end` and each tier's rewards over levels 1-60: `rewards` = Basic
  Supply (free), `originium` = Originium Supply, `customized` = Protocol
  Customized), `passTiers` (what the paid tiers cost) and `monthly` (the
  Monthly Pass: price, per purchase, per day). Pull currencies only:
  Oroberyl, Origeometry, Arsenal Tickets, HH Permits. Also `compensation`:
  what each version's official Version Update Notes hand out in the mail,
  keyed by version name (from the official news feed, not the wiki).
  And `quests`: permanent missions' one-time rewards (Main, Side and
  Exploration Missions) by the version that released them, `caps` (how far
  each version's main story goes) and `how` each mission was placed
  (`story`, `listed` on the version's wiki page, its `region`, or `launch`).
  And `exploration`: the areas each version added with their crate and
  Aurylene counts (area infoboxes), plus a rough Oroberyl per crate
  (`perCrate`): per-type Oroberyl (GameWith) averaged over Wuling's crate
  mix (Gamer Guides), since no open source counts crates by type per area.
  `outposts`: each new outpost's level rewards. And `modes`: what each
  version's permanent modes hand out anew (Echoes of War seasons, Monumental
  Etching, Delver of the Cryptic, Trial Algorithmics; amounts from the
  official notes, else the challenge event's wiki page, else `partial`), with
  Etchspace Salvage's milestones split evenly over the versions that added to
  them (`estimate`). `exploration.aurylene`: each region's TP Point hand-in
  table and what each version's new areas' Aurylene unlocks (`partial`, with
  why, once a region's areas pass the end of its table on the wiki). And `extras`:
  hand-kept amounts no wiki page or official post lists (version preview
  livestream, version survey, SKPORT web check-in), each with its sources.

Text uses a small markup so it can be escaped safely: `**bold**`,
`⟦class|text⟧` highlights, `\n` line breaks; weapon skill text keeps `{0}`,
`{1}`... placeholders for its `values` columns.

## License

The wiki's content is licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). These files
are derived from it and are shared under the same license; each carries an
`attribution` block. Credit "endfield.wiki.gg" wherever the data is shown.
No wiki images are copied into these files; gear icons (`gear/<item id>.webp`)
are fetched separately by `scripts/gear-icons.py`.
