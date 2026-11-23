'use strict';

/* Rotas de edição (exigem permissão de admin). Cada handler recebe
   { body, params } e devolve um objeto JSON ou lança HttpError. */

const { db, uuid, now, withTransaction, setMeta, isReserveTeamName } = require('../db');
const { q, compute, activeChampionshipId } = require('../league');
const { teamAtRound, NON_FINISH, DEFAULT_POINTS, DEFAULT_SPRINT, parsePoints } = require('../standings');
const { F1_CALENDAR } = require('../calendar');
const { backup, publish } = require('../maintenance');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = (what) => { throw new HttpError(404, `${what} não encontrado(a).`); };

const str = (v, max = 80) => String(v == null ? '' : v).trim().slice(0, max);
const isColor = (v) => /^#[0-9a-f]{6}$/i.test(String(v || ''));

function mustChamp(id) { return q.championship(id) || notFound('Campeonato'); }
function teamIsReserve(teamId) {
  const t = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId);
  return t && isReserveTeamName(t.name) ? 1 : 0;
}

function finalize(champId) {
  const champ = q.championship(champId);
  if (!champ) return;
  const comp = compute(champ, q.teams(), q.drivers());
  db.prepare("UPDATE championships SET status = 'finished', finished_at = ?, winner_driver_id = ?, winner_team_id = ? WHERE id = ?")
    .run(now(), comp.leader ? comp.leader.id : null, comp.ctorLeader ? comp.ctorLeader.id : null, champId);
}

/* ---------------- equipes ---------------- */
function createTeam({ body }) {
  const name = str(body.name) || bad('Informe o nome da equipe.');
  const color = isColor(body.color) ? body.color : '#e10600';
  const id = uuid();
  db.prepare('INSERT INTO teams (id, name, color, active, created_at) VALUES (?,?,?,1,?)').run(id, name, color, now());
  return { id, name, color };
}
function updateTeam({ body, params }) {
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(params.id) || notFound('Equipe');
  const name = body.name != null ? (str(body.name) || t.name) : t.name;
  const color = isColor(body.color) ? body.color : t.color;
  const active = body.active != null ? (body.active ? 1 : 0) : t.active;
  db.prepare('UPDATE teams SET name = ?, color = ?, active = ? WHERE id = ?').run(name, color, active, t.id);
  return { ok: true };
}
function deleteTeam({ params }) {
  db.prepare('UPDATE teams SET active = 0 WHERE id = ?').run(params.id);
  return { ok: true };
}

/* ---------------- pilotos ---------------- */
function createDriver({ body }) {
  const name = str(body.name) || bad('Informe o nome do piloto.');
  const teamId = body.teamId || null;
  const id = uuid();
  withTransaction(() => {
    db.prepare('INSERT INTO drivers (id, name, default_team_id, active, created_at) VALUES (?,?,?,1,?)').run(id, name, teamId, now());
    const champId = activeChampionshipId();
    if (champId && teamId && body.enroll !== false) {
      db.prepare('INSERT INTO driver_entries (id, championship_id, driver_id, team_id, from_round, is_reserve) VALUES (?,?,?,?,?,?)')
        .run(uuid(), champId, id, teamId, Math.max(1, Number(body.fromRound) || 1), teamIsReserve(teamId));
    }
  });
  return { id, name };
}
function updateDriver({ body, params }) {
  const d = db.prepare('SELECT * FROM drivers WHERE id = ?').get(params.id) || notFound('Piloto');
  const name = body.name != null ? (str(body.name) || d.name) : d.name;
  const teamId = body.teamId !== undefined ? (body.teamId || null) : d.default_team_id;
  const active = body.active != null ? (body.active ? 1 : 0) : d.active;
  db.prepare('UPDATE drivers SET name = ?, default_team_id = ?, active = ? WHERE id = ?').run(name, teamId, active, d.id);
  return { ok: true };
}
function deleteDriver({ params }) {
  db.prepare('UPDATE drivers SET active = 0 WHERE id = ?').run(params.id);
  return { ok: true };
}

