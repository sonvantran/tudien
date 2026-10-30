// Học Đều — giao diện từ điển và tự học. Không dùng thư viện ngoài.
const STATIC = !!window.STATIC_MODE; // bản tĩnh (GitHub Pages): tra từ chạy trong trình duyệt, không có server
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HTML_LANG = { en: 'en', ja: 'ja', zh: 'zh-Hans', ko: 'ko', vi: 'vi' };
const SPEECH = { en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', ko: 'ko-KR', vi: 'vi-VN' };
const LABEL = { en: 'Tiếng Anh', ja: 'Tiếng Nhật', zh: 'Tiếng Trung', ko: 'Tiếng Hàn', vi: 'Tiếng Việt' };
const SUGGEST = {
  en: ['negotiate', 'invoice', 'mitigate', 'warranty', 'negotiated'],
  ja: ['会議', 'taberu', 'meeting', '勉強', 'ありがとう'],
  zh: ['学习', 'xuexi', 'teacher', '你好', '谢谢'],
  ko: ['사랑', '학교', '먹다', 'sarang', 'love'],
  vi: ['hội nghị', 'hoc tap', 'cảm ơn', 'meeting', 'ăn cơm'],
};

/* ---------------- trạng thái ---------------- */
const KEY = 'tudien.v1';
const DEF = { lang: 'en', deck: {}, xp: 0, streak: 0, last: '', goal: 10, cards: {}, hist: {}, saved: {}, notes: {} };
function load() { try { const o = JSON.parse(localStorage.getItem(KEY)); if (o) return { ...DEF, ...o }; } catch (e) {} return structuredClone(DEF); }
let S = load();
let ACC = null, syncTimer = null; // ACC: tên tài khoản đang đăng nhập
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} scheduleSync(); };
const dstr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => dstr(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); return dstr(new Date(y, m - 1, d + n)); };
const key = (id, lang = S.lang) => `${lang}:${id}`;
const dayRec = () => (S.hist[today()] ||= { n: 0, q: 0, c: 0, nw: 0, xp: 0 });
function award(xp, n = 0, q = 0, c = 0, nw = 0) {
  const t = today();
  if (S.last !== t) { S.streak = S.last === addDays(t, -1) ? S.streak + 1 : 1; S.last = t; }
  const h = dayRec(); h.n += n; h.q += q; h.c += c; h.nw += nw; h.xp += xp; S.xp += xp; save();
}
const streakNow = () => (S.last === today() || S.last === addDays(today(), -1) ? S.streak : 0);

/* ---------------- API ---------------- */
let META = null;
async function api(path, params = {}) {
  if (STATIC) return Engine.api(path, params);
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u); if (!r.ok) throw new Error('API ' + r.status); return r.json();
}
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }
function speak(text, code) {
  try {
    if (!('speechSynthesis' in window)) return toast('Trình duyệt chưa hỗ trợ phát âm');
    const u = new SpeechSynthesisUtterance(text); u.lang = code || META[S.lang].speech; u.rate = 0.9;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) { toast('Không phát được âm thanh'); }
}
const icon = {
  speaker: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11"/></svg>',
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3z"/></svg>',
};
/* ---------------- Tài khoản và đồng bộ tiến độ ---------------- */
async function authApi(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || 'Lỗi'), { status: r.status });
  return d;
}
// Gộp tiến độ máy này (a) với tiến độ trên server (b), không làm mất dữ liệu bên nào.
function mergeState(a, b) {
  const m = { ...DEF, ...b, ...a };
  m.xp = Math.max(a.xp || 0, b.xp || 0);
  m.saved = { ...b.saved, ...a.saved };
  m.notes = { ...b.notes, ...a.notes };
  m.cards = { ...b.cards };
  for (const k in a.cards) {
    const x = a.cards[k], y = b.cards && b.cards[k];
    m.cards[k] = !y || (x.t || 0) > (y.t || 0) || ((x.t || 0) === (y.t || 0) && x.b >= y.b) ? x : y;
  }
  m.hist = { ...b.hist };
  for (const d in a.hist) {
    const x = a.hist[d], y = b.hist && b.hist[d];
    m.hist[d] = y ? Object.fromEntries(['n', 'q', 'c', 'nw', 'xp'].map((f) => [f, Math.max(x[f] || 0, y[f] || 0)])) : x;
  }
  const useB = (b.last || '') > (a.last || '');
  m.last = useB ? b.last : a.last; m.streak = useB ? b.streak : a.streak;
  return m;
}
async function pushProgress() {
  if (!ACC) return false;
  S.owner = ACC;
  try { await authApi('/api/progress', 'PUT', { data: S }); return true; } catch (e) { if (e.status === 401) ACC = null; return false; }
}
function scheduleSync() { if (!ACC) return; clearTimeout(syncTimer); syncTimer = setTimeout(pushProgress, 1500); }
async function pullProgress() {
  const d = await authApi('/api/progress');
  if (S.owner && S.owner !== ACC) S = { ...structuredClone(DEF), ...(d.data || {}) }; // dữ liệu máy thuộc người khác: bỏ, lấy của tài khoản này
  else if (d.data) S = mergeState(S, d.data); // dữ liệu ẩn danh hoặc của chính tài khoản này: gộp
  S.owner = ACC;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  await pushProgress();
}
function accountHTML() {
  if (STATIC) return '';
  if (ACC) return `<section class="card stack"><h2>Tài khoản</h2><p class="muted">Đã đăng nhập: <b>${esc(ACC)}</b>. Tiến độ tự đồng bộ lên server sau mỗi thay đổi.</p><div class="row"><button class="btn ghost sm" type="button" data-act="auth-sync">Đồng bộ ngay</button><button class="btn ghost sm" type="button" data-act="auth-logout">Đăng xuất</button></div></section>`;
  return `<section class="card stack"><h2>Tài khoản</h2><p class="muted">Đăng nhập để lưu tiến độ trên server và học tiếp trên máy khác. Tiến độ hiện có trên máy này sẽ được gộp vào tài khoản.</p><div class="formgrid"><div class="field"><label class="label" for="authuser">Tên đăng nhập</label><input id="authuser" type="text" autocomplete="username" autocapitalize="off" spellcheck="false"></div><div class="field"><label class="label" for="authpass">Mật khẩu (từ 8 ký tự)</label><input id="authpass" type="password" autocomplete="current-password"></div></div><div class="row"><button class="btn sm" type="button" data-act="auth-login">Đăng nhập</button><button class="btn ghost sm" type="button" data-act="auth-register">Tạo tài khoản</button></div></section>`;
}
/* ---------------- giao diện chung ---------------- */
const TABS = [['search', 'Tra từ'], ['translate', 'Dịch câu'], ['cards', 'Thẻ nhớ'], ['quiz', 'Luyện tập'], ['book', 'Sổ từ & tiến độ']];
let view = 'search';
const ui = { q: '', results: null, sel: null, selView: null, fc: null, quiz: null, tr: { from: 'auto', to: 'vi', text: '', res: null, busy: false, err: '' }, qdeck: null, qdir: 'fwd', confirm: false, loading: false };

