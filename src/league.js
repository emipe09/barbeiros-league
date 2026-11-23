'use strict';

/* Monta o "snapshot" público da liga: tudo que o site precisa para mostrar
   classificações, corridas, pilotos e histórico. É o mesmo JSON servido em
   /api/league (modo servidor) e gravado em dist/data/league.json (site estático). */

const fs = require('node:fs');
const path = require('node:path');
const { db, getMeta, isReserveTeamName, DATA_DIR } = require('./db');
const { computeChampionship } = require('./standings');
const { F1_CALENDAR } = require('./calendar');

const q = {
  teams: () => db.prepare('SELECT * FROM teams ORDER BY name').all(),
  drivers: () => db.prepare('SELECT * FROM drivers ORDER BY name').all(),
  championships: () => db.prepare('SELECT * FROM championships ORDER BY COALESCE(season, \'\'), created_at').all(),
  championship: (id) => db.prepare('SELECT * FROM championships WHERE id = ?').get(id),
  races: (cid) => db.prepare('SELECT * FROM races WHERE championship_id = ? ORDER BY round').all(cid),
  entries: (cid) => db.prepare('SELECT * FROM driver_entries WHERE championship_id = ? ORDER BY from_round').all(cid),
  results: (cid) => db.prepare('SELECT * FROM results WHERE championship_id = ?').all(cid),
  race: (id) => db.prepare('SELECT * FROM races WHERE id = ?').get(id),
  // O banco publicado pode ser anterior à tabela de classificação: não quebra o build.
  quali: (cid) => { try { return db.prepare('SELECT * FROM qualifying WHERE championship_id = ?').all(cid); } catch (_) { return []; } },
};

/** Índice das telemetrias importadas (data/telemetria/index.json, gerado por npm run telemetria). */
function telemetryIndex() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'telemetria', 'index.json'), 'utf8')); } catch (_) { return {}; }
}

const activeChampionshipId = () => getMeta('active_championship_id', '') || null;

function compute(champ, teams, drivers) {
  return computeChampionship({
    championship: champ, teams, drivers,
    races: q.races(champ.id), results: q.results(champ.id), entries: q.entries(champ.id),
  });
}

function championshipView(champ, teams, drivers) {
  const comp = compute(champ, teams, drivers);
  const done = new Set(comp.doneRaceIds);
  const entries = q.entries(champ.id);

  // Classificação (quali): por corrida e estatísticas por piloto na temporada.
  const dname = new Map(drivers.map(d => [d.id, d.name]));
  const qrows = q.quali(champ.id);
  const qByRace = {};
  const qualiStats = {};
  for (const r of qrows) {
    (qByRace[r.race_id] = qByRace[r.race_id] || []).push(r);
    const s = qualiStats[r.driver_id] = qualiStats[r.driver_id] || { count: 0, sum: 0, best: null, poles: 0, top3: 0, top5: 0, bestRaceIds: [], perRace: {} };
    s.count++; s.sum += r.position; s.perRace[r.race_id] = r.position;
    if (s.best == null || r.position < s.best) s.best = r.position;
    if (r.position === 1) s.poles++;
    if (r.position <= 3) s.top3++;
    if (r.position <= 5) s.top5++;
  }
  for (const s of Object.values(qualiStats)) s.bestRaceIds = Object.entries(s.perRace).filter(([, p]) => p === s.best).map(([id]) => id);
  return {
    id: champ.id,
    name: champ.name,
    season: champ.season,
    status: champ.status,
    createdAt: champ.created_at,
    finishedAt: champ.finished_at,
    winnerDriverId: champ.winner_driver_id,
    winnerTeamId: champ.winner_team_id,
    config: comp.cfg,
    races: comp.raceOrder.map(r => ({
      id: r.id, round: r.round, name: r.name, country: r.country, flag: r.flag, circuit: r.circuit,
      isSprint: !!r.is_sprint, done: done.has(r.id), results: comp.raceResults[r.id] || [],
      quali: (qByRace[r.id] || []).sort((a, b) => a.position - b.position).map(x => ({
        driverId: x.driver_id, teamId: x.team_id, name: dname.get(x.driver_id) || '?', pos: x.position, ms: x.best_lap_ms, source: x.source,
      })),
    })),
    entries: entries.map(e => ({ id: e.id, driverId: e.driver_id, teamId: e.team_id, fromRound: e.from_round, isReserve: !!e.is_reserve })),
    standings: comp.standings,
    constructors: comp.ctorStandings,
    qualiStats,
    doneCount: comp.doneRaceIds.length,
  };
}

/* ---------- Histórico entre temporadas ---------- */
const teamKey = (name) => String(name || '').trim().toLowerCase();

