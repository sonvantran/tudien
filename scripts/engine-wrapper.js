/* Học Đều — bộ tra từ chạy ngay trong trình duyệt (bản tĩnh cho GitHub Pages).
   Tệp engine.js được TỰ SINH bởi scripts/build_static.mjs từ server.mjs. Đừng sửa tay. */
(function (global) {
'use strict';
const RAW = {}; // văn bản JSON đã tải, đưa cho code của server đọc như đọc tệp
const fs = { readFileSync: (p) => RAW[p] };
const path = { join: (_dir, f) => f };
const DATA = '';
const process = { env: {} };
function abortAfter(ms) { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; }

/*__DICT__*/

/*__TRANSLATE__*/

/* ------------------------------------------------------------ phần riêng của bản tĩnh */
function callApi(pathname, params) {
  const u = new URL('http://x' + pathname);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  let out = '';
  api(null, { writeHead() {}, end(b) { out = b; } }, u);
  return JSON.parse(out);
}

let bannerEl = null;
function banner(msg) {
  if (typeof document === 'undefined') return;
  if (!msg) { if (bannerEl) { bannerEl.remove(); bannerEl = null; } return; }
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.setAttribute('role', 'status');
    bannerEl.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:50;max-width:460px;margin:0 auto;padding:12px 16px;border-radius:12px;background:#12332a;color:#fff;font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);text-align:center';
    document.body.appendChild(bannerEl);
  }
  bannerEl.textContent = msg;
}

let metaP = null, BYTES = {};
function meta() {
  return (metaP ||= fetch('meta.json').then((r) => { if (!r.ok) throw new Error('meta ' + r.status); return r.json(); }).then((m) => { BYTES = m._bytes || {}; delete m._bytes; return m; }));
}

async function download(file, label) {
  const r = await fetch('data/' + file);
  if (!r.ok) throw new Error('Không tải được ' + file + ' (' + r.status + ')');
  const total = BYTES[file] || 0;
  if (!r.body || !r.body.getReader) return r.text();
  const reader = r.body.getReader(), chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length;
    banner(`Đang tải dữ liệu ${label}... ${total ? Math.min(99, Math.round((got / total) * 100)) + '%' : (got / 1048576).toFixed(0) + ' MB'}`);
  }
  const buf = new Uint8Array(got); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return new TextDecoder().decode(buf);
}

const pending = {};
function ensure(code) {
  if (loaded[code]) return Promise.resolve();
  if (!LANGS[code]) return Promise.reject(new Error('lang'));
  return (pending[code] ||= (async () => {
    await meta();
    if (code !== 'vi') await ensure('vi');
    const text = await download(code + '.json', LANGS[code].name);
    banner(`Đang xử lý dữ liệu ${LANGS[code].name}...`);
    await new Promise((res) => setTimeout(res, 40)); // cho trình duyệt kịp vẽ thông báo
    RAW[code + '.json'] = text;
    try { lang(code); } finally { delete RAW[code + '.json']; }
  })().finally(() => { delete pending[code]; banner(''); }));
}

async function engineApi(pathname, params = {}) {
  if (pathname === '/api/meta') return meta();
  await ensure(params.lang || 'en');
  return callApi(pathname, params);
}

async function translate(text, from, to) {
  text = String(text || '').trim();
  if (!text) throw Object.assign(new Error('empty'), { status: 400 });
  if (text.length > TR_MAX) throw Object.assign(new Error('too_long'), { status: 413 });
  if (!TR_LANGS[to] || (from !== 'auto' && !TR_LANGS[from])) throw Object.assign(new Error('lang'), { status: 400 });
  if (from === to) return { text, detected: from, provider: 'none' };
  try { return await translateText(text, from, to); } catch (e) { throw Object.assign(new Error('offline'), { status: 503 }); }
}

global.Engine = { api: engineApi, translate, preload: (code) => ensure(code), _internals: { RAW, lang, callApi, LANGS } };
})(typeof window !== 'undefined' ? window : globalThis);