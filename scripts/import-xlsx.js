'use strict';

/* =====================================================================
   Importação da planilha "F1LM" (league manager) para o banco SQLite.

   Uso:
     node scripts/import-xlsx.js <arquivo.xlsx> [--replace] [--dry-run] [--force]
                         [--name "Temporada 2026"] [--season 2026]

   O que é lido:
     • League Management     -> calendário, pilotos efetivos/reservas e equipes
     • Final Classifications -> resultado/grade de todas as corridas
     • Data                  -> voltas rápidas por corrida
     • Championships         -> classificação final (usada para validação)

   Por padrão a importação substitui apenas um campeonato com o mesmo id.
   Use --replace para zerar o banco antes (um backup é criado em data/backups/).
===================================================================== */

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const { db, now, withTransaction, DB_PATH } = require('../src/db');
const { computeChampionship } = require('../src/standings');

const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const TRACKS = {
  BEL: { country: 'Bélgica',      name: 'GP da Bélgica',      flag: '🇧🇪', circuit: 'Spa-Francorchamps' },
  CHI: { country: 'China',        name: 'GP da China',        flag: '🇨🇳', circuit: 'Xangai' },
  ESP: { country: 'Espanha',      name: 'GP de Espanha',      flag: '🇪🇸', circuit: 'Barcelona' },
  GBR: { country: 'Grã-Bretanha', name: 'GP da Grã-Bretanha', flag: '🇬🇧', circuit: 'Silverstone' },
  MIA: { country: 'Miami',        name: 'GP de Miami',        flag: '🇺🇸', circuit: 'Miami' },
  JAP: { country: 'Japão',        name: 'GP do Japão',        flag: '🇯🇵', circuit: 'Suzuka' },
  ITA: { country: 'Itália',       name: 'GP da Itália',       flag: '🇮🇹', circuit: 'Monza' },
  SIN: { country: 'Singapura',    name: 'GP de Singapura',    flag: '🇸🇬', circuit: 'Marina Bay' },
  AUS: { country: 'Áustria',      name: 'GP da Áustria',      flag: '🇦🇹', circuit: 'Red Bull Ring' },
  BRA: { country: 'Brasil',       name: 'GP do Brasil',       flag: '🇧🇷', circuit: 'Interlagos' },
  ABU: { country: 'Abu Dhabi',    name: 'GP de Abu Dhabi',    flag: '🇦🇪', circuit: 'Yas Marina' },
};

const TEAM_COLORS = {
  'Mercedes': '#00d2be',
  'Ferrari': '#dc0000',
  'Red Bull': '#1e41ff',
  'Aston Martin': '#006f62',
  'McLaren': '#ff8700',
  'Alpine': '#0090ff',
  'Alpha Tauri': '#2b4562',
  'Alfa Romeo': '#900000',
  'Haas': '#a0a6ad',
  'Williams': '#005aff',
  'Reserva': '#6b7280',
};

