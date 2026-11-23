'use strict';

/* Importa a telemetria do Pits n' Giggles (pasta csv_output) para o site.

   Uso:
     npm run telemetria -- <pasta-da-sessão> [--corrida 5]
     npm run telemetria -- --todas "<pasta csv_output>"
   Opções:
     --corrida N|id   rodada (ou id) da corrida na temporada; sem isso tenta achar pela pista
     --temporada id   temporada (padrão: a ativa)
     --simular        só mostra o que seria feito, sem gravar nada
     --forcar         sobrescreve classificação lançada à mão
   O que faz: gera data/telemetria/<corrida>/*.json (vai para o site no próximo
   "Publicar") e, nas sessões de classificação, grava as posições do grid no banco. */

const fs = require('node:fs');
const path = require('node:path');
const { db, uuid, now, withTransaction, getMeta, DATA_DIR } = require('../src/db');
const { q } = require('../src/league');
const { teamAtRound } = require('../src/standings');
const { backup } = require('../src/maintenance');
const { importSession, readSessionInfo } = require('../src/telemetry');

const TEL_DIR = path.join(DATA_DIR, 'telemetria');
const MAP_FILE = path.join(TEL_DIR, 'mapa-pilotos.json');

/* ---------- argumentos ---------- */
const argv = process.argv.slice(2);
const opt = { _: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--simular' || a === '--forcar') opt[a.slice(2)] = true;
  else if (a.startsWith('--')) opt[a.slice(2)] = argv[++i];
  else opt._.push(a);
}
if (!opt._.length && !opt.todas) {
  console.log('Uso: npm run telemetria -- <pasta-da-sessão> [--corrida 5]\n     npm run telemetria -- --todas "<pasta csv_output>"');
  process.exit(1);
}

/* ---------- pista do jogo -> corrida da liga ---------- */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const TRACK_WORDS = {
  melbourne: ['austral', 'albert park', 'melbourne'], shanghai: ['china', 'xangai', 'shanghai'], sakhir: ['bahrein', 'bahrain', 'sakhir'],
  catalunya: ['espanha', 'spain', 'barcelona', 'catalunya'], monaco: ['monaco', 'monte carlo'], montreal: ['canada', 'montreal'],
  silverstone: ['silverstone', 'gra-bretanha', 'britain', 'reino unido'], hungaroring: ['hungria', 'hungary', 'hungaroring'],
  spa: ['belgica', 'belgium', 'spa'], monza: ['italia', 'italy', 'monza'], singapore: ['singapura', 'singapore', 'marina bay'],
  suzuka: ['japao', 'japan', 'suzuka'], abudhabi: ['abu dhabi', 'yas'], texas: ['eua', 'austin', 'americas', 'texas'],
  brazil: ['sao paulo', 'brasil', 'interlagos'], austria: ['austria', 'red bull ring', 'spielberg'], mexico: ['mexico', 'hermanos'],
  baku: ['azerbaijao', 'azerbaijan', 'baku'], zandvoort: ['holanda', 'netherlands', 'zandvoort'], imola: ['imola', 'emilia'],
  jeddah: ['arabia', 'saudi', 'jeddah'], miami: ['miami'], lasvegas: ['las vegas'], losail: ['catar', 'qatar', 'lusail', 'losail'],
  portimao: ['portugal', 'portimao'], paulricard: ['franca', 'france', 'ricard'],
};
function matchRace(races, gameTrack) {
  const id = norm(gameTrack).replace(/[^a-z0-9]/g, '');
  const words = TRACK_WORDS[id] || [norm(gameTrack)];
  return races.filter(r => {
    const hay = norm(`${r.name} ${r.circuit} ${r.country}`);
    return words.some(w => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(hay));
  });
}