function chrome() {
  if (STATIC && META) Engine.preload(S.lang).catch(() => {});
  document.body.dataset.lang = S.lang;
  $('#langs').innerHTML = Object.keys(LABEL).map((l) => `<button type="button" data-act="lang" data-v="${l}" aria-pressed="${S.lang === l}">${LABEL[l]}</button>`).join('');
  $('#tabs').innerHTML = TABS.map(([id, n]) => `<button type="button" data-act="tab" data-v="${id}"${view === id ? ' aria-current="page"' : ''}>${n}</button>`).join('');
}
function setView(v) { view = v; chrome(); render(); }
function render() {
  const app = $('#app');
  ({ search: vSearch, translate: vTranslate, cards: vCards, quiz: vQuiz, book: vBook }[view])(app);
}

/* ---------------- dùng chung: bộ từ ---------------- */
function deckOptions(sel, withSaved = true) {
  const decks = META[S.lang].decks;
  const groups = [...new Set(decks.map((d) => d.group))];
  let h = '';
  if (withSaved) h += `<option value="saved"${sel === 'saved' ? ' selected' : ''}>Sổ từ của tôi (${savedIds().length})</option>`;
  for (const g of groups) h += `<optgroup label="${esc(g)}">` + decks.filter((d) => d.group === g).map((d) => `<option value="${d.id}"${sel === d.id ? ' selected' : ''}>${esc(d.label)} (${d.count.toLocaleString('vi')})</option>`).join('') + '</optgroup>';
  return h;
}
const curDeck = () => S.deck[S.lang] || META[S.lang].decks[0]?.id;
const savedIds = () => Object.keys(S.saved).filter((k) => k.startsWith(S.lang + ':')).map((k) => Number(k.split(':')[1]));
async function deckIds(deck) { return deck === 'saved' ? savedIds() : api('/api/deck', { lang: S.lang, deck }); }
async function entries(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await api('/api/entries', { lang: S.lang, ids: ids.slice(i, i + 200).join(',') })));
  return out;
}

/* ---------------- chi tiết một từ ---------------- */
function sensesHTML(v) {
  const en = v.senses.filter((s) => !s.zh), zh = v.senses.filter((s) => s.zh);
  const one = (arr) => arr.map((s, i) => `<div class="sense"><span class="n">${i + 1}</span><div>${s.pos ? `<span class="pos">${esc(s.pos)}</span> ` : ''}<span${s.zh ? ' lang="zh-Hans"' : ''}>${esc(s.text)}</span>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}</div></div>`).join('');
  if (S.lang === 'en') return (en.length ? `<div class="sec">Định nghĩa tiếng Anh</div>${one(en)}` : '') + (zh.length ? `<div class="sec">Nghĩa tiếng Trung</div>${one(zh)}` : '');
  return `<div class="sec">${S.lang === 'vi' ? 'Nghĩa tiếng Anh' : 'Nghĩa'}</div>${one(v.senses)}`;
}
function viHTML(v) {
  if (!v.vi || !v.vi.length) return '';
  return `<div class="sec">Nghĩa tiếng Việt (gợi ý từ VNEDICT)</div><div class="vilist" lang="vi">${v.vi.map((x) => `<span class="vchip">${esc(x)}</span>`).join('')}</div><p class="hint" style="margin-top:6px">Tra ngược từ nghĩa tiếng Anh nên có thể chưa sát nghĩa. Ghi chú của bạn ở cuối trang sẽ được ưu tiên hiển thị.</p>`;
}
function linksHTML(v) {
  if (!v.links || !v.links.length) return '';
  return `<div class="sec">Tra nghĩa tiếng Anh trong từ điển khác</div>${v.links.map((l) => `<div class="row" style="margin-bottom:6px"><span>${esc(l)}</span>${['en', 'ja', 'zh', 'ko'].map((c) => `<button type="button" class="chip" data-act="try-in" data-lang="${c}" data-v="${esc(l)}">${LABEL[c].replace('Tiếng ', '')}</button>`).join('')}</div>`).join('')}`;
}
function detailHTML(v) {
  const k = key(v.id), saved = !!S.saved[k];
  const forms = (v.forms || []).length ? `<div class="sec">Dạng từ</div><div class="forms">${v.forms.map((f) => `<span><em>${esc(f.label)}</em>${esc(f.text)}</span>`).join('')}</div>` : '';
  const lemma = v.lemma ? `<p style="margin-top:10px" class="muted">Dạng chia của <button class="link" type="button" data-act="open" data-id="${v.lemma.id}">${esc(v.lemma.head)}</button></p>` : '';
  const alt = (v.alt || []).length ? `<div class="hint" style="margin-top:6px" lang="${HTML_LANG[S.lang]}">Cách viết khác: ${esc(v.alt.join('、'))}</div>` : '';
  return `<div class="card detail">
    <div class="head"><div><div class="word" lang="${HTML_LANG[S.lang]}">${esc(v.head)}</div>${v.reading ? `<div class="read" lang="${S.lang === 'zh' ? 'zh-Hans' : S.lang === 'ja' ? 'ja' : 'en'}">${esc(v.reading)}</div>` : ''}</div>
    <div class="row" style="gap:8px;flex:none"><button class="iconbtn" type="button" data-act="speak" data-t="${esc(v.head)}" aria-label="Nghe phát âm">${icon.speaker}</button><button class="iconbtn${saved ? ' on' : ''}" type="button" data-act="save" data-id="${v.id}" aria-label="${saved ? 'Bỏ khỏi sổ từ' : 'Lưu vào sổ từ'}" aria-pressed="${saved}">${icon.star}</button></div></div>
    ${v.badges.length ? `<div class="badges">${v.badges.map((b) => `<span class="pill a">${esc(b)}</span>`).join('')}</div>` : ''}
    ${alt}${lemma}${viHTML(v)}${sensesHTML(v)}${linksHTML(v)}${forms}
    <div class="sec">Nghĩa tiếng Việt của bạn</div>
    <textarea id="note" data-id="${v.id}" rows="2" placeholder="Ghi nghĩa tiếng Việt, ví dụ hoặc mẹo nhớ. Ghi chú hiện cả trong danh sách, thẻ nhớ và bài luyện tập.">${esc(S.notes[k] || '')}</textarea>
  </div>`;
}