const RESERVE_TEAM = 'Reserva';

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */
const cell = (ws, r, c) => {
  const x = ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })];
  return x ? x.v : undefined;
};
const text = (ws, r, c) => {
  const v = cell(ws, r, c);
  return v == null ? '' : String(v).replace(/\u00a0/g, ' ').trim();
};
const number = (ws, r, c) => {
  const v = cell(ws, r, c);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const slug = (s) => String(s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const teamId = (name) => 'team-' + slug(name);
const driverId = (name) => 'driver-' + slug(name);
const raceId = (abbr) => 'race-' + abbr.toLowerCase();

function parseArgs(argv) {
  const valueAfter = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };
  const name = valueAfter('--name');
  const season = valueAfter('--season');
  const file = argv.find(a => !a.startsWith('--') && a !== name && a !== season);
  return {
    file, name, season,
    replace: argv.includes('--replace'),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    noActivate: argv.includes('--no-activate'),
  };
}

function findXlsx() {
  const roots = [path.join(__dirname, '..', 'data', 'planilhas'), path.join(__dirname, '..', 'data')];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const files = fs.readdirSync(root).filter(f => /\.(xlsx|xls)$/i.test(f) && !f.startsWith('~$')).sort();
    if (files.length) return path.join(root, files[0]);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* leitura da planilha                                                 */
/* ------------------------------------------------------------------ */
function parseLeague(wb) {
  const ws = wb.Sheets['League Management'];
  if (!ws) throw new Error('Aba "League Management" não encontrada.');

  const tracks = [];
  for (let r = 14; r <= 50; r++) {
    const name = text(ws, r, 9);   // I
    const abbr = text(ws, r, 11);  // K
    if (!name || !abbr) break;
    tracks.push({
      order: number(ws, r, 8) || tracks.length + 1, // H
      name, format: text(ws, r, 10) || 'Feature', abbr: abbr.toUpperCase(),
    });
  }
  if (!tracks.length) throw new Error('Calendário vazio em "League Management".');

  const fullTime = [];
  for (let r = 10; r <= 35; r++) {
    const n = text(ws, r, 19); // S
    if (n && n !== '-') fullTime.push(n);
  }
  const reserves = [];
  for (let r = 10; r <= 35; r++) {
    const n = text(ws, r, 24); // X
    if (n && n !== '-') reserves.push(n);
  }

  // O/P: nome da equipe seguido de "Driver 1/2" + piloto
  const teamNames = [];
  const assignments = [];
  let currentTeam = null;
  for (let r = 10; r <= 60; r++) {
    const o = text(ws, r, 15); // O
    const p = text(ws, r, 16); // P
    if (!o) continue;
    if (o === '---') break;
    if (/^Driver\s*\d+$/i.test(o)) {
      if (p && currentTeam) assignments.push({ team: currentTeam, driver: p });
      continue;
    }
    currentTeam = o;
    if (!teamNames.includes(o)) teamNames.push(o);
    if (p) assignments.push({ team: o, driver: p });
  }

  return { tracks, fullTime, reserves, teamNames, assignments };
}

function parseFinalClassifications(wb) {
  const ws = wb.Sheets['Final Classifications'];
  if (!ws) throw new Error('Aba "Final Classifications" não encontrada.');

  const races = [];
  const results = {}; // driver -> [valor por corrida]
  const grids = {};   // driver -> [posição de largada por corrida]

  for (let n = 0; n < 30; n++) {
    const s = 2 + 15 * n;
    const raceName = text(ws, 5, s);
    if (!raceName || /^inactive$/i.test(raceName)) break;

    races.push(raceName);
    let found = 0;
    for (let r = 8; r <= 40; r++) {
      const name = text(ws, r, s + 1);
      if (!name || name === '-') continue;
      found++;
      if (!results[name]) { results[name] = []; grids[name] = []; }
      results[name][n] = cell(ws, r, s + 7);
      grids[name][n] = cell(ws, r, s + 3);
    }
    if (!found) throw new Error(`Bloco da corrida "${raceName}" não tem pilotos.`);
  }
  return { races, results, grids };
}

function parseFastestLaps(wb) {
  const ws = wb.Sheets['Data'];
  if (!ws) return {};
  const out = {};
  for (let r = 20; r <= 47; r++) {
    const name = text(ws, r, 2); // B
    if (!name || name === '-') continue;
    out[name] = [];
    for (let i = 0; i < 11; i++) {
      const v = cell(ws, r, 67 + i); // BO..BY
      out[name][i] = (v == null || v === '' || Number(v) === 42) ? null : String(v);
    }
  }
  return out;
}

function parseSpreadsheetStandings(wb) {
  const ws = wb.Sheets['Championships'];
  if (!ws) throw new Error('Aba "Championships" não encontrada.');

  const drivers = {};
  const constructors = {};
  for (let r = 5; r <= 45; r++) {
    const team = text(ws, r, 3); // C
    const teamPts = number(ws, r, 4); // D
    if (team && team !== '---' && teamPts != null) constructors[team] = teamPts;

    const driver = text(ws, r, 10); // J
    const driverPts = number(ws, r, 11); // K
    if (driver && driver !== '-' && driverPts != null) drivers[driver] = driverPts;
  }
  return { drivers, constructors };
}

function parseLeagueStats(wb) {
  const ws = wb.Sheets['League Statistics'];
  if (!ws) return {};
  const out = {};
  for (let r = 5; r <= 45; r++) {
    const name = text(ws, r, 2); // B
    if (!name || name === '-') continue;
    out[name] = {
      starts: number(ws, r, 6),        // F
      wins: number(ws, r, 10),         // J
      fastestLaps: number(ws, r, 11),  // K
      podiums: number(ws, r, 12),      // L
      dnfs: number(ws, r, 13),         // M
      poles: number(ws, r, 17),        // Q
    };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* normalização / validação                                            */
/* ------------------------------------------------------------------ */
function normalizeResult(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 30) throw new Error('Posição inválida: ' + value);
    return { position: value, status: 'finished' };
  }
  const s = String(value).trim().toUpperCase();
  if (s === 'DNP') return null;
  if (['DNF', 'DSQ', 'DNS'].includes(s)) return { position: null, status: s };
  const n = Number(s);
  if (Number.isInteger(n) && n > 0) return { position: n, status: 'finished' };
  throw new Error('Resultado não reconhecido: ' + value);
}

function buildDataset(wb, options) {
  const league = parseLeague(wb);
  const fc = parseFinalClassifications(wb);
  const flTimes = parseFastestLaps(wb);
  const sheetStandings = parseSpreadsheetStandings(wb);
  const stats = parseLeagueStats(wb);

  if (fc.races.length !== league.tracks.length) {
    throw new Error(`Corridas na planilha (${fc.races.length}) diferente do calendário (${league.tracks.length}).`);
  }
  league.tracks.forEach((t, i) => {
    if (t.name.trim().toLowerCase() !== fc.races[i].trim().toLowerCase()) {
      throw new Error(`Corrida ${i + 1}: "${fc.races[i]}" não corresponde a "${t.name}".`);
    }
  });

  const allDrivers = [...league.fullTime, ...league.reserves];
  const unique = new Set(allDrivers);
  if (unique.size !== allDrivers.length) throw new Error('Piloto duplicado na lista da liga.');

  const teamOf = new Map();
  for (const a of league.assignments) {
    if (!allDrivers.includes(a.driver)) continue;
    if (teamOf.has(a.driver)) throw new Error('Piloto com duas equipes: ' + a.driver);
    teamOf.set(a.driver, a.team);
  }
  for (const d of league.fullTime) {
    if (!teamOf.has(d)) throw new Error('Piloto efetivo sem equipe: ' + d);
  }
  for (const d of league.reserves) {
    if (teamOf.has(d)) throw new Error('Piloto reserva com equipe fixa: ' + d);
  }
  if (league.teamNames.length !== 10) throw new Error('Esperava 10 equipes, encontrei ' + league.teamNames.length + '.');
  if (allDrivers.length !== 28) throw new Error('Esperava 28 pilotos, encontrei ' + allDrivers.length + '.');

  // voltas rápidas: uma por corrida (quando houver); em caso de empate na
  // planilha, fica com o piloto de melhor resultado.
  const fastestLap = {};
  for (let i = 0; i < fc.races.length; i++) {
    const candidates = allDrivers.filter(d => flTimes[d] && flTimes[d][i]);
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const ra = normalizeResult(fc.results[a] && fc.results[a][i]);
      const rb = normalizeResult(fc.results[b] && fc.results[b][i]);
      const pa = ra && typeof ra.position === 'number' ? ra.position : 99;
      const pb = rb && typeof rb.position === 'number' ? rb.position : 99;
      return pa - pb || a.localeCompare(b);
    });
    fastestLap[i] = candidates[0];
  }

  const totals = {};
  const flCount = {};
  const poleCount = {};
  const winCount = {};
  const podiumCount = {};
  for (const d of allDrivers) {
    totals[d] = 0; flCount[d] = 0; poleCount[d] = 0; winCount[d] = 0; podiumCount[d] = 0;
    for (let i = 0; i < fc.races.length; i++) {
      const r = normalizeResult(fc.results[d] && fc.results[d][i]);
      if (r && r.position != null) {
        totals[d] += POINTS[r.position - 1] || 0;
        if (r.position === 1) winCount[d]++;
        if (r.position <= 3) podiumCount[d]++;
      }
      if (Number(fc.grids[d] && fc.grids[d][i]) === 1) poleCount[d]++;
      if (fastestLap[i] === d) {
        flCount[d]++;
        const r2 = normalizeResult(fc.results[d] && fc.results[d][i]);
        if (r2 && typeof r2.position === 'number' && r2.position <= 10) totals[d] += 1;
      }
    }
  }

  // validação contra a classificação da planilha
  const problems = [];
  for (const d of allDrivers) {
    const expected = sheetStandings.drivers[d];
    if (expected == null) problems.push(`Piloto sem pontuação na aba Championships: ${d}`);
    else if (expected !== totals[d]) problems.push(`${d}: planilha ${expected} pts, calculado ${totals[d]} pts`);
  }
  const ctorTotals = {};
  for (const t of league.teamNames) ctorTotals[t] = 0;
  for (const d of allDrivers) {
    if (league.reserves.includes(d)) continue;
    const t = teamOf.get(d);
    ctorTotals[t] = (ctorTotals[t] || 0) + totals[d];
  }
  for (const t of league.teamNames) {
    const expected = sheetStandings.constructors[t];
    if (expected == null) problems.push(`Equipe sem pontuação na aba Championships: ${t}`);
    else if (expected !== ctorTotals[t]) problems.push(`${t}: planilha ${expected} pts, calculado ${ctorTotals[t]} pts`);
  }
  for (const d of allDrivers) {
    const s = stats[d];
    if (!s) continue;
    if (s.poles != null && s.poles !== poleCount[d]) problems.push(`${d}: poles planilha ${s.poles}, calculado ${poleCount[d]}`);
    if (s.fastestLaps != null && s.fastestLaps !== flCount[d]) problems.push(`${d}: voltas rápidas planilha ${s.fastestLaps}, calculado ${flCount[d]}`);
    if (s.wins != null && s.wins !== winCount[d]) problems.push(`${d}: vitórias planilha ${s.wins}, calculado ${winCount[d]}`);
    if (s.podiums != null && s.podiums !== podiumCount[d]) problems.push(`${d}: pódios planilha ${s.podiums}, calculado ${podiumCount[d]}`);
  }
  if (problems.length && !options.force) {
    throw new Error('Validação falhou:\n  - ' + problems.join('\n  - '));
  }
  if (problems.length) console.warn('⚠️  Validação com divergências (--force):\n  - ' + problems.join('\n  - '));

  /* -------- monta as entidades do banco -------- */
  const champId = 'temporada-' + slug(options.season);
  const teams = [...league.teamNames, RESERVE_TEAM].map(name => ({
    id: teamId(name), name, color: TEAM_COLORS[name] || '#888888',
  }));

  const drivers = allDrivers.map(name => ({
    id: driverId(name), name,
    default_team_id: teamId(teamOf.get(name) || RESERVE_TEAM),
    isReserve: !teamOf.has(name),
  }));

  const races = league.tracks.map((t, i) => {
    const meta = TRACKS[t.abbr];
    if (!meta) throw new Error('Sem metadados para a pista ' + t.abbr);
    return {
      id: raceId(t.abbr), round: i + 1,
      name: meta.name || t.name, country: meta.country, flag: meta.flag, circuit: meta.circuit, is_sprint: 0,
    };
  });

  const entries = drivers.map(d => ({
    id: 'entry-' + d.id + '-' + champId,
    championship_id: champId, driver_id: d.id,
    team_id: d.isReserve ? teamId(RESERVE_TEAM) : d.default_team_id,
    from_round: 1, is_reserve: d.isReserve ? 1 : 0,
  }));
  const entryTeam = new Map(entries.map(e => [e.driver_id, e.team_id]));

  const results = [];
  for (let i = 0; i < races.length; i++) {
    for (const d of drivers) {
      const r = normalizeResult(fc.results[d.name] && fc.results[d.name][i]);
      if (!r) continue; // DNP = não participou
      results.push({
        id: `res-${races[i].id}-${d.id}`,
        championship_id: champId, race_id: races[i].id, driver_id: d.id,
        team_id: entryTeam.get(d.id),
        position: r.position, status: r.status, sprint_position: null,
        fastest_lap: fastestLap[i] === d.name ? 1 : 0,
        pole: Number(fc.grids[d.name] && fc.grids[d.name][i]) === 1 ? 1 : 0,
      });
    }
  }

  const championship = {
    id: champId, name: options.name, season: options.season,
    status: 'finished', points: JSON.stringify(POINTS), sprint_points: JSON.stringify(SPRINT_POINTS),
    fastest_lap_point: 1, fastest_lap_top10: 1,
    created_at: now(), finished_at: now(),
  };

  return {
    league, fc, flTimes, sheetStandings, totals, ctorTotals,
    championship, teams, drivers, races, entries, results, fastestLap,
  };
}