/* ---------- pilotos ---------- */
const readMap = () => {
  try { return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')); } catch (_) { return {}; }
};
function driverByName(name, champId) {
  const rows = db.prepare('SELECT * FROM drivers WHERE lower(name) = lower(?)').all(String(name).trim());
  if (rows.length <= 1) return rows[0] || null;
  const inChamp = new Set(q.entries(champId).map(e => e.driver_id));
  return rows.find(r => inChamp.has(r.id)) || rows.find(r => r.active) || rows[0];
}

/* ---------- uma sessão ---------- */
function planSession(dir) {
  const info = readSessionInfo(dir);
  if (!info) return { dir, skip: 'sem session.csv (provavelmente só lobby)' };
  const { session, cars } = info;
  if (!session.kind) return { dir, skip: `tipo de sessão "${session.type}" não é importado` };
  if (![...cars.values()].some(c => !c.ai)) return { dir, skip: 'só pilotos de IA (teste)' };
  return { dir, session, cars };
}

function resolveRace(plan, champId) {
  const races = q.races(champId);
  if (opt.corrida) {
    const r = races.find(x => x.id === opt.corrida) || races.find(x => String(x.round) === String(opt.corrida));
    if (!r) throw new Error(`Corrida "${opt.corrida}" não existe nesta temporada.`);
    return r;
  }
  const found = matchRace(races, plan.session.track);
  if (found.length === 1) return found[0];
  throw new Error(found.length
    ? `Mais de uma corrida combina com "${plan.session.track}": use --corrida <rodada>.`
    : `Não achei corrida para a pista "${plan.session.track}": use --corrida <rodada>.`);
}

function runSession(plan, champId, race) {
  const map = readMap();
  const entries = q.entries(champId);
  const unmapped = [];
  const resolveCar = (pc) => {
    const k = `${pc.team}|${pc.number}`;
    const name = map[k] || (pc.gameName && pc.gameName !== 'Player' ? pc.gameName : null);
    const d = name ? driverByName(name, champId) : null;
    if (!d) { unmapped.push({ pc, k }); return null; }
    return { driverId: d.id, name: d.name, teamId: teamAtRound(entries, d.id, race.round) };
  };

  const kind = plan.session.kind;
  console.log(`\n▶ ${path.basename(plan.dir)}: ${plan.session.type} em ${plan.session.track} → ${race.flag || ''} ${race.name} (etapa ${race.round}) [${kind}]`);
  const { meta, traces } = importSession(plan.dir, { resolveCar, log: (m) => console.log(m) });
  meta.raceId = race.id;

  // Sugestão para carros sem mapa: pelo resultado já lançado da corrida
  if (unmapped.length) {
    const res = db.prepare('SELECT r.position, d.name FROM results r JOIN drivers d ON d.id = r.driver_id WHERE r.race_id = ? AND r.position IS NOT NULL').all(race.id);
    for (const { pc, k } of unmapped) {
      const c = meta.cars.find(x => x.idx === pc.idx);
      const sug = kind === 'race' && c && c.finalPos ? (res.find(r => r.position === c.finalPos) || {}).name : null;
      console.log(`  ⚠ carro sem piloto: "${k}" (${pc.gameName})${sug ? ` — sugestão pelo resultado (P${c.finalPos}): ${sug}` : ''}. Adicione em data/telemetria/mapa-pilotos.json`);
    }
  }

  // Conferência com o resultado lançado no site
  if (kind === 'race') {
    const res = new Map(db.prepare('SELECT driver_id, position FROM results WHERE race_id = ?').all(race.id).map(r => [r.driver_id, r.position]));
    let ok = 0; const bad = [];
    for (const c of meta.cars) {
      if (!c.driverId || !res.has(c.driverId)) continue;
      (res.get(c.driverId) === c.finalPos ? ok++ : bad.push(`${c.name}: jogo P${c.finalPos} × site P${res.get(c.driverId)}`));
    }
    console.log(`  conferência com o resultado do site: ${ok} batem${bad.length ? `, ${bad.length} diferem (${bad.join('; ')})` : ''}`);
  }

  if (opt.simular) { console.log('  (simulação: nada gravado)'); return; }

  // Arquivos
  const dir = path.join(TEL_DIR, race.id);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f === `${kind}.json` || new RegExp(`^${kind}-\\d+\\.json$`).test(f)) fs.unlinkSync(path.join(dir, f));
  fs.writeFileSync(path.join(dir, `${kind}.json`), JSON.stringify(meta));
  for (const [idx, t] of traces) fs.writeFileSync(path.join(dir, `${kind}-${idx}.json`), JSON.stringify(t));
  const idxFile = path.join(TEL_DIR, 'index.json');
  let index = {};
  try { index = JSON.parse(fs.readFileSync(idxFile, 'utf8')); } catch (_) { /* novo */ }
  (index[race.id] = index[race.id] || {})[kind] = {
    sessionUid: meta.sessionUid, importedAt: now(), startedAt: meta.startedAt, track: meta.track.name,
    cars: meta.cars.length, laps: meta.totalLaps, weather: meta.weather,
  };
  fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));
  const kb = Math.round(fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) / 1024);
  console.log(`  ✔ gravado em data/telemetria/${race.id}/ (${kb} KB no total para esta corrida)`);

  // Classificação (quali) no banco
  if (kind === 'quali') {
    const upsert = db.prepare(`INSERT INTO qualifying (id, championship_id, race_id, driver_id, team_id, position, best_lap_ms, source)
      VALUES (?,?,?,?,?,?,?,'telemetria')
      ON CONFLICT(race_id, driver_id) DO UPDATE SET position = excluded.position, best_lap_ms = excluded.best_lap_ms, team_id = excluded.team_id, source = 'telemetria'`);
    const cur = new Map(db.prepare('SELECT driver_id, source FROM qualifying WHERE race_id = ?').all(race.id).map(r => [r.driver_id, r.source]));
    let n = 0; let kept = 0;
    withTransaction(() => {
      for (const c of meta.cars) {
        if (!c.driverId || !c.finalPos) continue;
        if (cur.get(c.driverId) === 'manual' && !opt.forcar) { kept++; continue; }
        upsert.run(uuid(), champId, race.id, c.driverId, c.teamId, c.finalPos, c.bestLapMs || null);
        n++;
      }
    });
    console.log(`  ✔ classificação no banco: ${n} pilotos${kept ? ` (${kept} lançados à mão foram mantidos; use --forcar para trocar)` : ''}`);
  }
}