/* ---------------- Tra từ ---------------- */
function rowHTML(r, sel) {
  const k = key(r.id), note = S.notes[k];
  return `<button type="button" class="res" data-act="open" data-id="${r.id}"${sel ? ' aria-current="true"' : ''}>
    <div class="m"><div><span class="h" lang="${HTML_LANG[S.lang]}">${esc(r.head)}</span>${r.reading ? `<span class="r">${esc(r.reading)}</span>` : ''}</div>
    ${note ? `<div class="s note">${esc(note)}</div>` : ''}${r.vi ? `<div class="s vi" lang="vi">${esc(r.vi)}</div>` : ''}<div class="${r.vi ? 's2' : 's'}"${S.lang === 'en' ? ' lang="zh-Hans"' : S.lang === 'vi' ? ' lang="en"' : ''}>${esc(r.short)}</div>${r.short2 ? `<div class="s2">${esc(r.short2)}</div>` : ''}
    ${r.badges.length ? `<div class="badges">${r.badges.map((b) => `<span class="pill">${esc(b)}</span>`).join('')}</div>` : ''}</div>
    ${S.saved[k] ? '<span style="color:var(--accent)" aria-label="Đã lưu">' + icon.star.replace('fill="none"', 'fill="currentColor"') + '</span>' : ''}</button>`;
}
function vSearch(app) {
  const total = META[S.lang].total.toLocaleString('vi');
  const hint = { en: 'Gõ từ tiếng Anh (kể cả dạng chia như "negotiated") hoặc chữ Hán để tìm theo nghĩa tiếng Trung.', ja: 'Gõ kanji, kana, romaji hoặc nghĩa tiếng Anh. Ví dụ: 会議, かいぎ, kaigi, meeting.', zh: 'Gõ chữ Hán (giản hoặc phồn thể), pinyin có hoặc không dấu, hoặc nghĩa tiếng Anh.', ko: 'Gõ chữ Hàn (Hangul), phiên âm Latinh (sarang), Hán tự hoặc nghĩa tiếng Anh. Gõ dạng chia như 먹었어요 sẽ ra 먹다. Phiên âm hiển thị là Romaja gần đúng.', vi: 'Gõ từ tiếng Việt (có hoặc không dấu) hoặc từ tiếng Anh để tìm từ tiếng Việt tương ứng. Nghĩa trong từ điển này là tiếng Anh.' }[S.lang];
  app.innerHTML = `<div class="stack"><div><div class="label">${LABEL[S.lang]} · ${total} mục</div><h1>Tra từ</h1></div>
    <input id="q" class="big-search" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nhập từ cần tra" value="${esc(ui.q)}" aria-label="Tra từ">
    <p class="hint">${hint}</p>
    <div id="sp" class="split${ui.sel !== null ? ' has-detail' : ''}"><div class="list-col" id="lc"></div><div class="detail-col" id="dc"></div></div></div>`;
  paintResults(); paintDetail();
  const q = $('#q'); if (!('ontouchstart' in window)) q.focus();
}
function paintResults() {
  const lc = $('#lc'); if (!lc) return;
  if (ui.loading) { lc.innerHTML = '<div class="loading">Đang tìm...</div>'; return; }
  if (ui.results === null) {
    lc.innerHTML = `<div class="card stack"><div class="label">Thử tra</div><div class="row">${SUGGEST[S.lang].map((w) => `<button type="button" class="chip" data-act="try" data-v="${esc(w)}" lang="${HTML_LANG[S.lang]}">${esc(w)}</button>`).join('')}</div></div>`;
  } else if (!ui.results.length) lc.innerHTML = '<div class="card muted">Không tìm thấy kết quả.</div>';
  else lc.innerHTML = `<div class="card" style="padding:6px 8px"><div class="results">${ui.results.map((r) => rowHTML(r, r.id === ui.sel)).join('')}</div></div>`;
}
function paintDetail() {
  const dc = $('#dc'); if (!dc) return;
  $('#sp').classList.toggle('has-detail', ui.sel !== null);
  dc.innerHTML = ui.selView ? `<div class="row" style="margin-bottom:10px"><button class="btn ghost sm" type="button" data-act="back" id="backbtn">← Danh sách</button></div>${detailHTML(ui.selView)}` : '<div class="card muted">Chọn một từ để xem chi tiết.</div>';
  const b = $('#backbtn'); if (b && matchMedia('(min-width:761px)').matches) b.parentElement.style.display = 'none';
}
let searchTimer = null, searchSeq = 0;
function doSearch(q) {
  ui.q = q; clearTimeout(searchTimer);
  if (!q.trim()) { ui.results = null; ui.sel = null; ui.selView = null; ui.loading = false; paintResults(); paintDetail(); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq; ui.loading = ui.results === null; if (ui.loading) paintResults();
    try {
      const r = await api('/api/search', { lang: S.lang, q, limit: 40 });
      if (seq !== searchSeq) return;
      ui.results = r; ui.loading = false;
      if (r.length && (ui.sel === null || !r.some((x) => x.id === ui.sel))) { ui.sel = r[0].id; ui.selView = await api('/api/entry', { lang: S.lang, id: r[0].id }); if (matchMedia('(max-width:760px)').matches) ui.sel = ui.sel; }
      if (!r.length) { ui.sel = null; ui.selView = null; }
      paintResults(); paintDetail();
      if (matchMedia('(max-width:760px)').matches && r.length) { ui.sel = null; $('#sp').classList.remove('has-detail'); }
    } catch (e) { toast('Không kết nối được server'); }
  }, 160);
}
async function openEntry(id) {
  ui.sel = id; ui.selView = await api('/api/entry', { lang: S.lang, id });
  if (view !== 'search') { view = 'search'; chrome(); render(); } else { paintResults(); paintDetail(); }
  if (matchMedia('(max-width:760px)').matches) window.scrollTo(0, 0);
}

