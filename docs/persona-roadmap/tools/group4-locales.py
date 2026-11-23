#!/usr/bin/env python3
"""Regenerate the trailing "helperG4" block in all 20 client locale files
from /workspace/wt/group4-rest/docs/persona-roadmap/group4-rest-copy.json
({"section.key": {"en":..,"es":..,"fr":..,"ht":..,"ar":..}}). Locales
without their own text get the English string (i18next fallback text)."""
import json, glob, os, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/group4-rest'
copy = json.load(open(os.path.join(root, 'docs/persona-roadmap/group4-rest-copy.json'), encoding='utf-8'))
MARK = '  "helperG4": {'
for path in sorted(glob.glob(os.path.join(root, 'client/src/locales/*.json'))):
    lang = os.path.basename(path)[:-5]
    s = open(path, encoding='utf-8').read()
    i = s.find('\n' + MARK)
    if i >= 0:
        head = s[:i].rstrip()
        assert head.endswith(','), path
        head = head[:-1]
    else:
        head = s.rstrip()
        assert head.endswith('}'), path
        head = head[:-1].rstrip()
    tree = {}
    for dotted, texts in copy.items():
        node = tree
        parts = dotted.split('.')
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = texts.get(lang) or texts['en']
    block = json.dumps(tree, ensure_ascii=False, indent=2).replace('\n', '\n  ')
    out = head + ',\n  "helperG4": ' + block + '\n}\n'
    json.loads(out)
    open(path, 'w', encoding='utf-8').write(out)
print('ok', len(copy))
