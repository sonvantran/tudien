// Tài khoản + lưu tiến độ học trên server. Không cần thư viện ngoài (Node 18+).
// Dữ liệu nằm trong thư mục accounts/ (users.json, secret.key, progress-*.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createAuth(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const usersFile = path.join(dir, 'users.json');
  const secretFile = path.join(dir, 'secret.key');
  const users = fs.existsSync(usersFile) ? JSON.parse(fs.readFileSync(usersFile, 'utf8')) : {};
  let secret;
  if (fs.existsSync(secretFile)) secret = fs.readFileSync(secretFile);
  else { secret = crypto.randomBytes(32); fs.writeFileSync(secretFile, secret, { mode: 0o600 }); }

  const SECURE = process.env.COOKIE_SECURE === '1'; // đặt 1 khi chạy sau HTTPS
  const MAX_AGE = 30 * 24 * 3600; // 30 ngày
  const saveUsers = () => { fs.writeFileSync(usersFile + '.tmp', JSON.stringify(users)); fs.renameSync(usersFile + '.tmp', usersFile); };
  const progFile = (u) => path.join(dir, 'progress-' + crypto.createHash('sha256').update(u).digest('hex').slice(0, 24) + '.json');

  const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64);
  const sign = (s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
  const makeToken = (u) => { const p = Buffer.from(JSON.stringify({ u, e: Date.now() + MAX_AGE * 1000 })).toString('base64url'); return p + '.' + sign(p); };
  function readToken(t) {
    if (!t) return null; const [p, sig] = t.split('.'); if (!p || !sig) return null;
    const ok = sig.length === sign(p).length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(p)));
    if (!ok) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.e > Date.now() && users[d.u] ? d.u : null; } catch (e) { return null; }
  }
  const cookieOf = (req, name) => { for (const c of (req.headers.cookie || '').split(';')) { const [k, ...v] = c.trim().split('='); if (k === name) return v.join('='); } return ''; };
  const setCookie = (res, val, age) => res.setHeader('Set-Cookie', `hd_session=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE ? '; Secure' : ''}`);
  const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  // Giới hạn thử mật khẩu sai: 10 lần / 15 phút cho mỗi (ip + tên).
  const fails = new Map();
  const blocked = (k) => { const f = (fails.get(k) || []).filter((t) => Date.now() - t < 900000); fails.set(k, f); return f.length >= 10; };
  const fail = (k) => fails.set(k, [...(fails.get(k) || []), Date.now()]);

  async function body(req, max) {
    let b = ''; for await (const ch of req) { b += ch; if (b.length > max) throw new Error('too big'); }
    return JSON.parse(b || '{}');
  }
  const sessionUser = (req) => readToken(cookieOf(req, 'hd_session'));

  // Trả true nếu đã xử lý request.
  return async function handle(req, res, u) {
    const p = u.pathname;
    if (!(p.startsWith('/api/auth/') || p === '/api/progress')) return false;
    try {
      if ((req.method === 'POST' || req.method === 'PUT') && !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, { error: 'content-type' }, 415), true;

      if (p === '/api/auth/me') { const user = sessionUser(req); return json(res, { user: user || null }), true; }
      if (p === '/api/auth/logout' && req.method === 'POST') { setCookie(res, '', 0); return json(res, { ok: true }), true; }

      if ((p === '/api/auth/register' || p === '/api/auth/login') && req.method === 'POST') {
        const d = await body(req, 2000);
        const name = String(d.user || '').trim().toLowerCase(), pw = String(d.password || '');
        const key = (req.socket.remoteAddress || '') + '|' + name;
        if (blocked(key)) return json(res, { error: 'Thử sai quá nhiều lần, hãy đợi 15 phút.' }, 429), true;
        if (p === '/api/auth/register') {
          if (!/^[a-z0-9_.-]{3,30}$/.test(name)) return json(res, { error: 'Tên đăng nhập 3–30 ký tự: chữ không dấu, số, _ . -' }, 400), true;
          if (pw.length < 8 || pw.length > 200) return json(res, { error: 'Mật khẩu cần từ 8 ký tự.' }, 400), true;
          if (users[name]) return json(res, { error: 'Tên đăng nhập đã có người dùng.' }, 409), true;
          const salt = crypto.randomBytes(16);
          users[name] = { salt: salt.toString('hex'), hash: hash(pw, salt).toString('hex'), created: Date.now() };
          saveUsers();
        } else {
          const rec = users[name];
          const good = rec && crypto.timingSafeEqual(hash(pw, Buffer.from(rec.salt, 'hex')), Buffer.from(rec.hash, 'hex'));
          if (!good) { fail(key); return json(res, { error: 'Sai tên đăng nhập hoặc mật khẩu.' }, 401), true; }
        }
        setCookie(res, makeToken(name), MAX_AGE);
        return json(res, { user: name }), true;
      }

      if (p === '/api/progress') {
        const user = sessionUser(req);
        if (!user) return json(res, { error: 'auth' }, 401), true;
        if (req.method === 'GET') {
          const f = progFile(user);
          return json(res, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { data: null }), true;
        }
        if (req.method === 'PUT') {
          const d = await body(req, 3_000_000);
          if (!d.data || typeof d.data !== 'object' || Array.isArray(d.data)) return json(res, { error: 'data' }, 400), true;
          const f = progFile(user);
          fs.writeFileSync(f + '.tmp', JSON.stringify({ data: d.data, updated: Date.now() })); fs.renameSync(f + '.tmp', f);
          return json(res, { ok: true }), true;
        }
      }
      return json(res, { error: 'not found' }, 404), true;
    } catch (e) { return json(res, { error: 'Yêu cầu không hợp lệ.' }, 400), true; }
  };
}