/* ---------------- Dịch câu / đoạn văn (cần internet) ---------------- */
const TR_LABEL = { auto: 'Tự nhận diện', ko: 'Tiếng Hàn', en: 'Tiếng Anh', ja: 'Tiếng Nhật', zh: 'Tiếng Trung', vi: 'Tiếng Việt' };
const trOpts = (sel, withAuto) => Object.keys(TR_LABEL).filter((c) => withAuto || c !== 'auto').map((c) => `<option value="${c}"${sel === c ? ' selected' : ''}>${TR_LABEL[c]}</option>`).join('');
function vTranslate(app) {
  const t = ui.tr;
  app.innerHTML = `<div class="stack"><div><div class="label">Cần kết nối internet</div><h1>Dịch câu và đoạn văn</h1></div>
    <section class="card stack">
      <div class="formgrid"><div class="field"><label class="label" for="trfrom">Dịch từ</label><select id="trfrom">${trOpts(t.from, true)}</select></div>
      <div class="field"><label class="label" for="trto">Sang</label><select id="trto">${trOpts(t.to, false)}</select></div></div>
      <textarea id="trtext" rows="6" maxlength="5000" placeholder="Nhập hoặc dán câu, đoạn văn cần dịch (tối đa 5000 ký tự). Ctrl + Enter để dịch." aria-label="Văn bản cần dịch">${esc(t.text)}</textarea>
      <div class="row"><button class="btn" type="button" data-act="tr-go">Dịch</button><button class="btn ghost sm" type="button" data-act="tr-swap">Đổi chiều</button><button class="btn ghost sm" type="button" data-act="tr-clear">Xóa</button><span class="hint" id="trcount">${t.text.length}/5000</span></div>
      <p class="hint">Chỉ mục này cần mạng. Tra từ, thẻ nhớ và luyện tập vẫn chạy offline. Bản dịch máy chỉ để tham khảo, nên kiểm tra lại với câu quan trọng.</p>
    </section><div id="trout"></div></div>`;
  paintTr();
}
function paintTr() {
  const out = $('#trout'); if (!out) return; const t = ui.tr;
  if (t.busy) { out.innerHTML = '<div class="loading">Đang dịch...</div>'; return; }
  if (t.err) { out.innerHTML = `<div class="card muted" role="alert">${esc(t.err)}</div>`; return; }
  if (!t.res) { out.innerHTML = ''; return; }
  const r = t.res, src = t.from === 'auto' ? r.detected : t.from;
  const short = t.text.trim().length <= 30 && !/\s/.test(t.text.trim());
  const chips = short && LABEL[src] ? `<div class="row"><span class="hint">Tra từ này trong từ điển:</span><button type="button" class="chip" data-act="try-in" data-lang="${esc(src)}" data-v="${esc(t.text.trim())}">${LABEL[src].replace('Tiếng ', '')}</button></div>` : '';
  out.innerHTML = `<section class="card stack"><div class="row spread"><div class="label">Bản dịch · ${TR_LABEL[t.to]}${t.from === 'auto' && LABEL[r.detected] ? ` <span class="hint">(nguồn nhận diện: ${LABEL[r.detected].replace('Tiếng ', '')})</span>` : ''}</div>
    <div class="row" style="gap:8px;flex:none"><button class="iconbtn" type="button" data-act="tr-speak" aria-label="Nghe bản dịch">${icon.speaker}</button><button class="btn ghost sm" type="button" data-act="tr-copy">Sao chép</button></div></div>
    <div lang="${HTML_LANG[t.to]}" style="white-space:pre-wrap;font-size:18px;line-height:1.6">${esc(r.text)}</div>${chips}</section>`;
}
async function doTranslate() {
  const t = ui.tr; t.text = ($('#trtext')?.value ?? t.text);
  if (!t.text.trim()) return toast('Hãy nhập nội dung cần dịch');
  t.busy = true; t.err = ''; t.res = null; paintTr();
  try {
    let status = 200, d = {};
    if (STATIC) { try { d = await Engine.translate(t.text, t.from, t.to); } catch (e) { status = e.status || 503; } }
    else {
      const r = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t.text, from: t.from, to: t.to }) });
      status = r.status; d = await r.json().catch(() => ({}));
    }
    if (status === 200) t.res = d;
    else t.err = status === 413 ? 'Văn bản quá dài, tối đa 5000 ký tự.' : status === 503 ? 'Không dịch được. Mục này cần kết nối internet, hãy kiểm tra mạng rồi thử lại (có thể dịch vụ dịch đang giới hạn lượt dùng hoặc chặn truy cập từ trình duyệt).' : 'Có lỗi khi dịch, thử lại nhé.';
  } catch (e) { t.err = 'Không kết nối được server.'; }
  t.busy = false; if (view === 'translate') paintTr();
}

