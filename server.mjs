// Server tra từ offline, không cần cài thêm gói nào (Node 18 trở lên).
// Chạy: node server.mjs   rồi mở http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const auth = createAuth(path.join(ROOT, 'accounts'));

/* ------------------------------------------------------------ tiện ích */
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isCJK = (s) => /[぀-ヿ㐀-鿿豈-﫿]/.test(s);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function lowerBound(keys, q) { let lo = 0, hi = keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m][0] < q) lo = m + 1; else hi = m; } return lo; }
function prefixIds(keys, q, cap) {
  const out = []; let i = lowerBound(keys, q);
  while (i < keys.length && keys[i][0].startsWith(q) && out.length < cap) out.push(keys[i++][1]);
  return out;
}
const uniq = (a) => [...new Set(a)];
const parseIds = (s, max, n) => (s || '').split(',').filter((x) => x !== '').map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < max);


/* ------------------------------------------------------------ Tiếng Việt (VNEDICT, Việt–Anh) */
const nd = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
function splitGlosses(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if ((ch === ';' || ch === ',') && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const gnorm = (g) => g.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/^(to|a|an|the)\s+/, '').replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
const vi = {
  name: 'Tiếng Việt', speech: 'vi-VN', decks: [],
  load() {
    this.rows = JSON.parse(fs.readFileSync(path.join(DATA, 'vi.json'), 'utf8'));
    this.gl = []; this.bad = new Set(); this.rev = new Map(); this.keys = []; this.exact = new Map(); this.cache = new Map();
    this.rows.forEach(([v, e], i) => {
      const gl = splitGlosses(e); this.gl.push(gl);
      const seen = new Set();
      gl.forEach((g, pos) => { const k = gnorm(g); if (k.length > 1 && !seen.has(k)) { seen.add(k); if (!this.rev.has(k)) this.rev.set(k, []); this.rev.get(k).push([i, pos]); } });
      if (/slang|vulgar|baby|child|colloq|archaic|dialect|obscene|offensive|derogatory|coarse|taboo|transliteration/i.test(e)) this.bad.add(i);
      this.keys.push([nd(v), i]);
      const lk = v.toLowerCase(); if (!this.exact.has(lk)) this.exact.set(lk, []); this.exact.get(lk).push(i);
    });
    this.keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    // Độ phổ biến gần đúng của từ tiếng Việt: tần suất các âm tiết trong toàn bộ từ điển.
    this.tok = new Map();
    for (const [v] of this.rows) for (const t of v.toLowerCase().split(/\s+/)) this.tok.set(t, (this.tok.get(t) || 0) + 1);
  },
  common(v) { const ts = v.toLowerCase().split(/\s+/); return ts.reduce((a, t) => a + Math.log(1 + (this.tok.get(t) || 0)), 0) / ts.length; },
  // Gợi ý nghĩa tiếng Việt cho một danh sách nghĩa tiếng Anh (tra ngược VNEDICT), từ quan trọng nhất đứng trước.
  lookup(words) {
    const score = new Map();
    words.forEach((w, wi) => {
      const k = gnorm(w); if (!k) return;
      for (const [i, pos] of this.rev.get(k) || []) {
        if (this.bad.has(i)) continue;
        const base = pos === 0 ? 1 : pos === 1 ? 0.7 : 0.45;
        const nw = this.rows[i][0].split(/\s+/).length;
        score.set(i, (score.get(i) || 0) + (base / (1 + wi * 0.4)) / Math.pow(this.gl[i].length, 0.25) / (1 + 0.12 * (nw - 1)) * (0.6 + 0.14 * this.common(this.rows[i][0])));
      }
    });
    const ranked = [...score.entries()].filter(([i]) => this.rows[i][0].split(/\s+/).length <= 5).sort((a, b) => b[1] - a[1] || this.rows[a[0]][0].length - this.rows[b[0]][0].length);
    const out = [], seen = new Set();
    for (const [i] of ranked) { const v = this.rows[i][0], lk = v.toLowerCase(); if (seen.has(lk)) continue; seen.add(lk); out.push(v); if (out.length >= 4) break; }
    return out;
  },
  row(i) { return { id: i, head: this.rows[i][0], reading: '', short: this.rows[i][1], badges: [] }; },
  view(i) {
    const gl = this.gl[i];
    const links = uniq(gl.map(gnorm).filter((k) => k.length > 1)).slice(0, 4);
    return { id: i, head: this.rows[i][0], reading: '', badges: [], senses: gl.map((t) => ({ text: t })), links };
  },
  search(q, cap) {
    q = q.trim(); if (!q) return [];
    const out = []; const add = (i) => { if (!out.includes(i)) out.push(i); };
    const lq = q.toLowerCase(), k = nd(q);
    (this.exact.get(lq) || []).forEach(add);
    prefixIds(this.keys, k, 600).filter((i) => nd(this.rows[i][0]) === k).forEach(add);
    prefixIds(this.keys, k, 600).sort((a, b) => this.rows[a][0].length - this.rows[b][0].length || a - b).forEach((i) => { if (out.length < cap) add(i); });
    if (/^[a-z0-9' -]+$/i.test(q) && out.length < cap) {
      (this.rev.get(gnorm(q)) || []).slice().sort((a, b) => a[1] - b[1] || this.gl[a[0]].length - this.gl[b[0]].length || this.rows[a[0]][0].length - this.rows[b[0]][0].length).forEach(([i]) => { if (out.length < cap) add(i); });
    }
    return out.slice(0, cap);
  },
};

/* ------------------------------------------------------------ Tiếng Anh */
const EN_FORMS = { p: 'quá khứ', d: 'quá khứ phân từ', i: 'V-ing', 3: 'ngôi thứ ba số ít', s: 'số nhiều', r: 'so sánh hơn', t: 'so sánh nhất' };
const EN_DECKS = [
  { id: 'ielts', group: 'IELTS', label: 'IELTS', f: (e) => e.g.includes('ielts') },
  { id: 'toefl', group: 'IELTS', label: 'TOEFL (học thuật)', f: (e) => e.g.includes('toefl') },
  { id: 'gre', group: 'IELTS', label: 'GRE (nâng cao)', f: (e) => e.g.includes('gre') },
  { id: 'oxford', group: 'TOEIC', label: 'Oxford 3000', f: (e) => e.o === 1 },
  { id: 'cet4', group: 'TOEIC', label: 'CET-4 (trung cấp)', f: (e) => e.g.includes('cet4') },
  { id: 'cet6', group: 'TOEIC', label: 'CET-6 (khá)', f: (e) => e.g.includes('cet6') },
  { id: 'f1', group: 'TOEIC', label: 'Tần suất 1 – 1000', f: (e, i) => i < 1000 && !e.w.includes(' ') },
  { id: 'f2', group: 'TOEIC', label: 'Tần suất 1001 – 3000', f: (e, i) => i >= 1000 && i < 3000 && !e.w.includes(' ') },
  { id: 'f3', group: 'TOEIC', label: 'Tần suất 3001 – 6000', f: (e, i) => i >= 3000 && i < 6000 && !e.w.includes(' ') },
];
const en = {
  name: 'Tiếng Anh', speech: 'en-US',
  load() {
    this.rows = JSON.parse(fs.readFileSync(path.join(DATA, 'en.json'), 'utf8'));
    this.map = new Map(); this.forms = new Map(); this.keys = [];
    this.rows.forEach((e, i) => { const k = e.w.toLowerCase(); if (!this.map.has(k)) { this.map.set(k, i); this.keys.push([k, i]); } });
    this.rows.forEach((e, i) => {
      if (!e.x) return;
      for (const part of e.x.split('/')) {
        const c = part.indexOf(':'); if (c < 0) continue;
        const t = part.slice(0, c), w = part.slice(c + 1).toLowerCase();
        if (t === '0' || t === '1') continue;
        if (EN_FORMS[t] && !this.map.has(w) && !this.forms.has(w)) this.forms.set(w, i);
      }
    });
    this.keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.decks = EN_DECKS.map((d) => ({ id: d.id, group: d.group, label: d.label, ids: this.rows.reduce((a, e, i) => { if (d.f(e, i)) a.push(i); return a; }, []) }));
  },
  // Nghĩa ngắn: ưu tiên bản dịch tiếng Trung (ECDICT xếp theo nghĩa thông dụng), nếu không có thì dùng định nghĩa tiếng Anh.
  short(e) {
    const t = e.t.split('\n').find((l) => l && !l.startsWith('[')) || '';
    const zhs = t.replace(/^[a-z]+\.\s*/i, '').trim();
    return zhs || e.d.split('\n')[0] || '';
  },
  short2(e) { return e.d ? e.d.split('\n').slice(0, 2).join(' / ') : ''; },
  badges(e) {
    const b = []; if (e.o) b.push('Oxford 3000');
    for (const t of ['ielts', 'toefl', 'cet4', 'cet6', 'gre']) if (e.g.includes(t)) b.push({ ielts: 'IELTS', toefl: 'TOEFL', cet4: 'CET-4', cet6: 'CET-6', gre: 'GRE' }[t]);
    return b;
  },
  row(i) { const e = this.rows[i]; return { id: i, head: e.w, reading: e.p ? `/${e.p}/` : '', short: this.short(e), short2: this.short2(e), badges: this.badges(e) }; },
  view(i) {
    const e = this.rows[i];
    const senses = [];
    if (e.d) for (const l of e.d.split('\n')) senses.push({ text: l });
    if (e.t) for (const l of e.t.split('\n')) senses.push({ text: l, zh: true });
    const forms = [];
    let lemma = null;
    for (const part of (e.x || '').split('/')) {
      const c = part.indexOf(':'); if (c < 0) continue;
      const t = part.slice(0, c), w = part.slice(c + 1);
      if (t === '0') { const li = this.map.get(w.toLowerCase()); if (li !== undefined) lemma = { id: li, head: w }; }
      else if (EN_FORMS[t]) forms.push({ label: EN_FORMS[t], text: w });
    }
    return { id: i, head: e.w, reading: e.p ? `/${e.p}/` : '', badges: this.badges(e), senses, forms, lemma, rank: e.r || null, collins: e.c || 0 };
  },
  search(q, cap) {
    const lq = q.toLowerCase().trim(); if (!lq) return [];
    const out = [];
    const add = (i) => { if (i !== undefined && !out.includes(i)) out.push(i); };
    if (isCJK(q)) {
      for (let i = 0; i < this.rows.length && out.length < cap; i++) if (this.rows[i].t.includes(q)) out.push(i);
      return out;
    }
    add(this.map.get(lq)); add(this.forms.get(lq));
    const pre = prefixIds(this.keys, lq, 400).sort((a, b) => a - b);
    for (const i of pre) { if (out.length >= cap) break; add(i); }
    if (out.length === 0 && lq.length >= 4) {
      const re = new RegExp('(^|[^a-z])' + lq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      for (let i = 0; i < this.rows.length && out.length < cap; i++) { const e = this.rows[i]; if (e.d && re.test(e.d) && !e.w.includes(' ')) add(i); }
    }
    return out.slice(0, cap);
  },
};

/* ------------------------------------------------------------ Tiếng Nhật */
const ROMA = (() => {
  const t = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ', ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と', na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の', ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ', ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も', ya: 'や', yu: 'ゆ', yo: 'よ', ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', wa: 'わ', wo: 'を', ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご', za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ', da: 'だ', de: 'で', do: 'ど', ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ', pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ', kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', sha: 'しゃ', shu: 'しゅ', sho: 'しょ', cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ', mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ', ja: 'じゃ', ju: 'じゅ', jo: 'じょ', bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ', fa: 'ふぁ', n: 'ん' };
  return t;
})();
function romajiToKana(s) {
  s = s.toLowerCase(); let out = '', i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '-' ) { i++; continue; }
    if (i + 1 < s.length && c === s[i + 1] && /[kstpcgzdbfhmrjwy]/.test(c)) { out += 'っ'; i++; continue; }
    let hit = null;
    for (const n of [3, 2, 1]) {
      const p = s.substr(i, n);
      if (ROMA[p] && !(p === 'n' && /[aiueoy]/.test(s[i + 1] || ''))) { hit = p; break; }
    }
    if (!hit) return null;
    out += ROMA[hit]; i += hit.length;
  }
  return out;
}
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const JA_TAG = {
  n: 'danh từ', 'n-adv': 'danh từ trạng ngữ', 'n-t': 'danh từ thời gian', 'n-pref': 'danh từ tiền tố', 'n-suf': 'danh từ hậu tố', pn: 'đại từ', vs: 'danh từ + suru', 'vs-i': 'động từ suru', 'vs-s': 'động từ suru', 'vs-c': 'động từ su',
  vt: 'tha động từ', vi: 'tự động từ', v1: 'động từ nhóm 2 (ichidan)', 'v1-s': 'động từ nhóm 2', v5u: 'động từ nhóm 1 (-u)', v5k: 'động từ nhóm 1 (-ku)', 'v5k-s': 'động từ nhóm 1 (iku)', v5g: 'động từ nhóm 1 (-gu)', v5s: 'động từ nhóm 1 (-su)', v5t: 'động từ nhóm 1 (-tsu)', v5n: 'động từ nhóm 1 (-nu)', v5b: 'động từ nhóm 1 (-bu)', v5m: 'động từ nhóm 1 (-mu)', v5r: 'động từ nhóm 1 (-ru)', 'v5r-i': 'động từ nhóm 1 (bất quy tắc)', 'v5u-s': 'động từ nhóm 1 (đặc biệt)', v5aru: 'động từ nhóm 1 (-aru)', vk: 'động từ kuru', vz: 'động từ zuru',
  'adj-i': 'tính từ -i', 'adj-na': 'tính từ -na', 'adj-no': 'tính từ + no', 'adj-pn': 'liên thể từ', 'adj-t': 'tính từ taru', 'adj-f': 'danh từ/động từ bổ nghĩa', 'adj-ix': 'tính từ -i (yoi/ii)', adv: 'phó từ', 'adv-to': 'phó từ + to', aux: 'trợ từ phụ', 'aux-v': 'trợ động từ', 'aux-adj': 'trợ tính từ', conj: 'liên từ', cop: 'hệ từ', ctr: 'đếm (lượng từ)', exp: 'cách nói', int: 'thán từ', num: 'số từ', pref: 'tiền tố', suf: 'hậu tố', prt: 'trợ từ', unc: 'chưa phân loại',
  uk: 'thường viết bằng kana', col: 'văn nói', pol: 'lịch sự', hon: 'kính ngữ', hum: 'khiêm nhường', arch: 'cổ', sl: 'tiếng lóng', fam: 'thân mật', abbr: 'viết tắt', yoji: 'thành ngữ bốn chữ', id: 'thành ngữ', vulg: 'thô tục', derog: 'xúc phạm', obsc: 'ít dùng', rare: 'hiếm', 'on-mim': 'từ tượng thanh/tượng hình', male: 'lời nam', fem: 'lời nữ', form: 'trang trọng', joc: 'đùa', poet: 'thơ', obs: 'lỗi thời', 'ateji': 'ateji', 'gikun': 'gikun', 'uK': 'thường viết bằng kanji', ik: 'kana không chuẩn',
};
const ja = {
  name: 'Tiếng Nhật', speech: 'ja-JP',
  load() {
    const d = JSON.parse(fs.readFileSync(path.join(DATA, 'ja.json'), 'utf8'));
    this.tags = d.tags; this.rows = d.words; this.keys = [];
    this.rows.forEach((e, i) => { for (const t of uniq([...e.k, ...e.r])) this.keys.push([kataToHira(t), i]); });
    this.keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    this.decks = [5, 4, 3, 2, 1].map((n) => ({ id: 'n' + n, group: 'JLPT', label: 'JLPT N' + n, ids: this.rows.reduce((a, e, i) => { if (e.n === n) a.push(i); return a; }, []) }));
  },
  head(e) { return e.k[0] || e.r[0]; },
  short(e) { return e.s[0].g.slice(0, 3).join('; '); },
  badges(e) { const b = []; if (e.n) b.push('JLPT N' + e.n); if (e.c) b.push('Thông dụng'); return b; },
  row(i) { const e = this.rows[i]; return { id: i, head: this.head(e), reading: e.k.length ? e.r[0] : '', short: this.short(e), badges: this.badges(e) }; },
  view(i) {
    const e = this.rows[i];
    const tag = (t) => JA_TAG[t] || (this.tags[t] || t).split(',')[0].replace(/\s*\(.*$/, '').trim();
    return {
      id: i, head: this.head(e), reading: e.r.join('、'), badges: this.badges(e),
      alt: e.k.slice(1),
      senses: e.s.map((s) => ({ pos: s.p.map(tag).join(', '), text: s.g.join('; '), note: [...s.m.map(tag), ...s.i].join(' · ') })),
    };
  },
  search(q, cap) {
    q = q.trim(); if (!q) return [];
    const out = [];
    const add = (i) => { if (!out.includes(i)) out.push(i); };
    const rank = (ids) => ids.sort((a, b) => { const A = this.rows[a], B = this.rows[b]; return (B.c - A.c) || ((A.n || 9) - (B.n || 9)) || (a - b); });
    let key = kataToHira(q);
    if (/^[a-zA-Z' -]+$/.test(q)) {
      const kana = romajiToKana(q);
      if (kana) { key = kana; }
      else key = null;
    }
    if (key) {
      const ids = prefixIds(this.keys, key, 1500);
      const exact = ids.filter((i) => this.rows[i].k.includes(q) || this.rows[i].r.some((r) => kataToHira(r) === key));
      rank(exact).forEach(add);
      rank(ids.filter((i) => !out.includes(i))).forEach((i) => { if (out.length < cap) add(i); });
    }
    if (!isCJK(q) && out.length < cap && q.length >= 2) {
      const lq = q.toLowerCase();
      const scored = [];
      for (let i = 0; i < this.rows.length; i++) {
        let best = 0;
        for (const s of this.rows[i].s) for (const g of s.g) {
          const x = g.toLowerCase(); let sc = 0;
          if (x === lq || x === 'to ' + lq || x === 'a ' + lq) sc = 3;
          else if (x.startsWith(lq + ' ') || x.startsWith('to ' + lq + ' ')) sc = 2;
          else if (x.includes(lq)) sc = 1;
          if (sc > best) best = sc;
        }
        if (best) scored.push([best * 10 + (this.rows[i].c ? 5 : 0) + (this.rows[i].n ? 3 : 0), i]);
      }
      scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (const [, i] of scored) { if (out.length >= cap) break; if (!out.includes(i)) out.push(i); }
    } else if (isCJK(q) && out.length < cap) {
      for (let i = 0; i < this.rows.length && out.length < cap; i++) if (this.rows[i].k.some((k) => k.includes(q)) && !out.includes(i)) out.push(i);
    }
    return out.slice(0, cap);
  },
};

/* ------------------------------------------------------------ Tiếng Trung */
const zhKey = (p) => norm(p).replace(/ü/g, 'v').replace(/[^a-z]/g, '');
const zh = {
  name: 'Tiếng Trung', speech: 'zh-CN',
  load() {
    this.rows = JSON.parse(fs.readFileSync(path.join(DATA, 'zh.json'), 'utf8'));
    this.keys = []; this.pykeys = [];
    this.rows.forEach((e, i) => { this.keys.push([e.s, i]); if (e.t !== e.s) this.keys.push([e.t, i]); this.pykeys.push([zhKey(e.p), i]); });
    this.keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    this.pykeys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    const mk = (id, label, f, group) => { const seen = new Set(); const ids = []; this.rows.forEach((e, i) => { if (f(e) && !seen.has(e.s)) { seen.add(e.s); ids.push(i); } }); return { id, group, label, ids }; };
    this.decks = [
      ...[1, 2, 3, 4, 5, 6].map((n) => mk('h2-' + n, `HSK ${n} (bản 2.0)`, (e) => e.o === n, 'HSK 2.0')),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => mk('h3-' + n, n === 7 ? 'HSK 7–9 (bản 3.0)' : `HSK ${n} (bản 3.0)`, (e) => e.n === n, 'HSK 3.0')),
    ];
  },
  short(e) { return e.m.slice(0, 3).join('; '); },
  badges(e) { const b = []; if (e.o) b.push('HSK ' + e.o); if (e.n) b.push(e.n === 7 ? 'HSK3.0 7–9' : 'HSK3.0 ' + e.n); return b; },
  row(i) { const e = this.rows[i]; return { id: i, head: e.s, reading: e.p, short: this.short(e), badges: this.badges(e) }; },
  view(i) {
    const e = this.rows[i];
    return { id: i, head: e.s, reading: e.p, badges: this.badges(e), alt: e.t !== e.s ? ['Phồn thể: ' + e.t] : [], senses: e.m.map((m) => ({ text: m })) };
  },
  search(q, cap) {
    q = q.trim(); if (!q) return [];
    const out = []; const add = (i) => { if (!out.includes(i)) out.push(i); };
    const rank = (ids) => ids.sort((a, b) => { const A = this.rows[a], B = this.rows[b]; return ((A.o || A.n ? 0 : 1) - (B.o || B.n ? 0 : 1)) || ((A.o || 9) - (B.o || 9)) || ((A.f || 1e9) - (B.f || 1e9)) || (a - b); });
    if (isCJK(q)) {
      const ids = prefixIds(this.keys, q, 3000);
      rank(ids.filter((i) => this.rows[i].s === q || this.rows[i].t === q)).forEach(add);
      rank(ids.filter((i) => !out.includes(i))).forEach((i) => { if (out.length < cap) add(i); });
      if (out.length < cap) for (let i = 0; i < this.rows.length && out.length < cap; i++) if ((this.rows[i].s.includes(q) || this.rows[i].t.includes(q)) && !out.includes(i)) out.push(i);
    } else {
      const k = zhKey(q);
      if (k) {
        const ids = prefixIds(this.pykeys, k, 3000);
        rank(ids.filter((i) => zhKey(this.rows[i].p) === k)).forEach(add);
        rank(ids.filter((i) => !out.includes(i))).forEach((i) => { if (out.length < cap) add(i); });
      }
      if (out.length < cap && q.length >= 2) {
        const lq = q.toLowerCase(); const sc = [];
        for (let i = 0; i < this.rows.length; i++) {
          let best = 0;
          for (const m of this.rows[i].m) { const x = m.toLowerCase(); let s = 0; if (x === lq || x === 'to ' + lq) s = 3; else if (x.startsWith(lq + ' ') || x.startsWith('to ' + lq + ' ')) s = 2; else if (x.includes(lq)) s = 1; if (s > best) best = s; }
          if (best) sc.push([best * 10 + (this.rows[i].o ? 5 : 0), i]);
        }
        sc.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        for (const [, i] of sc) { if (out.length >= cap) break; add(i); }
      }
    }
    return out.slice(0, cap);
  },
};

/* ------------------------------------------------------------ Tiếng Hàn (KENGDIC, Hàn–Anh) */
// Phiên âm Romaja (gần đúng): chuyển từng âm tiết, có nối âm đơn giản (한국어 -> hangugeo), không xét đồng hóa phụ âm.
const RR_I = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const RR_V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const RR_F = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'p', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// Phụ âm cuối đơn có thể nối sang âm tiết sau khi âm tiết sau bắt đầu bằng ㅇ: chỉ số final -> romaja khi nối.
const RR_LINK = { 1: 'g', 2: 'kk', 4: 'n', 7: 'd', 8: 'r', 16: 'm', 17: 'b', 19: 's', 20: 'ss', 22: 'j', 23: 'ch', 24: 'k', 25: 't', 26: 'p', 27: '' };
function romaja(s) {
  const syl = [...s.normalize('NFC')]; let out = '', carry = '';
  for (let i = 0; i < syl.length; i++) {
    const c = syl[i].charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += /[A-Za-z0-9]/.test(syl[i]) ? syl[i].toLowerCase() : ' '; carry = ''; continue; }
    const ini = Math.floor(c / 588), vow = Math.floor((c % 588) / 28), fin = c % 28;
    const nx = syl[i + 1] ? syl[i + 1].charCodeAt(0) - 0xac00 : -1;
    out += (carry || RR_I[ini]) + RR_V[vow]; carry = '';
    if (fin && fin in RR_LINK && nx >= 0 && nx <= 11171 && Math.floor(nx / 588) === 11) carry = RR_LINK[fin];
    else out += RR_F[fin];
  }
  return out.replace(/\s+/g, ' ').trim();
}
const KO_DECKS = [
  { id: 'ka', label: 'Cơ bản (cấp A)', f: (e) => e.l === 1 },
  { id: 'kb', label: 'Trung cấp (cấp B)', f: (e) => e.l === 2 },
  { id: 'kc', label: 'Nâng cao (cấp C)', f: (e) => e.l === 3 },
];
const ko = {
  name: 'Tiếng Hàn', speech: 'ko-KR',
  load() {
    this.rows = JSON.parse(fs.readFileSync(path.join(DATA, 'ko.json'), 'utf8'));
    this.map = new Map(); this.keys = []; this.rom = []; this.rk = [];
    this.rows.forEach((e, i) => {
      this.map.set(e.h, i); this.keys.push([e.h, i]);
      e.r = romaja(e.h); this.rk.push([e.r.replace(/ /g, ''), i]);
    });
    this.keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    this.rk.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    this.decks = KO_DECKS.map((d) => ({ id: d.id, group: 'Cấp độ KENGDIC', label: d.label, ids: this.rows.reduce((a, e, i) => { if (d.f(e)) a.push(i); return a; }, []) }));
  },
  short(e) { return e.s.slice(0, 3).map((x) => x.g).join('; '); },
  badges(e) { return e.l ? ['Cấp ' + 'ABCD'[e.l - 1]] : []; },
  row(i) { const e = this.rows[i]; return { id: i, head: e.h, reading: e.r, short: this.short(e), badges: this.badges(e) }; },
  view(i) {
    const e = this.rows[i];
    const hanja = uniq(e.s.map((x) => x.x).filter(Boolean));
    return { id: i, head: e.h, reading: e.r, badges: this.badges(e), alt: hanja.length ? ['Hán tự: ' + hanja.join('、')] : [], senses: e.s.map((x) => ({ text: x.g, note: x.x ? 'Hán tự ' + x.x : '' })) };
  },
  search(q, cap) {
    q = q.normalize('NFC').trim(); if (!q) return [];
    const out = []; const add = (i) => { if (i !== undefined && !out.includes(i)) out.push(i); };
    const rank = (ids) => ids.sort((a, b) => { const A = this.rows[a], B = this.rows[b]; return ((A.l || 9) - (B.l || 9)) || (B.s.length - A.s.length) || (A.h.length - B.h.length) || (a - b); });
    if (/[가-힣ㄱ-ㅣ]/.test(q)) {
      add(this.map.get(q));
      // Dạng chia thường gặp (먹었어요 -> 먹다): thử bỏ dần đuôi rồi thêm 다
      if (q.length >= 2 && !this.map.has(q)) for (let k = q.length - 1; k >= 1; k--) { const i = this.map.get(q.slice(0, k) + '다'); if (i !== undefined) { add(i); break; } }
      const ids = prefixIds(this.keys, q, 1500);
      rank(ids.filter((i) => !out.includes(i))).forEach((i) => { if (out.length < cap) add(i); });
    } else if (isCJK(q)) {
      for (let i = 0; i < this.rows.length && out.length < cap; i++) if (this.rows[i].s.some((x) => x.x && x.x.includes(q))) out.push(i);
    } else {
      const lq = q.toLowerCase(), rq = lq.replace(/[^a-z]/g, '');
      if (rq) rank(prefixIds(this.rk, rq, 800).filter((i) => this.rows[i].r.replace(/ /g, '') === rq)).forEach(add);
      if (lq.length >= 2) {
        const scored = [];
        for (let i = 0; i < this.rows.length; i++) {
          let best = 0;
          for (const s of this.rows[i].s) {
            const x = s.g.toLowerCase().replace(/^(to|a|an|the)\s+/, ''); let sc = 0;
            if (x === lq) sc = 3; else if (x.startsWith(lq + ' ') || x.startsWith(lq + ',')) sc = 2; else if (x.includes(lq)) sc = 1;
            if (sc > best) best = sc;
          }
          if (best) scored.push([best * 10 + (this.rows[i].l ? 6 - this.rows[i].l : 0), i]);
        }
        scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        for (const [, i] of scored) { if (out.length >= cap) break; add(i); }
      }
      if (rq) rank(prefixIds(this.rk, rq, 800).filter((i) => !out.includes(i))).forEach((i) => { if (out.length < cap) add(i); });
    }
    return out.slice(0, cap);
  },
};

