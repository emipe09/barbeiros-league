'use strict';

/* Gera o site público (somente leitura) em dist/:
     dist/index.html, css, js ...  (cópia de web/)
     dist/data/league.json         (snapshot do banco)
     dist/config.js                (modo "static": sem painel de admin)
   Uso: npm run build */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WEB = path.join(ROOT, 'web');

process.env.F1_READONLY = '1';
const { buildLeague } = require('../src/league');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(WEB, DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });

const league = buildLeague();
fs.writeFileSync(path.join(DIST, 'data', 'league.json'), JSON.stringify(league));
fs.writeFileSync(path.join(DIST, 'config.js'), `window.BARBEIROS = { mode: "static", builtAt: ${JSON.stringify(league.generatedAt)} };\n`);
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
fs.copyFileSync(path.join(DIST, 'index.html'), path.join(DIST, '404.html'));

const races = league.championships.reduce((n, c) => n + c.doneCount, 0);
console.log(`✔ Site gerado em dist/ — ${league.championships.length} temporadas, ${races} corridas com resultado.`);