/* ---------------- campeonatos ---------------- */
function createChampionship({ body }) {
  const name = str(body.name) || 'Nova temporada';
  const season = str(body.season, 20) || String(new Date().getFullYear());
  const raw = Array.isArray(body.races) ? body.races : [];
  if (!raw.length) bad('Escolha pelo menos uma pista para o calendário.');

  const byId = new Map(F1_CALENDAR.map(t => [t.id, t]));
  const seen = new Set();
  const selected = raw.map(item => {
    const trackId = typeof item === 'string' ? item : (item && (item.trackId || item.id));
    const track = byId.get(trackId) || bad('Pista inválida: ' + String(trackId || ''));
    if (seen.has(trackId)) bad('Pista repetida no calendário: ' + track.name);
    seen.add(trackId);
    const sprint = item && typeof item === 'object' && item.isSprint != null ? !!item.isSprint : !!track.sprint;
    return { track, sprint };
  });

  const prev = activeChampionshipId();
  const points = Array.isArray(body.points) && body.points.length ? body.points.map(Number) : DEFAULT_POINTS;
  const sprintPoints = Array.isArray(body.sprintPoints) && body.sprintPoints.length ? body.sprintPoints.map(Number) : DEFAULT_SPRINT;
  const flPoint = body.fastestLapPoint != null ? Number(body.fastestLapPoint) : 1;
  const flTop10 = body.fastestLapTop10 != null ? (body.fastestLapTop10 ? 1 : 0) : 1;

  backup('antes-nova-temporada');
  const id = uuid();
  withTransaction(() => {
    if (prev && body.finishPrevious !== false) finalize(prev);
    db.prepare(`INSERT INTO championships (id, name, season, status, points, sprint_points, fastest_lap_point, fastest_lap_top10, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, name, season, 'active', JSON.stringify(points), JSON.stringify(sprintPoints), flPoint, flTop10, now());
    setMeta('active_championship_id', id);
    const insRace = db.prepare('INSERT INTO races (id, championship_id, round, name, country, flag, circuit, is_sprint) VALUES (?,?,?,?,?,?,?,?)');
    selected.forEach((r, i) => insRace.run(uuid(), id, i + 1, r.track.name, r.track.country, r.track.flag, r.track.circuit, r.sprint ? 1 : 0));

    // Inscrições: lista enviada pelo formulário ou, por padrão, pilotos ativos na equipe padrão.
    const insEntry = db.prepare('INSERT INTO driver_entries (id, championship_id, driver_id, team_id, from_round, is_reserve) VALUES (?,?,?,?,1,?)');
    const lineup = Array.isArray(body.lineup) ? body.lineup
      : q.drivers().filter(d => d.active && d.default_team_id).map(d => ({ driverId: d.id, teamId: d.default_team_id }));
    for (const l of lineup) {
      if (!l || !l.driverId || !l.teamId) continue;
      insEntry.run(uuid(), id, l.driverId, l.teamId, teamIsReserve(l.teamId));
    }
  });
  return { id };
}
function updateChampionship({ body, params }) {
  const c = mustChamp(params.id);
  const name = body.name != null ? (str(body.name) || c.name) : c.name;
  const season = body.season != null ? str(body.season, 20) : c.season;
  db.prepare('UPDATE championships SET name = ?, season = ? WHERE id = ?').run(name, season, c.id);
  return { ok: true };
}
function activateChampionship({ params }) {
  const c = mustChamp(params.id);
  setMeta('active_championship_id', c.id);
  db.prepare("UPDATE championships SET status = 'active', finished_at = NULL WHERE id = ?").run(c.id);
  return { ok: true };
}
function finishChampionship({ params }) {
  mustChamp(params.id);
  backup('antes-finalizar');
  finalize(params.id);
  if (activeChampionshipId() === params.id) setMeta('active_championship_id', '');
  return { ok: true };
}
function deleteChampionship({ params }) {
  mustChamp(params.id);
  backup('antes-excluir-temporada');
  withTransaction(() => {
    if (activeChampionshipId() === params.id) setMeta('active_championship_id', '');
    db.prepare('DELETE FROM championships WHERE id = ?').run(params.id);
  });
  return { ok: true };
}
function updateSettings({ body, params }) {
  const c = mustChamp(params.id);
  const cur = parsePoints(c);
  const nums = (a, fb) => Array.isArray(a) ? a.map(n => Math.max(0, Number(n) || 0)) : fb;
  const points = nums(body.points, cur.points);
  const sprint = nums(body.sprintPoints, cur.sprintPoints);
  const fl = body.fastestLapPoint != null ? Math.max(0, Number(body.fastestLapPoint) || 0) : cur.fastestLapPoint;
  const top10 = body.fastestLapTop10 != null ? (body.fastestLapTop10 ? 1 : 0) : (cur.fastestLapTop10 ? 1 : 0);
  db.prepare('UPDATE championships SET points = ?, sprint_points = ?, fastest_lap_point = ?, fastest_lap_top10 = ? WHERE id = ?')
    .run(JSON.stringify(points), JSON.stringify(sprint), fl, top10, c.id);
  return { ok: true };
}

/* ---------------- corridas ---------------- */
function createRace({ body, params }) {
  mustChamp(params.id);
  let { name, country, flag, circuit } = body;
  if (body.trackId) {
    const t = F1_CALENDAR.find(x => x.id === body.trackId) || bad('Pista inválida.');
    ({ name, country, flag, circuit } = t);
  }
  name = str(name); country = str(country);
  if (!name || !country) bad('Informe o nome e o país da corrida.');
  const round = db.prepare('SELECT COALESCE(MAX(round), 0) + 1 AS r FROM races WHERE championship_id = ?').get(params.id).r;
  const id = uuid();
  db.prepare('INSERT INTO races (id, championship_id, round, name, country, flag, circuit, is_sprint) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, params.id, round, name, country, str(flag, 16) || '🏁', str(circuit), body.isSprint ? 1 : 0);
  return { id, round };
}
function updateRace({ body, params }) {
  const r = q.race(params.raceId) || notFound('Corrida');
  db.prepare('UPDATE races SET name = ?, country = ?, flag = ?, circuit = ?, is_sprint = ? WHERE id = ?').run(
    body.name != null ? (str(body.name) || r.name) : r.name,
    body.country != null ? (str(body.country) || r.country) : r.country,
    body.flag != null ? str(body.flag, 16) : r.flag,
    body.circuit != null ? str(body.circuit) : r.circuit,
    body.isSprint != null ? (body.isSprint ? 1 : 0) : r.is_sprint,
    r.id);
  return { ok: true };
}
function deleteRace({ params }) {
  const r = q.race(params.raceId) || notFound('Corrida');
  withTransaction(() => {
    db.prepare('DELETE FROM results WHERE race_id = ?').run(r.id);
    db.prepare('DELETE FROM races WHERE id = ?').run(r.id);
    const upd = db.prepare('UPDATE races SET round = ? WHERE id = ?');
    q.races(params.id).forEach((rr, i) => upd.run(i + 1, rr.id));
  });
  return { ok: true };
}
function moveRace({ body, params }) {
  const races = q.races(params.id);
  const idx = races.findIndex(r => r.id === params.raceId);
  const swap = idx + (Number(body.dir) > 0 ? 1 : -1);
  if (idx < 0 || swap < 0 || swap >= races.length) bad('Não dá para mover a corrida nessa direção.');
  const upd = db.prepare('UPDATE races SET round = ? WHERE id = ?');
  withTransaction(() => { upd.run(races[swap].round, races[idx].id); upd.run(races[idx].round, races[swap].id); });
  return { ok: true };
}

/* ---------------- resultados ---------------- */
function saveResults({ body, params }) {
  mustChamp(params.id);
  const race = q.race(params.raceId) || notFound('Corrida');
  const map = body.results && typeof body.results === 'object' ? body.results : {};
  const entries = q.entries(params.id);

  // Validação: posições e sprint sem repetição; uma pole e uma volta rápida no máximo.
  const used = new Set(); const usedSprint = new Set(); let poles = 0; let fls = 0;
  for (const [, o] of Object.entries(map)) {
    if (typeof o.position === 'number') { if (used.has(o.position)) bad(`A posição P${o.position} foi usada duas vezes.`); used.add(o.position); }
    if (typeof o.sprintPosition === 'number') { if (usedSprint.has(o.sprintPosition)) bad(`A posição S${o.sprintPosition} da sprint foi usada duas vezes.`); usedSprint.add(o.sprintPosition); }
    if (o.pole) poles++;
    if (o.fastestLap) fls++;
  }
  if (poles > 1) bad('Marque a pole para apenas um piloto.');
  if (fls > 1) bad('Marque a volta mais rápida para apenas um piloto.');

  withTransaction(() => {
    db.prepare('DELETE FROM results WHERE championship_id = ? AND race_id = ?').run(params.id, race.id);
    const ins = db.prepare(`INSERT INTO results (id, championship_id, race_id, driver_id, team_id, position, status, sprint_position, fastest_lap, pole)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const [driverId, o] of Object.entries(map)) {
      let pos = null; let status = null;
      if (typeof o.position === 'number' && o.position > 0) { pos = Math.floor(o.position); status = 'finished'; }
      else if (NON_FINISH.includes(o.position)) status = o.position;
      const sp = typeof o.sprintPosition === 'number' && o.sprintPosition > 0 ? Math.floor(o.sprintPosition) : null;
      const fl = o.fastestLap ? 1 : 0; const pole = o.pole ? 1 : 0;
      if (pos === null && status === null && sp === null && !fl && !pole) continue;
      const teamId = teamAtRound(entries, driverId, race.round);
      if (!teamId) continue;
      ins.run(uuid(), params.id, race.id, driverId, teamId, pos, status || 'finished', sp, fl, pole);
    }
  });
  return { ok: true };
}
function clearResults({ params }) {
  db.prepare('DELETE FROM results WHERE championship_id = ? AND race_id = ?').run(params.id, params.raceId);
  return { ok: true };
}