/* ---------------- Thẻ nhớ ---------------- */
const INT = [0, 1, 2, 4, 8, 16, 30];
async function cardStats(deck) {
  const ids = await deckIds(deck); const t = today();
  const due = ids.filter((id) => { const c = S.cards[key(id)]; return c && c.d <= t; });
  const fresh = ids.filter((id) => !S.cards[key(id)]);
  const left = Math.max(0, S.goal - (S.hist[t]?.nw || 0));
  return { ids, due, fresh, left, take: Math.min(left, fresh.length) };
}
const noDecks = (app) => { app.innerHTML = `<div class="stack"><h1>Chưa có bộ từ</h1><section class="card stack"><p class="muted">Từ điển tiếng Việt chỉ dùng để tra từ. Chọn Tiếng Anh, Tiếng Nhật hoặc Tiếng Trung để học thẻ nhớ và luyện tập.</p></section></div>`; };
async function vCards(app) {
  if (!META[S.lang].decks.length) return noDecks(app);
  const f = ui.fc;
  if (f && f.i < f.q.length) return paintCard(app);
  if (f) {
    app.innerHTML = `<div class="stack"><h1>Xong buổi học</h1><section class="card stack"><div class="row" style="gap:28px"><div><div class="label">Đã xem</div><div class="big num">${f.seen}</div></div><div><div class="label">Nhớ</div><div class="big num">${f.ok}</div></div></div><p class="muted">Thẻ chấm "Nhớ" sẽ quay lại sau vài ngày. Thẻ "Quên" được xếp lại ngay trong buổi này.</p><div class="row"><button class="btn" type="button" data-act="fc-menu">Tiếp tục</button></div></section></div>`;
    return;
  }
  const deck = curDeck(), sel = deck;
  app.innerHTML = `<div class="loading">Đang tải...</div>`;
  const st = await cardStats(deck);
  const n = st.due.length + st.take;
  app.innerHTML = `<div class="stack"><div><div class="label">${LABEL[S.lang]}</div><h1>Thẻ nhớ</h1></div>
    <section class="card stack"><div class="field"><label class="label" for="deck">Bộ từ</label><select id="deck" data-act-change="deck">${deckOptions(sel)}</select></div>
    <div class="row" style="gap:28px"><div><div class="label">Đến hạn</div><div class="big num">${st.due.length}</div></div><div><div class="label">Từ mới hôm nay</div><div class="big num">${st.take}</div></div></div>
    <p class="muted">Mỗi ngày học tối đa ${S.goal} từ mới (đổi trong mục Sổ từ & tiến độ). Thẻ đến hạn được ôn trước, tự chấm mức nhớ để hẹn lịch ôn lại sau 1, 2, 4, 8, 16, 30 ngày.</p>
    <div><button class="btn" type="button" data-act="fc-start"${n ? '' : ' disabled'}>${n ? `Bắt đầu (${n} thẻ)` : 'Hôm nay không còn thẻ'}</button></div></section></div>`;
}
async function startCards() {
  const st = await cardStats(curDeck());
  const ids = [...st.due.sort((a, b) => S.cards[key(a)].b - S.cards[key(b)].b), ...st.fresh.slice(0, st.take)];
  if (!ids.length) return;
  const list = await entries(ids);
  ui.fc = { q: list, i: 0, flip: false, seen: 0, ok: 0 };
  render();
}
function paintCard(app) {
  const f = ui.fc, v = f.q[f.i], L = HTML_LANG[S.lang], note = S.notes[key(v.id)];
  const front = `<div class="fword" lang="${L}">${esc(v.head)}</div><div class="hint">Chạm để lật thẻ</div>`;
  const viLine = v.vi && v.vi.length ? `<div class="fmean" lang="vi" style="color:var(--accent);font-weight:700">${esc(v.vi.slice(0, 3).join('; '))}</div>` : '';
  const senses = v.senses.filter((s) => (S.lang === 'en' ? true : true)).slice(0, 6);
  const back = `<div class="fword" style="font-size:clamp(28px,6vw,42px)" lang="${L}">${esc(v.head)}</div>${v.reading ? `<div class="fread">${esc(v.reading)}</div>` : ''}${note ? `<div class="fmean" style="color:var(--accent);font-weight:700">${esc(note)}</div>` : ''}${viLine}<div class="fmean" style="font-size:16px;color:var(--muted)">${senses.map((s) => `<div class="sense"><span class="n">•</span><div>${s.pos ? `<span class="pos">${esc(s.pos)}</span> ` : ''}<span${s.zh ? ' lang="zh-Hans"' : ''}>${esc(s.text)}</span></div></div>`).join('')}</div>`;
  const rates = f.flip
    ? `<div class="rates"><button type="button" class="r0" data-act="fc-rate" data-r="0">Quên<small>phím 1 · học lại ngay</small></button><button type="button" class="r1" data-act="fc-rate" data-r="1">Khó<small>phím 2 · mai ôn lại</small></button><button type="button" class="r2" data-act="fc-rate" data-r="2">Nhớ<small>phím 3 · giãn lịch ôn</small></button></div>`
    : `<div class="rates" style="grid-template-columns:1fr"><button type="button" data-act="fc-flip">Hiện đáp án <small>phím cách</small></button></div>`;
  app.innerHTML = `<div class="stack"><div class="row spread"><span class="label">Còn ${f.q.length - f.i} thẻ</span><button class="btn ghost sm" type="button" data-act="fc-quit">Kết thúc</button></div>
    <div class="row"><div class="prog"><i style="width:${Math.round((f.i / f.q.length) * 100)}%"></i></div></div>
    <div class="fcard" data-act="fc-flip" role="button" tabindex="0" aria-label="Lật thẻ">${f.flip ? back : front}<button type="button" class="iconbtn" data-act="speak" data-t="${esc(v.head)}" aria-label="Nghe phát âm">${icon.speaker}</button></div>${rates}</div>`;
}
function rateCard(r) {
  const f = ui.fc; if (!f || !f.flip) return;
  const v = f.q[f.i], k = key(v.id), t = today();
  const isNew = !S.cards[k];
  const c = S.cards[k] || { b: 0, d: t };
  if (r === 0) { c.b = 0; c.d = t; } else if (r === 1) c.d = addDays(t, 1); else { c.b = Math.min(c.b + 1, 6); c.d = addDays(t, INT[c.b]); }
  c.t = Date.now(); S.cards[k] = c; award([1, 2, 5][r], 1, 0, 0, isNew ? 1 : 0);
  f.seen++; if (r === 2) f.ok++; if (r === 0) f.q.push(v);
  f.i++; f.flip = false; render();
}