/* Gắn gợi ý nghĩa tiếng Việt (tra ngược từ VNEDICT) vào en/ja/zh. */
en.glossWords = function (i) {
  const e = this.rows[i]; const w = [e.w.toLowerCase()];
  const m = /(?:^|\/)0:([^/]+)/.exec(e.x || ''); if (m) w.push(m[1].toLowerCase());
  return w;
};
ja.glossWords = function (i) {
  const w = [];
  for (const s of this.rows[i].s.slice(0, 3)) for (const g of s.g.slice(0, 3)) w.push(g);
  return w;
};
zh.glossWords = function (i) {
  return this.rows[i].m.filter((m) => m.length < 50 && !/^(CL:|surname|see |also pr|variant of|old variant)/i.test(m)).slice(0, 4);
};
for (const L of [en, ja, zh, ko]) {
  L.viOf = function (i) {
    this.vcache ||= new Map();
    let v = this.vcache.get(i); if (v === undefined) { v = vi.lookup(this.glossWords(i)); this.vcache.set(i, v); }
    return v;
  };
  const row0 = L.row.bind(L), view0 = L.view.bind(L);
  L.row = function (i) { const r = row0(i); const v = this.viOf(i); if (v.length) r.vi = v.slice(0, 3).join('; '); return r; };
  L.view = function (i) { const r = view0(i); r.vi = this.viOf(i); return r; };
}

