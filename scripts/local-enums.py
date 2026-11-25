#!/usr/bin/env python
"""
Enum names for a local EndfieldDataDump's tables, for combat.mjs / combat-bundle.mjs --local.

The local dump's tables hold enums as numbers (modifyType 5); the remote dump's hold their names (AddBuff).
This reads the game's own enum definitions (Beyond.GEnums.*) from global-metadata.dat, with the dump's
il2cpp_meta.py (read-only on the game install), and writes <dump>\\output\\enums.json: {enum: {value: name}}.

  python -I -X utf8 scripts/local-enums.py <dump folder> <game folder>

e.g. C:\\Users\\Albert\\Development\\EndfieldDataDump and "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Arknights Endfiled".
Run it from outside the dump folder (python -I keeps the current folder off the import path).
"""
import json
import os
import sys

dump, game = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(dump, 'dumper'))
import il2cpp_meta  # noqa: E402

m = il2cpp_meta.Metadata(os.path.join(game, 'Endfield_Data', 'il2cpp_data', 'Metadata', 'global-metadata.dat'))
out = {}
for ti in range(len(m.typedefs)):
    if not m.is_enum(ti):
        continue
    name = m.td_name(ti)
    if not name.startswith('Beyond.GEnums.'):
        continue
    vals = {}
    for fi in m.td_fields(ti):
        n = m.fields[fi][0]
        member = m.string(n)
        if member == 'value__':
            continue
        v = m.field_default(fi, 0x08)
        if v is not None:
            vals[str(v)] = member
    out[name[len('Beyond.GEnums.'):]] = vals
path = os.path.join(dump, 'output', 'enums.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=0)
print(f'{len(out)} enums -> {path}')