/* ---------------- Luyện tập ---------------- */
async function vQuiz(app) {
  if (!META[S.lang].decks.length) return noDecks(app);
  const Q = ui.quiz;
  if (Q && Q.done) return paintQuizResult(app);
  if (Q) return paintQuiz(app);
  const deck = curDeck();
  app.innerHTML = `<div class="stack"><div><div class="label">${LABEL[S.lang]}</div><h1>Luyện tập</h1></div><section class="card stack">
    <div class="formgrid"><div class="field"><label class="label" for="deck">Bộ từ</label><select id="deck" data-act-change="deck">${deckOptions(deck)}</select></div>
    <div class="field"><label class="label" for="dir">Dạng câu hỏi</label><select id="dir"><option value="fwd"${ui.qdir === 'fwd' ? ' selected' : ''}>Cho từ, chọn nghĩa</option><option value="rev"${ui.qdir === 'rev' ? ' selected' : ''}>Cho nghĩa, chọn từ</option></select></div></div>
    <p class="muted">10 câu lấy ngẫu nhiên trong bộ từ, ưu tiên các từ đã có nghĩa tiếng Việt. Câu sai sẽ được đưa lại vào thẻ nhớ để ôn ngay.</p>
    <div><button class="btn" type="button" data-act="quiz-start">Bắt đầu</button></div></section></div>`;
}
async function startQuiz() {
  const deck = curDeck(); ui.qdir = $('#dir')?.value || ui.qdir;
  const ids = deck === 'saved' ? savedIds() : [];
  if (deck === 'saved' && ids.length < 4) return toast('Sổ từ cần ít nhất 4 từ để luyện tập');
  const qs = await api('/api/quiz', { lang: S.lang, deck: deck === 'saved' ? '' : deck, ids: ids.join(','), n: 10, dir: ui.qdir });
  if (!qs.length) return toast('Bộ từ này chưa đủ từ để tạo bài');
  ui.quiz = { qs, i: 0, picked: null, ans: [], done: false, xp: 0, dir: ui.qdir };
  render();
}
function paintQuiz(app) {
  const Q = ui.quiz, q = Q.qs[Q.i], L = HTML_LANG[S.lang], n = Q.qs.length;
  const optLang = Q.dir === 'rev' ? L : (q.viq ? 'vi' : (S.lang === 'en' ? 'zh-Hans' : 'en'));
  const opts = q.options.map((o, i) => {
    let cls = 'opt', dis = '';
    if (Q.picked !== null) { dis = ' disabled'; if (i === q.answer) cls += ' good'; else if (i === Q.picked) cls += ' bad'; }
    return `<button type="button" class="${cls}"${dis} data-act="pick" data-i="${i}"><span class="k">${'ABCD'[i]}</span><span class="t" lang="${optLang}">${esc(o)}</span></button>`;
  }).join('');
  let fb = '', foot = '';
  if (Q.picked !== null) {
    const ok = Q.picked === q.answer, v = q.view;
    fb = `<div class="fb" role="status"><b class="${ok ? 'g' : 'b'}">${ok ? 'Chính xác. +10 XP' : 'Chưa đúng. +2 XP'}</b><div style="margin-top:6px"><b lang="${L}">${esc(v.head)}</b> ${v.reading ? `<span class="muted">${esc(v.reading)}</span>` : ''}</div>${v.vi && v.vi.length ? `<div lang="vi" style="color:var(--accent);font-weight:700">${esc(v.vi.join('; '))}</div>` : ''}${v.senses.slice(0, 3).map((s) => `<div${s.zh ? ' lang="zh-Hans"' : ''}>${esc(s.text)}</div>`).join('')}</div>`;
    foot = `<div class="row" style="margin-top:14px"><button class="btn" type="button" data-act="next">${Q.i === n - 1 ? 'Xem kết quả' : 'Câu tiếp'}</button></div>`;
  }
  const prompt = Q.dir === 'rev' ? `<div class="qp" style="font-size:clamp(20px,4.5vw,28px)" lang="${q.viq ? 'vi' : (S.lang === 'en' ? 'zh-Hans' : 'en')}">${esc(q.prompt)}</div>` : `<div class="qp" lang="${L}">${esc(q.prompt)}</div>${q.sub ? `<div class="muted">${esc(q.sub)}</div>` : ''}`;
  app.innerHTML = `<div class="stack"><div class="row"><button class="btn ghost sm" type="button" data-act="quiz-quit">Thoát</button><div class="prog"><i style="width:${Math.round((Q.i / n) * 100)}%"></i></div><span class="muted num">${Q.i + 1}/${n}</span></div>
    <section class="card"><div class="label">${Q.dir === 'rev' ? 'Chọn từ đúng' : 'Chọn nghĩa đúng'}</div>${prompt}${Q.dir !== 'rev' ? `<div class="row" style="margin-top:8px"><button type="button" class="iconbtn" data-act="speak" data-t="${esc(q.prompt)}" aria-label="Nghe phát âm">${icon.speaker}</button></div>` : ''}<div class="opts">${opts}</div>${fb}${foot}</section></div>`;
}
function pickAnswer(i) {
  const Q = ui.quiz; if (!Q || Q.picked !== null) return;
  const q = Q.qs[Q.i], ok = i === q.answer;
  Q.picked = i; Q.ans[Q.i] = i; Q.xp += ok ? 10 : 2; award(ok ? 10 : 2, 1, 1, ok ? 1 : 0);
  if (!ok) { const c = S.cards[key(q.id)] || { b: 0, d: today() }; c.b = 0; c.d = today(); c.t = Date.now(); S.cards[key(q.id)] = c; save(); }
  render();
}
function nextQuestion() {
  const Q = ui.quiz;
  if (Q.i >= Q.qs.length - 1) { award(15); Q.xp += 15; Q.done = true; } else { Q.i++; Q.picked = null; }
  render(); window.scrollTo(0, 0);
}
function paintQuizResult(app) {
  const Q = ui.quiz, ok = Q.qs.filter((q, i) => Q.ans[i] === q.answer).length, n = Q.qs.length, L = HTML_LANG[S.lang];
  const wrong = Q.qs.filter((q, i) => Q.ans[i] !== q.answer);
  app.innerHTML = `<div class="stack"><div><div class="label">Hoàn thành</div><h1>${ok / n >= 0.8 ? 'Làm tốt lắm' : ok / n >= 0.5 ? 'Khá ổn, tiếp tục nhé' : 'Cần ôn thêm'}</h1></div>
    <section class="card stack"><div class="row" style="gap:32px"><div><div class="label">Đúng</div><div class="big num">${ok}<span class="muted" style="font-size:.45em"> / ${n}</span></div></div><div><div class="label">Nhận được</div><div class="big num">+${Q.xp}<span class="muted" style="font-size:.4em"> XP</span></div></div></div>
    <div class="row"><button class="btn" type="button" data-act="quiz-again">Làm lại</button><button class="btn ghost" type="button" data-act="quiz-quit">Đổi bộ từ</button></div></section>
    ${wrong.length ? `<section class="card"><h2 style="margin-bottom:8px">Xem lại ${wrong.length} câu sai</h2>${wrong.map((q) => `<div class="sense" style="grid-template-columns:1fr"><div><b lang="${L}">${esc(q.view.head)}</b> <span class="muted">${esc(q.view.reading || '')}</span>${q.view.senses.slice(0, 2).map((s) => `<div${s.zh ? ' lang="zh-Hans"' : ''}>${esc(s.text)}</div>`).join('')}</div></div>`).join('')}</section>` : ''}</div>`;
}

