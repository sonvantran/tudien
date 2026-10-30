#!/usr/bin/env python3
"""Gộp các nguồn mở thành data/{en,ja,zh}.json cho server.

Nguồn (tải về thư mục src/ rồi chạy: python3 scripts/build_data.py src):
  stardict.db                          ECDICT (MIT)            github.com/skywind3000/ECDICT
  jmdict-eng-*.json                    JMdict (CC BY-SA 4.0)   github.com/scriptin/jmdict-simplified
  cedict.json                          CC-CEDICT (CC BY-SA)    npm: cedict-json
  hsk.json                             HSK complete            github.com/drkameleon/complete-hsk-vocabulary
  n1.csv ... n5.csv                    JLPT                    github.com/jamsinclair/open-anki-jlpt-decks (src/)
  vnedict.txt                          VNEDICT Việt-Anh        Paul Denisowski, denisowski.org
  kengdic.tsv                          KENGDIC Hàn-Anh (CC BY-SA 3.0 / LGPL 2.0)
                                       raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv
"""
import csv, glob, json, os, re, sqlite3, sys, unicodedata

SRC = sys.argv[1] if len(sys.argv) > 1 else 'src'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
os.makedirs(OUT, exist_ok=True)

def dump(name, obj):
    p = os.path.join(OUT, name)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    print(name, round(os.path.getsize(p) / 1e6, 1), 'MB')

# ---------------------------------------------------------------- English
def build_en():
    c = sqlite3.connect(os.path.join(SRC, 'stardict.db'))
    q = """select word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange
           from stardict
           where (translation!='' or definition!='')
             and ( (word not like '% %' and word not like '%-%' and (definition!='' or frq>0 or bnc>0 or tag!='' or oxford=1 or collins>0))
                   or (tag!='' or oxford=1 or collins>0 or (frq>0 and frq<30000)) )
             and word not glob '*[0-9]*'"""
    rows = []
    for w, ph, de, tr, pos, col, ox, tag, bnc, frq, ex in c.execute(q):
        if not re.match(r"^[A-Za-z][A-Za-z' .&/-]*$", w):
            continue
        rank = min([x for x in (frq, bnc) if x and x > 0] or [0])
        rows.append({'w': w, 'p': ph or '', 'd': (de or '').strip(), 't': (tr or '').strip(),
                     'g': (tag or '').split(), 'o': 1 if ox else 0, 'c': col or 0, 'r': rank, 'x': ex or ''})
    # Gộp trùng hoa/thường: giữ bản có nhiều thông tin hơn
    best = {}
    for r in rows:
        k = r['w'].lower()
        s = len(r['d']) + len(r['t']) + (50 if r['w'] == k else 0)
        if k not in best or s > best[k][0]:
            best[k] = (s, r)
    rows = [v[1] for v in best.values()]
    rows.sort(key=lambda r: (r['r'] == 0, r['r'] or 10**9, r['w'].lower()))
    dump('en.json', rows)

# --------------------------------------------------------------- Japanese
def build_ja():
    f = glob.glob(os.path.join(SRC, 'jmdict-eng-*.json'))[0]
    d = json.load(open(f, encoding='utf-8'))
    jl = {}
    for n in range(1, 6):
        p = os.path.join(SRC, f'n{n}.csv')
        if not os.path.exists(p):
            continue
        for r in csv.DictReader(open(p, encoding='utf-8')):
            jl.setdefault((r['expression'], r['reading']), n)
            jl.setdefault((r['expression'], ''), n)
            jl.setdefault((r['reading'], r['reading']), n)
    out = []
    for e in d['words']:
        ks = [k['text'] for k in e['kanji'] if 'rK' not in k['tags'] and 'sK' not in k['tags']] or [k['text'] for k in e['kanji']]
        rs = [k['text'] for k in e['kana']]
        common = 1 if any(k['common'] for k in e['kanji'] + e['kana']) else 0
        lvl = 0
        for k in (ks or rs):
            for r in rs:
                v = jl.get((k, r)) or jl.get((k, ''))
                if v and (lvl == 0 or v < lvl):
                    lvl = v
        senses = []
        for s in e['sense']:
            g = [x['text'] for x in s['gloss']]
            if not g:
                continue
            senses.append({'p': s['partOfSpeech'], 'g': g, 'm': s['misc'] + s['field'],
                           'i': s['info'][:1]})
        if not senses:
            continue
        out.append({'k': ks, 'r': rs, 's': senses, 'c': common, 'n': lvl})
    # JLPT csv: thêm các từ chưa khớp JMdict
    out.sort(key=lambda r: (r['n'] == 0, r['n'], -r['c'], len(r['k'][0] if r['k'] else r['r'][0])))
    dump('ja.json', {'tags': d['tags'], 'words': out})

