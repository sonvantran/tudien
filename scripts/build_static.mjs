// Tạo bản tĩnh cho GitHub Pages vào thư mục docs/.
// Chạy: node scripts/build_static.mjs   (cần data/*.json đã có sẵn)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');
const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');

// Lấy một đoạn của server.mjs: từ dòng chú thích chứa `from` đến trước chú thích/hàm chứa `to`.
function between(from, to) {
  const a0 = server.indexOf(from), b0 = server.indexOf(to);
  if (a0 < 0 || b0 < 0) throw new Error(`Không tìm thấy "${a0 < 0 ? from : to}" trong server.mjs`);
  const a = server.lastIndexOf('/*', a0), b = to.startsWith('async function') ? b0 : server.lastIndexOf('/*', b0);
  if (b <= a) throw new Error('Thứ tự đoạn trong server.mjs không như dự kiến');
  return server.slice(a, b);
}
const dict = between('tiện ích', 'Dịch câu / đoạn văn');
const tr = between('Dịch câu / đoạn văn', 'async function apiTranslate')
  .replace('AbortSignal.timeout(ms)', 'abortAfter(ms)')            // Safari cũ chưa có AbortSignal.timeout
  .replace(", headers: { 'User-Agent': 'Mozilla/5.0' }", '');        // header tùy biến làm trình duyệt chặn (CORS preflight)
if (tr.includes('User-Agent')) throw new Error('Còn header User-Agent trong đoạn dịch');

const wrapper = fs.readFileSync(path.join(ROOT, 'scripts', 'engine-wrapper.js'), 'utf8');
const engine = wrapper.replace('/*__DICT__*/', () => dict).replace('/*__TRANSLATE__*/', () => tr);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'engine.js'), engine);

// meta.json: tổng số mục, các bộ từ và dung lượng tệp (để hiện % khi tải) — tính bằng chính code tra từ.
const g = {};
new Function('window', engine)(g);
const { RAW, lang, callApi, LANGS } = g.Engine._internals;
const bytes = {};
for (const code of Object.keys(LANGS)) {
  const f = code + '.json', p = path.join(ROOT, 'data', f);
  if (!fs.existsSync(p)) throw new Error('Thiếu ' + p);
  RAW[f] = fs.readFileSync(p, 'utf8'); bytes[f] = fs.statSync(p).size;
  fs.copyFileSync(p, path.join(OUT, 'data', f));
}
for (const code of Object.keys(LANGS)) lang(code);
const meta = callApi('/api/meta', {}); meta._bytes = bytes;
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));

// Trang và tài nguyên: đổi đường dẫn tuyệt đối thành tương đối để chạy được ở github.io/<tên-repo>/
let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const css = 'href="/style.css"', js = '<script src="/app.js" type="module"></script>';
if (!html.includes(css) || !html.includes(js)) throw new Error('public/index.html khác dự kiến (link style.css / app.js)');
html = html.replace(css, 'href="style.css"').replace(js, '<script>window.STATIC_MODE = true;</script>\n<script src="engine.js"></script>\n<script src="app.js" type="module"></script>');
fs.writeFileSync(path.join(OUT, 'index.html'), html);
fs.copyFileSync(path.join(ROOT, 'public', 'app.js'), path.join(OUT, 'app.js'));
fs.copyFileSync(path.join(ROOT, 'public', 'style.css'), path.join(OUT, 'style.css'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const kb = (n) => Math.round(n / 1024) + ' KB';
console.log('Đã tạo docs/: engine.js ' + kb(engine.length) + ', dữ liệu ' + mb(Object.values(bytes).reduce((a, b) => a + b, 0)));