/* ---------------- classificação (quali) ---------------- */
/** Salva a classificação de uma corrida. Mantém a origem "telemetria" das linhas que não mudaram. */
function saveQuali({ body, params }) {
  mustChamp(params.id);
  const race = q.race(params.raceId) || notFound('Corrida');
  const map = body.entries && typeof body.entries === 'object' ? body.entries : {};
  const entries = q.entries(params.id);

  const used = new Set();
  for (const o of Object.values(map)) {
    if (o == null || o.position == null || o.position === '') continue;
    const p = Number(o.position);
    if (!Number.isInteger(p) || p < 1 || p > 99) bad('Posição inválida na classificação.');
    if (used.has(p)) bad(`A posição P${p} foi usada duas vezes.`);
    used.add(p);
  }
  const old = new Map(db.prepare('SELECT * FROM qualifying WHERE race_id = ?').all(race.id).map(r => [r.driver_id, r]));
  withTransaction(() => {
    db.prepare('DELETE FROM qualifying WHERE race_id = ?').run(race.id);
    const ins = db.prepare(`INSERT INTO qualifying (id, championship_id, race_id, driver_id, team_id, position, best_lap_ms, source)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const [driverId, o] of Object.entries(map)) {
      if (o == null || o.position == null || o.position === '') continue;
      if (!db.prepare('SELECT 1 FROM drivers WHERE id = ?').get(driverId)) continue;
      const pos = Number(o.position);
      const ms = o.bestLapMs != null && o.bestLapMs !== '' && Number(o.bestLapMs) > 0 ? Math.round(Number(o.bestLapMs)) : null;
      const prev = old.get(driverId);
      const same = prev && prev.position === pos && (prev.best_lap_ms || null) === ms;
      ins.run(uuid(), params.id, race.id, driverId, teamAtRound(entries, driverId, race.round),
        pos, ms, same ? prev.source : 'manual');
    }
  });
  return { ok: true };
}
function clearQuali({ params }) {
  db.prepare('DELETE FROM qualifying WHERE championship_id = ? AND race_id = ?').run(params.id, params.raceId);
  return { ok: true };
}

/* ---------------- inscrições / transferências ---------------- */
function transfer({ body, params }) {
  mustChamp(params.id);
  const { driverId, teamId } = body;
  if (!driverId || !teamId) bad('Escolha o piloto e a equipe.');
  const round = Math.max(1, Number(body.fromRound) || 1);
  const isReserve = teamIsReserve(teamId);
  withTransaction(() => {
    const ex = db.prepare('SELECT id FROM driver_entries WHERE championship_id = ? AND driver_id = ? AND from_round = ?').get(params.id, driverId, round);
    if (ex) db.prepare('UPDATE driver_entries SET team_id = ?, is_reserve = ? WHERE id = ?').run(teamId, isReserve, ex.id);
    else db.prepare('INSERT INTO driver_entries (id, championship_id, driver_id, team_id, from_round, is_reserve) VALUES (?,?,?,?,?,?)')
      .run(uuid(), params.id, driverId, teamId, round, isReserve);
    retagResults(params.id, driverId);
  });
  return { ok: true };
}
/** Recalcula a equipe gravada em cada resultado do piloto conforme as inscrições. */
function retagResults(champId, driverId) {
  const entries = q.entries(champId);
  const upd = db.prepare('UPDATE results SET team_id = ? WHERE championship_id = ? AND driver_id = ? AND race_id = ?');
  for (const r of q.races(champId)) {
    const t = teamAtRound(entries, driverId, r.round);
    if (t) upd.run(t, champId, driverId, r.id);
  }
}
function removeEntry({ params }) {
  const e = db.prepare('SELECT * FROM driver_entries WHERE id = ? AND championship_id = ?').get(params.entryId, params.id) || notFound('Inscrição');
  withTransaction(() => {
    db.prepare('DELETE FROM driver_entries WHERE id = ?').run(e.id);
    retagResults(params.id, e.driver_id);
  });
  return { ok: true };
}

/* ---------------- liga, backup e publicação ---------------- */
function updateLeague({ body }) {
  if (body.name != null) setMeta('league_name', str(body.name) || 'Barbeiros League');
  return { ok: true };
}
function exportData() {
  const all = (t) => db.prepare(`SELECT * FROM ${t}`).all();
  return {
    version: 2, exportedAt: now(),
    meta: all('meta'), teams: all('teams'), drivers: all('drivers'), championships: all('championships'),
    races: all('races'), driver_entries: all('driver_entries'), results: all('results'),
    qualifying: all('qualifying'),
  };
}
function importData({ body }) {
  const d = body || {};
  if (!Array.isArray(d.teams) || !Array.isArray(d.drivers) || !Array.isArray(d.championships)) bad('Arquivo de backup inválido.');
  const arr = (v) => Array.isArray(v) ? v : [];
  backup('antes-restaurar');
  withTransaction(() => {
    db.exec('DELETE FROM qualifying; DELETE FROM results; DELETE FROM driver_entries; DELETE FROM races; DELETE FROM championships; DELETE FROM drivers; DELETE FROM teams; DELETE FROM meta;');
    const ins = (sql, rows, fn) => { const st = db.prepare(sql); rows.forEach(r => st.run(...fn(r))); };
    ins('INSERT INTO teams (id, name, color, active, created_at) VALUES (?,?,?,?,?)', arr(d.teams), r => [r.id, r.name, r.color, r.active, r.created_at || now()]);
    ins('INSERT INTO drivers (id, name, default_team_id, active, created_at) VALUES (?,?,?,?,?)', arr(d.drivers), r => [r.id, r.name, r.default_team_id, r.active, r.created_at || now()]);
    ins(`INSERT INTO championships (id, name, season, status, points, sprint_points, fastest_lap_point, fastest_lap_top10, winner_driver_id, winner_team_id, created_at, finished_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, arr(d.championships), r => [r.id, r.name, r.season, r.status, r.points, r.sprint_points, r.fastest_lap_point, r.fastest_lap_top10, r.winner_driver_id, r.winner_team_id, r.created_at || now(), r.finished_at]);
    ins('INSERT INTO races (id, championship_id, round, name, country, flag, circuit, is_sprint) VALUES (?,?,?,?,?,?,?,?)', arr(d.races), r => [r.id, r.championship_id, r.round, r.name, r.country, r.flag, r.circuit, r.is_sprint]);
    ins('INSERT INTO driver_entries (id, championship_id, driver_id, team_id, from_round, is_reserve) VALUES (?,?,?,?,?,?)', arr(d.driver_entries), r => [r.id, r.championship_id, r.driver_id, r.team_id, r.from_round, r.is_reserve ? 1 : 0]);
    ins(`INSERT INTO results (id, championship_id, race_id, driver_id, team_id, position, status, sprint_position, fastest_lap, pole)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, arr(d.results), r => [r.id, r.championship_id, r.race_id, r.driver_id, r.team_id, r.position, r.status, r.sprint_position, r.fastest_lap, r.pole]);
    ins(`INSERT INTO qualifying (id, championship_id, race_id, driver_id, team_id, position, best_lap_ms, source)
      VALUES (?,?,?,?,?,?,?,?)`, arr(d.qualifying), r => [r.id, r.championship_id, r.race_id, r.driver_id, r.team_id, r.position, r.best_lap_ms, r.source || 'manual']);
    ins('INSERT INTO meta (key, value) VALUES (?,?)', arr(d.meta), r => [r.key, r.value]);
  });
  return { ok: true };
}
function makeBackup() { return { ok: true, file: require('node:path').basename(backup('manual')) }; }
function doPublish({ body }) {
  backup('antes-publicar');
  return { ok: true, ...publish(body && body.message) };
}

const ROUTES = [
  ['PUT', /^\/api\/admin\/league$/, updateLeague],
  ['GET', /^\/api\/admin\/export$/, exportData],
  ['POST', /^\/api\/admin\/import$/, importData],
  ['POST', /^\/api\/admin\/backup$/, makeBackup],
  ['POST', /^\/api\/admin\/publish$/, doPublish],

  ['POST', /^\/api\/admin\/teams$/, createTeam],
  ['PUT', /^\/api\/admin\/teams\/(?<id>[^/]+)$/, updateTeam],
  ['DELETE', /^\/api\/admin\/teams\/(?<id>[^/]+)$/, deleteTeam],

  ['POST', /^\/api\/admin\/drivers$/, createDriver],
  ['PUT', /^\/api\/admin\/drivers\/(?<id>[^/]+)$/, updateDriver],
  ['DELETE', /^\/api\/admin\/drivers\/(?<id>[^/]+)$/, deleteDriver],

  ['POST', /^\/api\/admin\/championships$/, createChampionship],
  ['PUT', /^\/api\/admin\/championships\/(?<id>[^/]+)$/, updateChampionship],
  ['DELETE', /^\/api\/admin\/championships\/(?<id>[^/]+)$/, deleteChampionship],
  ['POST', /^\/api\/admin\/championships\/(?<id>[^/]+)\/activate$/, activateChampionship],
  ['POST', /^\/api\/admin\/championships\/(?<id>[^/]+)\/finish$/, finishChampionship],
  ['PUT', /^\/api\/admin\/championships\/(?<id>[^/]+)\/settings$/, updateSettings],

  ['POST', /^\/api\/admin\/championships\/(?<id>[^/]+)\/races$/, createRace],
  ['PUT', /^\/api\/admin\/championships\/(?<id>[^/]+)\/races\/(?<raceId>[^/]+)$/, updateRace],
  ['DELETE', /^\/api\/admin\/championships\/(?<id>[^/]+)\/races\/(?<raceId>[^/]+)$/, deleteRace],
  ['POST', /^\/api\/admin\/championships\/(?<id>[^/]+)\/races\/(?<raceId>[^/]+)\/move$/, moveRace],

  ['PUT', /^\/api\/admin\/championships\/(?<id>[^/]+)\/results\/(?<raceId>[^/]+)$/, saveResults],
  ['DELETE', /^\/api\/admin\/championships\/(?<id>[^/]+)\/results\/(?<raceId>[^/]+)$/, clearResults],

  ['PUT', /^\/api\/admin\/championships\/(?<id>[^/]+)\/qualifying\/(?<raceId>[^/]+)$/, saveQuali],
  ['DELETE', /^\/api\/admin\/championships\/(?<id>[^/]+)\/qualifying\/(?<raceId>[^/]+)$/, clearQuali],

  ['POST', /^\/api\/admin\/championships\/(?<id>[^/]+)\/transfer$/, transfer],
  ['DELETE', /^\/api\/admin\/championships\/(?<id>[^/]+)\/entries\/(?<entryId>[^/]+)$/, removeEntry],
];

module.exports = { ROUTES, HttpError };
