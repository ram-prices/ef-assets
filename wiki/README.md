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