# ---------------------------------------------------------------- Chinese
TONES = {'a': 'āáǎà', 'e': 'ēéěè', 'i': 'īíǐì', 'o': 'ōóǒò', 'u': 'ūúǔù', 'ü': 'ǖǘǚǜ'}
def syl(s):
    m = re.match(r'^([A-Za-züÜ:]+?)([1-5])?$', s)
    if not m: return s
    b, t = m.group(1).replace('u:', 'ü').replace('U:', 'Ü'), m.group(2)
    if not t or t == '5': return b
    t = int(t) - 1
    low = b.lower()
    for v in ('a', 'e', 'ou'):
        if v in low:
            i = low.index(v)
            ch = b[i]; rep = TONES[ch.lower()][t]
            return b[:i] + (rep.upper() if ch.isupper() else rep) + b[i + 1:]
    for i in range(len(b) - 1, -1, -1):
        if b[i].lower() in TONES:
            ch = b[i]; rep = TONES[ch.lower()][t]
            return b[:i] + (rep.upper() if ch.isupper() else rep) + b[i + 1:]
    return b
def pinyin(p): return ' '.join(syl(x) for x in p.split())
def strip(p):
    p = unicodedata.normalize('NFD', p)
    return re.sub(r'[̀-ͯ]', '', p).replace('ü', 'v').replace('u:', 'v').lower()

def build_zh():
    ce = json.load(open(os.path.join(SRC, 'cedict.json'), encoding='utf-8'))
    hsk = json.load(open(os.path.join(SRC, 'hsk.json'), encoding='utf-8'))
    H = {}
    for h in hsk:
        old = [int(x.split('-')[1]) for x in h['level'] if x.startswith('old-')]
        new = [int(x.split('-')[1]) for x in h['level'] if x.startswith('new-')]
        H[h['simplified']] = {'o': min(old) if old else 0, 'n': min(new) if new else 0,
                              'f': h.get('frequency') or 0, 'forms': h['forms'], 'pos': h.get('pos', [])}
    out, seen = [], set()
    for e in ce:
        s = e['simplified']
        h = H.get(s, {})
        p = pinyin(e['pinyin'])
        out.append({'s': s, 't': e['traditional'], 'p': p, 'm': e['english'],
                    'o': h.get('o', 0), 'n': h.get('n', 0), 'f': h.get('f', 0)})
        seen.add((s, strip(p).replace(' ', '')))
    for s, h in H.items():  # từ HSK mà CC-CEDICT không có hoặc khác cách đọc
        for f in h['forms']:
            p = f['transcriptions']['pinyin']
            key = (s, strip(p).replace(' ', ''))
            if key in seen:
                for r in out:
                    if r['s'] == s and strip(r['p']).replace(' ', '') == key[1]:
                        r['o'], r['n'], r['f'] = h['o'], h['n'], h['f']
                continue
            out.append({'s': s, 't': f['traditional'], 'p': p, 'm': f['meanings'],
                        'o': h['o'], 'n': h['n'], 'f': h['f']})
    out.sort(key=lambda r: (r['o'] == 0 and r['n'] == 0, r['o'] or 99, r['n'] or 99, r['f'] or 10**9, len(r['s'])))
    dump('zh.json', out)

# ------------------------------------------------------------------ Korean
def build_ko():
    """Gộp KENGDIC theo từ: mỗi từ một mục, nhiều nghĩa; l = cấp A/B/C/D -> 1..4 (0 = không có cấp)."""
    hangul = re.compile(r'[가-힣]')
    lv = {'A': 1, 'B': 2, 'C': 3, 'D': 4}
    groups = {}
    with open(os.path.join(SRC, 'kengdic.tsv'), encoding='utf-8', newline='') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            w = unicodedata.normalize('NFC', (r['surface'] or '').strip())
            w = re.sub(r'\s+', ' ', w)
            g = re.sub(r'\s+', ' ', (r['gloss'] or '').strip())
            if not w or not g or not hangul.search(w) or len(w) > 20 or len(g) > 200:
                continue
            groups.setdefault(w, []).append((lv.get(r['level'], 0), int(r['id']), g, (r['hanja'] or '').strip()))
    out = []
    for w, items in groups.items():
        items.sort(key=lambda t: (t[0] == 0, t[0], t[1]))
        seen, senses = set(), []
        for _, _, g, h in items:
            k = g.lower()
            if k in seen:
                continue
            seen.add(k)
            senses.append({'g': g, 'x': h} if h else {'g': g})
        levels = [t[0] for t in items if t[0]]
        out.append({'h': w, 's': senses[:12], 'l': min(levels) if levels else 0})
    out.sort(key=lambda e: (e['l'] == 0, e['l'], len(e['h']), e['h']))
    dump('ko.json', out)

# --------------------------------------------------------------- Vietnamese
def build_vi():
    rows = []
    for line in open(os.path.join(SRC, 'vnedict.txt'), encoding='utf-8-sig'):
        line = line.strip()
        if not line or line.startswith('#') or ' : ' not in line:
            continue
        vi, en = line.split(' : ', 1)
        vi, en = vi.strip(), en.strip()
        if vi and en:
            rows.append([vi, en])
    dump('vi.json', rows)

if __name__ == '__main__':
    for fn in (build_en, build_ja, build_zh, build_vi, build_ko):
        if len(sys.argv) > 2 and fn.__name__ != 'build_' + sys.argv[2]:
            continue
        fn()