/* ---------- principal ---------- */
function main() {
  const champId = opt.temporada || getMeta('active_championship_id', '');
  if (!champId || !q.championship(champId)) throw new Error('Nenhuma temporada ativa. Use --temporada <id>.');

  let dirs;
  if (opt.todas) {
    const root = path.resolve(opt.todas);
    dirs = fs.readdirSync(root).sort().map(n => path.join(root, n)).filter(d => fs.statSync(d).isDirectory());
  } else dirs = opt._.map(d => path.resolve(d));

  const plans = [];
  for (const d of dirs) {
    const p = planSession(d);
    if (p.skip) { console.log(`– ${path.basename(d)}: ignorada (${p.skip})`); continue; }
    try { p.race = resolveRace(p, champId); plans.push(p); } catch (e) { console.log(`– ${path.basename(d)}: ignorada (${e.message})`); }
  }
  // Duas sessões para a mesma corrida/tipo (ex.: reinício): vale a mais longa e, no empate, a mais recente.
  const best = new Map();
  for (const p of plans) {
    const k = `${p.race.id}|${p.session.kind}`;
    const cur = best.get(k);
    if (!cur || p.session.durationS >= cur.session.durationS) { if (cur) console.log(`– ${path.basename(cur.dir)}: substituída por ${path.basename(p.dir)} (mesma corrida)`); best.set(k, p); }
    else console.log(`– ${path.basename(p.dir)}: ignorada (já há uma sessão mais longa para esta corrida)`);
  }
  if (!best.size) { console.log('Nada para importar.'); return; }
  if (!opt.simular) console.log(`Cópia de segurança do banco: ${path.basename(backup('antes-telemetria'))}`);
  for (const p of best.values()) runSession(p, champId, p.race);
  console.log(opt.simular ? '\nSimulação concluída.' : '\nPronto. Abra o site (npm start) para conferir e depois use "Publicar no site".');
}

try { main(); } catch (e) { console.error('Erro:', e.message); process.exit(1); }
