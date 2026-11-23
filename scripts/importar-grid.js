'use strict';

/* Importa para o banco as posições de largada (grid) da League 1, extraídas da planilha F1LM.
   Uso:  node scripts/importar-grid.js [arquivo.json] [--simular] [--forcar]
   - Lê data/planilhas/grids-league1.json (já extraído da planilha; não precisa do pacote xlsx).
   - Não mexe em linhas que já existem (lançadas à mão ou pela telemetria). --forcar substitui.
   - Grava com origem "planilha". Antes de gravar, faz uma cópia do banco em data/backups/. */

const fs = require('node:fs');
const path = require('node:path');
const { db, uuid, withTransaction, ROOT } = require('../src/db');
const { backup } = require('../src/maintenance');

const args = process.argv.slice(2);
const simular = args.includes('--simular'); const forcar = args.includes('--forcar');
const file = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'data', 'planilhas', 'grids-league1.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const champ = db.prepare('SELECT id, name FROM championships WHERE id = ?').get(data.championshipId);
if (!champ) { console.error('Temporada não encontrada no banco:', data.championshipId); process.exit(1); }

const findDriver = (name) => {
  const rows = db.prepare('SELECT id, name FROM drivers WHERE lower(name) = lower(?)').all(name);
  return rows.length === 1 ? rows[0] : null;
};
const exists = db.prepare('SELECT source FROM qualifying WHERE race_id = ? AND driver_id = ?');
const teamOf = db.prepare('SELECT team_id FROM results WHERE race_id = ? AND driver_id = ?');
const upsert = db.prepare(`INSERT INTO qualifying (id, championship_id, race_id, driver_id, team_id, position, best_lap_ms, source)
  VALUES (?,?,?,?,?,?,NULL,'planilha')
  ON CONFLICT(race_id, driver_id) DO UPDATE SET position = excluded.position, team_id = excluded.team_id, best_lap_ms = NULL, source = 'planilha'`);

const plan = []; const problems = [];
for (const r of data.races) {
  if (!db.prepare('SELECT 1 FROM races WHERE id = ?').get(r.raceId)) { problems.push(`Corrida ${r.raceId} não existe no banco.`); continue; }
  const seen = new Map();
  for (const g of r.grids) {
    const d = findDriver(g.driver);
    if (!d) { problems.push(`${r.circuit}: piloto "${g.driver}" não encontrado (ou nome repetido).`); continue; }
    if (seen.has(g.grid)) problems.push(`${r.circuit}: posição ${g.grid} repetida (${seen.get(g.grid)} e ${d.name}). Importado como está; corrija no admin.`);
    seen.set(g.grid, d.name);
    const ex = exists.get(r.raceId, d.id);
    plan.push({ r, d, grid: g.grid, skip: !!ex && !forcar, had: ex && ex.source });
  }
}
const todo = plan.filter(p => !p.skip);
console.log(`${champ.name}: ${plan.length} posições na planilha, ${todo.length} a gravar, ${plan.length - todo.length} já existiam (mantidas).`);
for (const r of data.races) console.log(`  etapa ${r.round} ${r.circuit}: ${plan.filter(p => p.r === r && !p.skip).length} novas`);
problems.forEach(p => console.log('  ⚠', p));
if (simular) { console.log('Simulação: nada gravado.'); process.exit(0); }
if (!todo.length) { console.log('Nada a fazer.'); process.exit(0); }

console.log('Cópia de segurança:', path.basename(backup('antes-importar-grid')));
withTransaction(() => {
  for (const p of todo) {
    const t = teamOf.get(p.r.raceId, p.d.id);
    upsert.run(uuid(), champ.id, p.r.raceId, p.d.id, t ? t.team_id : null, p.grid);
  }
});
console.log(`Pronto: ${todo.length} posições gravadas. Confira em Admin → Classificação (quali) e use "Publicar no site".`);