/* ---------------- Sổ từ & tiến độ ---------------- */
async function vBook(app) {
  const t = today(), h = S.hist[t] || { n: 0 };
  const ids = savedIds();
  const learned = Object.keys(S.cards).filter((k) => k.startsWith(S.lang + ':')).length;
  const mastered = Object.entries(S.cards).filter(([k, c]) => k.startsWith(S.lang + ':') && c.b >= 3).length;
  const lvl = Math.floor(Math.sqrt(S.xp / 40)) + 1;
  let mx = S.goal; const vals = [];
  for (let k = 6; k >= 0; k--) { const d = addDays(t, -k), n = S.hist[d]?.n || 0; vals.push([d, n]); if (n > mx) mx = n; }
  const DN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const chart = vals.map(([d, n], i) => { const [y, m, dd] = d.split('-').map(Number); return `<div class="col${i === 6 ? ' now' : ''}" title="${d}: ${n}"><span class="num">${n}</span><div class="bw"><div class="bar" style="height:${Math.round((n / mx) * 90)}px"></div></div><span>${DN[new Date(y, m - 1, dd).getDay()]}</span></div>`; }).join('');
  app.innerHTML = `<div class="stack"><div><div class="label">${LABEL[S.lang]}</div><h1>Sổ từ & tiến độ</h1></div>
    <section class="stats"><div class="stat"><span class="label">Chuỗi ngày</span><b class="num">${streakNow()}</b><small class="muted">ngày liên tiếp</small></div><div class="stat"><span class="label">Cấp độ</span><b class="num">${lvl}</b><small class="muted num">${S.xp} XP</small></div><div class="stat"><span class="label">Đang học</span><b class="num">${learned}</b><small class="muted">từ ${LABEL[S.lang].toLowerCase()}</small></div><div class="stat"><span class="label">Đã thuộc</span><b class="num">${mastered}</b><small class="muted">nhớ liên tiếp 3 lần</small></div></section>
    <div class="cols"><section class="card"><div class="row spread" style="margin-bottom:12px"><h2>7 ngày gần đây</h2><span class="hint">hôm nay ${h.n}/${S.goal}</span></div><div class="chart">${chart}</div></section>
    <section class="card stack"><h2>Cài đặt và sao lưu</h2><div class="field"><label class="label" for="goal">Từ mới mỗi ngày</label><select id="goal">${[5, 10, 20, 30, 50].map((g) => `<option value="${g}"${g === S.goal ? ' selected' : ''}>${g} từ mới</option>`).join('')}</select></div>
    <div class="row"><button class="btn ghost sm" type="button" data-act="export">Tải bản sao lưu</button><label class="btn ghost sm" for="imp" style="cursor:pointer">Khôi phục</label><input id="imp" type="file" accept="application/json" hidden></div>
    ${S.confirm ? '<div class="row"><button class="btn danger sm" type="button" data-act="reset2">Xóa hết, không hoàn tác</button><button class="btn ghost sm" type="button" data-act="reset0">Hủy</button></div>' : '<div><button class="btn ghost sm" type="button" data-act="reset1">Xóa toàn bộ tiến độ</button></div>'}</section></div>
    ${accountHTML()}
    <section class="card"><div class="row spread" style="margin-bottom:8px"><h2>Sổ từ (${ids.length})</h2><div class="row">${META[S.lang].decks.length ? `<button class="btn sm" type="button" data-act="book-study"${ids.length ? '' : ' disabled'}>Học thẻ nhớ</button>` : ''}</div></div><div id="saved" class="wl">${ids.length ? '<div class="loading">Đang tải...</div>' : '<p class="muted">Chưa có từ nào. Bấm biểu tượng ngôi sao ở trang chi tiết để lưu từ vào sổ.</p>'}</div></section></div>`;
  if (ids.length) {
    const rows = await api('/api/rows', { lang: S.lang, ids: ids.slice(0, 300).join(',') });
    const el = $('#saved'); if (!el) return;
    el.innerHTML = rows.map((r) => `<div class="wi"><button class="main" type="button" data-act="open" data-id="${r.id}"><span class="h" style="font-weight:700;font-size:17px" lang="${HTML_LANG[S.lang]}">${esc(r.head)}</span> <span class="muted">${esc(r.reading)}</span><div class="s${S.notes[key(r.id)] ? ' note' : ''}"${S.lang === 'en' && !S.notes[key(r.id)] && !r.vi ? ' lang="zh-Hans"' : ''} style="font-size:14px">${esc(S.notes[key(r.id)] || r.vi || r.short)}</div></button><button class="btn ghost sm" type="button" data-act="unsave" data-id="${r.id}">Bỏ</button></div>`).join('') + (ids.length > 300 ? '<p class="hint">Hiển thị 300 từ đầu.</p>' : '');
  }
}