/* ------------------------------------------------------------------ */
/* gravação                                                            */
/* ------------------------------------------------------------------ */
function backupDatabase() {
  if (!fs.existsSync(DB_PATH)) return null;
  return require('../src/maintenance').backup('antes-importar-planilha');
}

function writeDataset(ds, replace) {
  withTransaction(() => {
    if (replace) {
      db.exec('DELETE FROM results; DELETE FROM driver_entries; DELETE FROM races; DELETE FROM championships; DELETE FROM drivers; DELETE FROM teams; DELETE FROM meta;');
    } else {
      db.prepare('DELETE FROM championships WHERE id = ?').run(ds.championship.id);
    }

    const insTeam = db.prepare(`INSERT INTO teams (id, name, color, active, created_at) VALUES (?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, active = 1`);
    for (const t of ds.teams) insTeam.run(t.id, t.name, t.color, now());

    const insDriver = db.prepare(`INSERT INTO drivers (id, name, default_team_id, active, created_at) VALUES (?,?,?,1,?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, default_team_id = excluded.default_team_id, active = 1`);
    for (const d of ds.drivers) insDriver.run(d.id, d.name, d.default_team_id, now());

    db.prepare(`INSERT INTO championships
      (id, name, season, status, points, sprint_points, fastest_lap_point, fastest_lap_top10,
       winner_driver_id, winner_team_id, created_at, finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(ds.championship.id, ds.championship.name, ds.championship.season, ds.championship.status,
        ds.championship.points, ds.championship.sprint_points, ds.championship.fastest_lap_point,
        ds.championship.fastest_lap_top10, null, null, ds.championship.created_at, ds.championship.finished_at);

    const insRace = db.prepare('INSERT INTO races (id, championship_id, round, name, country, flag, circuit, is_sprint) VALUES (?,?,?,?,?,?,?,?)');
    for (const r of ds.races) insRace.run(r.id, ds.championship.id, r.round, r.name, r.country, r.flag, r.circuit, r.is_sprint);

    const insEntry = db.prepare('INSERT INTO driver_entries (id, championship_id, driver_id, team_id, from_round, is_reserve) VALUES (?,?,?,?,?,?)');
    for (const e of ds.entries) insEntry.run(e.id, e.championship_id, e.driver_id, e.team_id, e.from_round, e.is_reserve);

    const insResult = db.prepare(`INSERT INTO results
      (id, championship_id, race_id, driver_id, team_id, position, status, sprint_position, fastest_lap, pole)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const r of ds.results) {
      insResult.run(r.id, r.championship_id, r.race_id, r.driver_id, r.team_id, r.position, r.status,
        r.sprint_position, r.fastest_lap, r.pole);
    }

    const comp = computeChampionship({
      championship: ds.championship, teams: ds.teams, drivers: ds.drivers,
      races: ds.races, entries: ds.entries, results: ds.results,
    });
    db.prepare('UPDATE championships SET winner_driver_id = ?, winner_team_id = ? WHERE id = ?')
      .run(comp.leader ? comp.leader.id : null, comp.ctorLeader ? comp.ctorLeader.id : null, ds.championship.id);

    if (!ds.noActivate) {
      db.prepare(`INSERT INTO meta (key, value) VALUES ('active_championship_id', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(ds.championship.id);
    }
  });
}

function printSummary(ds, comp) {
  console.log('\n🏆 Campeonato:', ds.championship.name, '(' + ds.championship.season + ')');
  console.log(`   ${ds.races.length} corridas · ${ds.teams.length - 1} equipes + reservas · ${ds.drivers.length} pilotos · ${ds.results.length} resultados`);
  console.log('\nClassificação de pilotos:');
  comp.standings.forEach(s => console.log(
    `  ${String(s.position).padStart(2)}. ${s.name.padEnd(20)} ${String(s.points).padStart(3)} pts  ` +
    `(${s.teamName || '—'})  ${s.wins}V ${s.podiums}P ${s.poles}PO ${s.fastestLaps}VR`
  ));
  console.log('\nClassificação de construtores:');
  comp.ctorStandings.forEach(c => console.log(
    `  ${String(c.position).padStart(2)}. ${c.name.padEnd(14)} ${String(c.points).padStart(3)} pts  ${c.wins}V ${c.podiums}P`
  ));
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const file = options.file || findXlsx();
  if (!file) {
    console.error('❌ Nenhum arquivo .xlsx encontrado. Uso: node scripts/import-xlsx.js arquivo.xlsx [--replace]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error('❌ Arquivo não encontrado:', file);
    process.exit(1);
  }
  options.season = options.season || '2026';
  options.name = options.name || `Temporada ${options.season}`;
  options.force = process.argv.includes('--force');

  console.log('📂 Lendo:', file);
  const wb = XLSX.readFile(file, { sheetRows: 400, cellFormula: false });
  const ds = buildDataset(wb, options);
  ds.noActivate = options.noActivate;

  const comp = computeChampionship({
    championship: ds.championship, teams: ds.teams, drivers: ds.drivers,
    races: ds.races, entries: ds.entries, results: ds.results,
  });

  printSummary(ds, comp);
  if (options.dryRun) {
    console.log('\n🔎 --dry-run: nada foi gravado.');
    return;
  }

  let backup = null;
  if (options.replace) {
    backup = backupDatabase();
    if (backup) console.log('\n💾 Backup do banco:', backup);
  }
  writeDataset(ds, options.replace);

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log('\n✔ Dados gravados em', DB_PATH);
  console.log('   Campeão:', comp.leader ? comp.leader.name : '—', '·', comp.ctorLeader ? comp.ctorLeader.name : '—');
}

try {
  main();
} catch (err) {
  console.error('\n❌ ' + err.message);
  process.exit(1);
}
