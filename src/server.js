'use strict';

/* Barbeiros League — servidor local (site + painel de admin + API).
   Uso: npm start  →  http://localhost:3000 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

require('./env').load();
const { DB_PATH, ROOT } = require('./db');
const { buildLeague } = require('./league');
const auth = require('./auth');
const { ROUTES, HttpError } = require('./routes/admin');

const WEB_DIR = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || (process.env.ADMIN_PASSWORD ? '0.0.0.0' : '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};

function send(res, code, data, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new HttpError(413, 'Arquivo grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new HttpError(400, 'JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (method === 'GET' && pathname === '/api/league') return send(res, 200, buildLeague());
  if (method === 'GET' && pathname === '/api/session') return send(res, 200, auth.status(req));
  if (method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    const r = auth.login(req, res, body.password);
    return r.ok ? send(res, 200, { canEdit: true }) : send(res, 401, { error: 'Senha incorreta.' });
  }
  if (method === 'POST' && pathname === '/api/logout') { auth.logout(req, res); return send(res, 200, { ok: true }); }

  if (pathname.startsWith('/api/admin/')) {
    if (!auth.canEdit(req)) return send(res, 401, { error: 'Entre como admin para editar.' });
    // Proteção simples contra CSRF: exige o cabeçalho enviado pelo nosso frontend.
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'barbeiros') return send(res, 403, { error: 'Requisição recusada.' });
    for (const [m, re, handler] of ROUTES) {
      if (m !== method) continue;
      const match = pathname.match(re);
      if (!match) continue;
      const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : {};
      const params = Object.fromEntries(Object.entries(match.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      return send(res, 200, handler({ body, params }));
    }
  }
  return send(res, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(req, res, pathname) {
  if (pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end('window.BARBEIROS = { mode: "server" };');
  }
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Página não encontrada'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { res.writeHead(400); return res.end(); }
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  handleApi(req, res, pathname).catch(err => {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error('Erro na API', req.method, pathname, err);
    if (!res.headersSent) send(res, 500, { error: err.message || 'Erro interno.' });
  });
});

server.listen(PORT, HOST, () => {
  const where = HOST === '127.0.0.1' ? 'só neste computador' : 'na rede (com senha de admin)';
  console.log(`\n🏁 Barbeiros League rodando em http://localhost:${PORT}  (${where})`);
  console.log(`   Banco: ${path.relative(ROOT, DB_PATH)}`);
  console.log(process.env.ADMIN_PASSWORD ? '   Admin: protegido por senha (ADMIN_PASSWORD).' : '   Admin: liberado neste computador. Defina ADMIN_PASSWORD no .env para usar senha.\n');
});