ko.glossWords = function (i) {
  const w = [];
  for (const s of this.rows[i].s.slice(0, 3)) for (const g of splitGlosses(s.g.replace(/^\d\)\s*/, '')).slice(0, 3)) if (!/[가-힣]/.test(g)) w.push(g.replace(/\s+or\s+/gi, ' '));
  return w.slice(0, 5);
};
const LANGS = { en, ja, zh, ko, vi };
const loaded = {};
function lang(code) {
  const L = LANGS[code]; if (!L) return null;
  if (code !== 'vi') lang('vi');
  if (!loaded[code]) { const t = Date.now(); L.load(); loaded[code] = true; console.log(`  đã nạp ${L.name}: ${L.rows.length.toLocaleString('vi')} mục (${Date.now() - t} ms)`); }
  return L;
}

/* ------------------------------------------------------------ API */
function json(res, obj, code = 200) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(b);
}
function quiz(L, deck, n, dir, idsParam) {
  const d = L.decks.find((x) => x.id === deck);
  const pool = idsParam && idsParam.length ? idsParam : d ? d.ids : [];
  if (pool.length < 4) return [];
  const dpool = d ? d.ids : pool;
  // Ưu tiên các từ đã có nghĩa tiếng Việt để đáp án và nhiễu cùng một ngôn ngữ.
  const hasVi = (id) => L.viOf(id).length > 0;
  const poolV = pool.filter(hasVi), dpoolV = dpool.filter(hasVi);
  const useVi = poolV.length >= 4 && dpoolV.length >= 8;
  const T = useVi ? poolV : pool, D = useVi ? dpoolV : dpool;
  const mean = (id) => (useVi ? L.viOf(id).slice(0, 2).join(', ') : L.row(id).short);
  return shuffle(T).slice(0, n).map((id) => {
    const r = L.row(id);
    const correct = dir === 'rev' ? r.head : mean(id);
    const opts = [correct]; const seen = new Set(opts);
    let tries = 0;
    while (opts.length < 4 && tries++ < 80) {
      const oid = D[Math.floor(Math.random() * D.length)];
      const v = dir === 'rev' ? L.row(oid).head : mean(oid);
      if (oid !== id && v && !seen.has(v)) { seen.add(v); opts.push(v); }
    }
    const options = shuffle(opts);
    return { id, viq: useVi, prompt: dir === 'rev' ? mean(id) : r.head, sub: dir === 'rev' ? '' : r.reading, options, answer: options.indexOf(correct), view: L.view(id) };
  });
}
function api(req, res, u) {
  const p = u.pathname, q = u.searchParams;
  if (p === '/api/meta') {
    const out = {};
    for (const c of Object.keys(LANGS)) { const L = lang(c); out[c] = { name: L.name, speech: L.speech, total: L.rows.length, decks: L.decks.map((d) => ({ id: d.id, group: d.group, label: d.label, count: d.ids.length })) }; }
    return json(res, out);
  }
  const L = lang(q.get('lang') || 'en');
  if (!L) return json(res, { error: 'lang' }, 400);
  if (p === '/api/search') { const ids = L.search(q.get('q') || '', Math.min(Number(q.get('limit')) || 40, 100)); return json(res, ids.map((i) => L.row(i))); }
  if (p === '/api/entry') { const i = Number(q.get('id')); if (!(i >= 0 && i < L.rows.length)) return json(res, { error: 'id' }, 404); return json(res, L.view(i)); }
  if (p === '/api/entries') { const ids = parseIds(q.get('ids'), L.rows.length).slice(0, 300); return json(res, ids.map((i) => L.view(i))); }
  if (p === '/api/deck') { const d = L.decks.find((x) => x.id === q.get('deck')); return json(res, d ? d.ids : []); }
  if (p === '/api/rows') { const ids = parseIds(q.get('ids'), L.rows.length).slice(0, 500); return json(res, ids.map((i) => L.row(i))); }
  if (p === '/api/quiz') {
    const ids = parseIds(q.get('ids'), L.rows.length);
    return json(res, quiz(L, q.get('deck'), Math.min(Number(q.get('n')) || 10, 30), q.get('dir') === 'rev' ? 'rev' : 'fwd', ids));
  }
  return json(res, { error: 'not found' }, 404);
}