/* ---------------- sự kiện ---------------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  try {
    if (a === 'lang') { if (b.dataset.v !== S.lang) { S.lang = b.dataset.v; save(); ui.results = null; ui.q = ''; ui.sel = null; ui.selView = null; ui.fc = null; ui.quiz = null; chrome(); render(); } }
    else if (a === 'tab') { if (b.dataset.v !== 'cards') ui.fc = null; if (b.dataset.v !== 'quiz') ui.quiz = null; setView(b.dataset.v); }
    else if (a === 'try') { ui.q = b.dataset.v; render(); doSearch(ui.q); }
    else if (a === 'try-in') { S.lang = b.dataset.lang; save(); ui.results = null; ui.sel = null; ui.selView = null; ui.fc = null; ui.quiz = null; ui.q = b.dataset.v; view = 'search'; chrome(); render(); doSearch(ui.q); window.scrollTo(0, 0); }
    else if (a === 'open') { e.stopPropagation(); await openEntry(Number(b.dataset.id)); }
    else if (a === 'back') { ui.sel = null; ui.selView = null; paintResults(); paintDetail(); }
    else if (a === 'speak') { e.stopPropagation(); speak(b.dataset.t); }
    else if (a === 'save') {
      const k = key(b.dataset.id); if (S.saved[k]) delete S.saved[k]; else S.saved[k] = 1; save();
      toast(S.saved[k] ? 'Đã lưu vào sổ từ' : 'Đã bỏ khỏi sổ từ'); paintDetail(); paintResults();
    }
    else if (a === 'unsave') { delete S.saved[key(b.dataset.id)]; save(); render(); }
    else if (a === 'tr-go') await doTranslate();
    else if (a === 'tr-clear') { ui.tr = { ...ui.tr, text: '', res: null, err: '' }; render(); }
    else if (a === 'tr-swap') {
      const t = ui.tr, src = t.from === 'auto' ? (LABEL[t.res?.detected] ? t.res.detected : '') : t.from;
      if (!src) return toast('Chưa biết ngôn ngữ nguồn để đổi chiều');
      ui.tr = { ...t, from: t.to, to: src, text: t.res ? t.res.text : t.text, res: null, err: '' }; render();
    }
    else if (a === 'tr-copy') { try { await navigator.clipboard.writeText(ui.tr.res.text); toast('Đã sao chép'); } catch (e) { toast('Không sao chép được'); } }
    else if (a === 'tr-speak') speak(ui.tr.res.text, SPEECH[ui.tr.to]);
    else if (a === 'auth-login' || a === 'auth-register') {
      const d = await authApi(a === 'auth-login' ? '/api/auth/login' : '/api/auth/register', 'POST', { user: $('#authuser').value, password: $('#authpass').value });
      ACC = d.user; await pullProgress(); chrome(); render(); toast('Đã đăng nhập');
    }
    else if (a === 'auth-logout') {
      if (!(await pushProgress())) return toast('Chưa đồng bộ được lên server, hãy thử lại trước khi đăng xuất');
      await authApi('/api/auth/logout', 'POST', {});
      ACC = null; localStorage.removeItem(KEY); S = structuredClone(DEF); ui.results = null; ui.q = ''; ui.sel = null; ui.selView = null; ui.fc = null; ui.quiz = null;
      chrome(); render(); toast('Đã đăng xuất');
    }
    else if (a === 'auth-sync') { await pullProgress(); render(); toast('Đã đồng bộ'); }
    else if (a === 'fc-start') await startCards();
    else if (a === 'fc-flip') { if (e.target.closest('.iconbtn')) return; if (ui.fc && ui.fc.i < ui.fc.q.length) { ui.fc.flip = !ui.fc.flip; render(); } }
    else if (a === 'fc-rate') rateCard(Number(b.dataset.r));
    else if (a === 'fc-quit') { ui.fc = { ...ui.fc, i: ui.fc.q.length }; render(); }
    else if (a === 'fc-menu') { ui.fc = null; render(); }
    else if (a === 'quiz-start') await startQuiz();
    else if (a === 'quiz-again') { const d = ui.quiz.dir; ui.quiz = null; ui.qdir = d; await startQuiz(); }
    else if (a === 'quiz-quit') { ui.quiz = null; render(); }
    else if (a === 'pick') pickAnswer(Number(b.dataset.i));
    else if (a === 'next') nextQuestion();
    else if (a === 'book-study') { S.deck[S.lang] = 'saved'; save(); ui.fc = null; setView('cards'); }
    else if (a === 'export') {
      const url = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
      const l = document.createElement('a'); l.href = url; l.download = `hoc-deu-backup-${today()}.json`; l.click(); URL.revokeObjectURL(url);
    }
    else if (a === 'reset1') { S.confirm = true; render(); }
    else if (a === 'reset0') { S.confirm = false; render(); }
    else if (a === 'reset2') { localStorage.removeItem(KEY); S = structuredClone(DEF); ui.fc = null; ui.quiz = null;pushProgress(); chrome(); render(); toast('Đã xóa tiến độ'); }
  } catch (err) { console.error(err); toast(err.status ? err.message : 'Có lỗi, thử lại nhé'); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') doSearch(e.target.value);
  else if (e.target.id === 'trtext') { ui.tr.text = e.target.value; const c = $('#trcount'); if (c) c.textContent = e.target.value.length + '/5000'; }
  else if (e.target.id === 'note') {
    const k = key(e.target.dataset.id), v = e.target.value.trim();
    if (v) S.notes[k] = v; else delete S.notes[k]; save();
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.actChange === 'deck') { S.deck[S.lang] = t.value; save(); ui.fc = null; render(); }
  else if (t.id === 'trfrom') ui.tr.from = t.value;
  else if (t.id === 'trto') ui.tr.to = t.value;
  else if (t.id === 'goal') { S.goal = Number(t.value) || 10; save(); toast('Đã lưu mục tiêu'); }
  else if (t.id === 'dir') ui.qdir = t.value;
  else if (t.id === 'imp' && t.files[0]) {
    t.files[0].text().then((x) => { const o = JSON.parse(x); if (!o || typeof o !== 'object' || !o.cards) throw 0; S = { ...DEF, ...o }; save(); chrome(); render(); toast('Đã khôi phục'); }).catch(() => toast('Tệp sao lưu không hợp lệ'));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'authpass' && e.key === 'Enter') { $('[data-act=auth-login]')?.click(); return; }
  if (e.target.id === 'trtext' && (e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doTranslate(); return; }
  const tg = e.target.tagName;
  if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
  if (view === 'cards' && ui.fc && ui.fc.i < ui.fc.q.length) {
    if (e.key === ' ' || (e.key === 'Enter' && tg !== 'BUTTON')) { e.preventDefault(); ui.fc.flip = !ui.fc.flip; render(); }
    else if (ui.fc.flip && '123'.includes(e.key) && e.key) rateCard(Number(e.key) - 1);
  } else if (view === 'quiz' && ui.quiz && !ui.quiz.done) {
    const n = Number(e.key); if (n >= 1 && n <= 4 && ui.quiz.picked === null) pickAnswer(n - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && ui.quiz.picked !== null && tg !== 'BUTTON') { e.preventDefault(); nextQuestion(); }
  }
});

/* ---------------- khởi động ---------------- */
(async function init() {
  $('#app').innerHTML = '<div class="loading">Đang nạp dữ liệu từ điển...</div>';
  try { META = await api('/api/meta'); } catch (e) { $('#app').innerHTML = '<div class="card">Không kết nối được server. Chạy <b>node server.mjs</b> rồi mở http://localhost:3000.</div>'; return; }
  if (!STATIC) try { const me = await authApi('/api/auth/me'); if (me.user) { ACC = me.user; await pullProgress(); } } catch (e) {}
  try { const me = await authApi('/api/auth/me'); if (me.user) { ACC = me.user; await pullProgress(); } } catch (e) {}
  if (!META[S.lang]) S.lang = 'en';
  const hash = location.hash.slice(1); if (TABS.some((t) => t[0] === hash)) view = hash;
  chrome(); render();
})();
