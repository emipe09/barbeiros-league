'use strict';

/* Proteção das rotas de edição.
   - Com ADMIN_PASSWORD definido: é preciso entrar com a senha (cookie de sessão).
   - Sem senha: a edição só é permitida a partir do próprio computador (localhost). */

const crypto = require('node:crypto');

const COOKIE = 'bb_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 dias
const sessions = new Map(); // token -> expiresAt

const password = () => process.env.ADMIN_PASSWORD || '';

function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hasSession(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}

/** Estado de acesso para o frontend. */
function status(req) {
  if (password()) return { canEdit: hasSession(req), needsPassword: true };
  return { canEdit: isLoopback(req), needsPassword: false, localOnly: true };
}
const canEdit = (req) => status(req).canEdit;

function login(req, res, pass) {
  if (!password()) return { ok: isLoopback(req) };
  if (!safeEqual(pass || '', password())) return { ok: false };
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
  return { ok: true };
}

function logout(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) sessions.delete(t);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

module.exports = { status, canEdit, login, logout };