/* ------------------------------------------------------------ Dịch câu / đoạn văn (cần internet) */
// Thứ tự thử: LibreTranslate tự host (nếu đặt LIBRETRANSLATE_URL, chạy offline được) -> Google Translate (cổng web, không cần khóa) -> MyMemory.
// Dịch câu là tính năng duy nhất cần mạng; tra từ, thẻ nhớ, luyện tập vẫn chạy offline.
const TR_LANGS = { vi: 'vi', en: 'en', ja: 'ja', zh: 'zh-CN', ko: 'ko' };
const TR_MAX = 5000;
const GOOGLE_URL = process.env.GOOGLE_TRANSLATE_URL || 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_URL = process.env.MYMEMORY_URL || 'https://api.mymemory.translated.net/get';
const LIBRE_URL = process.env.LIBRETRANSLATE_URL || '';
const trCache = new Map();
const timeout = (ms) => AbortSignal.timeout(ms);

// Tách văn bản thành các đoạn nhỏ (theo dòng, rồi theo câu) để mỗi lần gọi không quá dài.
function trChunks(text, maxEnc = 1400) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) { out.push(null); continue; }
    const parts = line.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [line];
    let cur = '';
    for (const p of parts) {
      if (cur && encodeURIComponent(cur + p).length > maxEnc) { out.push(cur); cur = ''; }
      if (encodeURIComponent(p).length > maxEnc) { // câu quá dài: cắt cứng
        for (let i = 0; i < p.length; i += 150) out.push(p.slice(i, i + 150));
      } else cur += p;
    }
    if (cur) out.push(cur);
    out.push('\n');
  }
  return out;
}
async function googleOne(text, from, to) {
  const u = new URL(GOOGLE_URL);
  u.search = new URLSearchParams({ client: 'gtx', sl: from === 'auto' ? 'auto' : TR_LANGS[from], tl: TR_LANGS[to], dt: 't', q: text }).toString();
  const r = await fetch(u, { signal: timeout(9000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('google ' + r.status);
  const d = await r.json();
  if (!Array.isArray(d) || !Array.isArray(d[0])) throw new Error('google format');
  return { text: d[0].map((x) => (x && x[0]) || '').join(''), detected: typeof d[2] === 'string' ? d[2] : '' };
}
async function myMemoryOne(text, from, to) {
  if (from === 'auto') throw new Error('mymemory cần chọn ngôn ngữ nguồn');
  const u = new URL(MYMEMORY_URL);
  u.search = new URLSearchParams({ q: text.slice(0, 480), langpair: `${TR_LANGS[from]}|${TR_LANGS[to]}` }).toString();
  const r = await fetch(u, { signal: timeout(9000) });
  if (!r.ok) throw new Error('mymemory ' + r.status);
  const d = await r.json();
  const t = d && d.responseData && d.responseData.translatedText;
  if (!t || d.responseStatus === 429 || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error('mymemory limit');
  return { text: t, detected: '' };
}
async function libreOne(text, from, to) {
  const r = await fetch(LIBRE_URL.replace(/\/$/, '') + '/translate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: timeout(20000),
    body: JSON.stringify({ q: text, source: from === 'auto' ? 'auto' : TR_LANGS[from].split('-')[0], target: TR_LANGS[to].split('-')[0], format: 'text' }),
  });
  if (!r.ok) throw new Error('libre ' + r.status);
  const d = await r.json();
  if (typeof d.translatedText !== 'string') throw new Error('libre format');
  return { text: d.translatedText, detected: (d.detectedLanguage && d.detectedLanguage.language) || '' };
}
async function translateText(text, from, to) {
  const ck = `${from}>${to}>${text}`;
  if (trCache.has(ck)) return trCache.get(ck);
  const chunks = trChunks(text);
  const providers = [...(LIBRE_URL ? [['libretranslate', libreOne]] : []), ['google', googleOne], ['mymemory', myMemoryOne]];
  let lastErr = null;
  for (const [name, fn] of providers) {
    try {
      let out = '', detected = '';
      for (const c of chunks) {
        if (c === null) { out += '\n'; continue; }
        if (c === '\n') { out += '\n'; continue; }
        const r = await fn(c, from, to);
        out += r.text; if (!detected && r.detected) detected = r.detected;
      }
      const res = { text: out.replace(/\n{3,}/g, '\n\n').trim(), detected: detected.split('-')[0], provider: name };
      if (trCache.size > 300) trCache.delete(trCache.keys().next().value);
      trCache.set(ck, res); return res;
    } catch (e) { lastErr = e; console.warn(`  dịch bằng ${name} lỗi: ${e.message}`); }
  }
  throw lastErr || new Error('no provider');
}
async function apiTranslate(req, res) {
  let body = '';
  for await (const ch of req) { body += ch; if (body.length > 40000) break; }
  let p; try { p = JSON.parse(body); } catch (e) { return json(res, { error: 'json' }, 400); }
  const text = String(p.text || '').trim(), from = p.from === 'auto' ? 'auto' : p.from, to = p.to;
  if (!text) return json(res, { error: 'empty' }, 400);
  if (text.length > TR_MAX) return json(res, { error: 'too_long', max: TR_MAX }, 413);
  if ((from !== 'auto' && !TR_LANGS[from]) || !TR_LANGS[to]) return json(res, { error: 'lang' }, 400);
  if (from === to) return json(res, { text, detected: from, provider: 'none' });
  try { return json(res, await translateText(text, from, to)); }
  catch (e) { return json(res, { error: 'offline' }, 503); }
}

/* ------------------------------------------------------------ Tệp tĩnh */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (await auth(req, res, u)) return;
    if (u.pathname === '/api/translate' && req.method === 'POST') return apiTranslate(req, res);
    if (u.pathname.startsWith('/api/')) return api(req, res, u);
    let f = path.normalize(path.join(PUB, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); res.writeHead(500); res.end('Lỗi server'); }
}).listen(PORT, () => {
  console.log(`\nTừ điển Học Đều chạy tại http://localhost:${PORT}\nĐang nạp dữ liệu (lần đầu mất vài giây)...`);
  for (const c of Object.keys(LANGS)) lang(c);
  console.log('Sẵn sàng.');
});
