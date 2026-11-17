'use strict';

/* Backups do banco e publicação (git push) do site. */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { db, ROOT, DB_PATH } = require('./db');

const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
const KEEP_BACKUPS = 30;

/** Copia o banco inteiro para data/backups/f1-<data>-<motivo>.db e mantém os últimos 30. */
function backup(reason = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = String(reason).replace(/[^a-z0-9-]+/gi, '-').slice(0, 40);
  const file = path.join(BACKUP_DIR, `f1-${stamp}-${safe}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return file;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 }).trim();
}

/** Faz commit do banco e envia para o GitHub. O GitHub Actions reconstrói o site. */
function publish(message) {
  try { git(['rev-parse', '--is-inside-work-tree']); } catch (_) {
    throw new Error('Esta pasta ainda não é um repositório Git. Siga o passo 2 do DEPLOY.md.');
  }
  const rel = path.relative(ROOT, DB_PATH);
  git(['add', rel]);
  const changed = git(['status', '--porcelain', '--', rel]);
  let committed = false;
  if (changed) {
    const when = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    git(['commit', '-m', message || `Atualiza resultados (${when})`, '--', rel]);
    committed = true;
  }
  let pushed = false;
  try {
    git(['push']);
    pushed = true;
  } catch (e) {
    const msg = String(e.stderr || e.message || '').trim().split('\n').slice(-3).join(' ');
    throw new Error('O commit foi feito, mas o envio para o GitHub falhou: ' + msg);
  }
  return { committed, pushed };
}

module.exports = { backup, publish, BACKUP_DIR };