function buildHistory(champViews, teams, drivers) {
  const finished = champViews.filter(c => c.status === 'finished');
  const driverAgg = new Map();
  const teamAgg = new Map(); // agrupado pelo NOME (equipes recriadas com outro id contam juntas)
  const teamById = new Map(teams.map(t => [t.id, t]));

  const getDriver = (id, name) => {
    if (!driverAgg.has(id)) {
      driverAgg.set(id, { driverId: id, name, titles: 0, seasons: 0, points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, races: 0, dnfs: 0, bestFinish: null, bestChampPos: null, titleSeasons: [], qCount: 0, qSum: 0, bestQuali: null, bestQualiAt: [], qPoles: 0, qTop3: 0, qTop5: 0 });
    }
    return driverAgg.get(id);
  };
  const getTeam = (name, color) => {
    const k = teamKey(name);
    if (!teamAgg.has(k)) teamAgg.set(k, { key: k, name, color, titles: 0, seasons: 0, points: 0, wins: 0, podiums: 0, poles: 0, titleSeasons: [] });
    const a = teamAgg.get(k);
    if (color) a.color = color; // fica a cor mais recente
    return a;
  };

  const champions = [];
  for (const c of champViews) {
    const isDone = c.status === 'finished';
    for (const s of c.standings) {
      const a = getDriver(s.id, s.name);
      a.seasons++; a.points += s.points; a.wins += s.wins; a.podiums += s.podiums;
      a.poles += s.poles; a.fastestLaps += s.fastestLaps; a.races += s.races; a.dnfs += s.dnfs;
      if (s.bestFinish != null && (a.bestFinish == null || s.bestFinish < a.bestFinish)) a.bestFinish = s.bestFinish;
      if (isDone && (a.bestChampPos == null || s.position < a.bestChampPos)) a.bestChampPos = s.position;
      const qs = c.qualiStats && c.qualiStats[s.id];
      if (qs) {
        a.qCount += qs.count; a.qSum += qs.sum; a.qPoles += qs.poles; a.qTop3 += qs.top3; a.qTop5 += qs.top5;
        if (a.bestQuali == null || qs.best < a.bestQuali) { a.bestQuali = qs.best; a.bestQualiAt = []; }
        if (qs.best === a.bestQuali) a.bestQualiAt.push(...qs.bestRaceIds);
      }
    }
    for (const t of c.constructors) {
      if (isReserveTeamName(t.name)) continue;
      const a = getTeam(t.name, t.color);
      a.seasons++; a.points += t.points; a.wins += t.wins; a.podiums += t.podiums; a.poles += t.poles;
    }
    if (isDone) {
      const wd = c.standings.find(s => s.id === c.winnerDriverId) || c.standings[0];
      const wtRow = c.constructors.find(t => t.id === c.winnerTeamId) || c.constructors[0];
      if (wd) { const a = getDriver(wd.id, wd.name); a.titles++; a.titleSeasons.push(c.name); }
      if (wtRow) { const a = getTeam(wtRow.name, wtRow.color); a.titles++; a.titleSeasons.push(c.name); }
      champions.push({
        championshipId: c.id, name: c.name, season: c.season, finishedAt: c.finishedAt,
        races: c.races.length,
        driver: wd ? { id: wd.id, name: wd.name, points: wd.points, wins: wd.wins, teamName: wd.teamName, teamColor: wd.teamColor } : null,
        runnerUp: c.standings[1] ? { id: c.standings[1].id, name: c.standings[1].name, points: c.standings[1].points } : null,
        team: wtRow ? { name: wtRow.name, color: wtRow.color, points: wtRow.points } : null,
      });
    }
  }

  for (const d of driverAgg.values()) d.avgQuali = d.qCount ? d.qSum / d.qCount : null;
  const drivers_ = [...driverAgg.values()].filter(d => d.races > 0).sort((a, b) => b.titles - a.titles || b.points - a.points || a.name.localeCompare(b.name));
  const teams_ = [...teamAgg.values()].sort((a, b) => b.titles - a.titles || b.points - a.points || a.name.localeCompare(b.name));

  // Recordes individuais (todas as temporadas)
  const top = (key, label, unit) => {
    const best = [...driverAgg.values()].filter(d => d[key] > 0).sort((a, b) => b[key] - a[key])[0];
    return best ? { label, unit, value: best[key], driverId: best.driverId, name: best.name } : null;
  };
  const seasonBest = (() => {
    let best = null;
    for (const c of finished) {
      const s = c.standings[0];
      if (s && (!best || s.points > best.value)) best = { label: 'Mais pontos numa temporada', unit: 'pts', value: s.points, driverId: s.id, name: s.name, season: c.name };
    }
    return best;
  })();
  const records = [
    top('wins', 'Mais vitórias', 'vitórias'),
    top('podiums', 'Mais pódios', 'pódios'),
    top('poles', 'Mais poles', 'poles'),
    top('fastestLaps', 'Mais voltas rápidas', 'voltas rápidas'),
    top('races', 'Mais corridas disputadas', 'corridas'),
    seasonBest,
  ].filter(Boolean);

  return { champions: champions.reverse(), drivers: drivers_, teams: teams_, records };
}

function buildLeague() {
  const teams = q.teams();
  const drivers = q.drivers();
  const champs = q.championships();
  const views = champs.map(c => championshipView(c, teams, drivers));
  const activeId = activeChampionshipId();
  const defaultId = (views.find(v => v.id === activeId) || views[views.length - 1] || {}).id || null;
  return {
    generatedAt: new Date().toISOString(),
    league: { name: getMeta('league_name', 'Barbeiros League') },
    activeChampionshipId: activeId,
    defaultChampionshipId: defaultId,
    teams: teams.map(t => ({ id: t.id, name: t.name, color: t.color, active: !!t.active, isReserve: isReserveTeamName(t.name) })),
    drivers: drivers.map(d => ({ id: d.id, name: d.name, defaultTeamId: d.default_team_id, active: !!d.active })),
    championships: views,
    history: buildHistory(views, teams, drivers),
    telemetry: telemetryIndex(),
    calendar: F1_CALENDAR,
  };
}

module.exports = { buildLeague, compute, q, activeChampionshipId };
