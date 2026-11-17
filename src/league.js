'use strict';

/* Monta o "snapshot" público da liga: tudo que o site precisa para mostrar
   classificações, corridas, pilotos e histórico. É o mesmo JSON servido em
   /api/league (modo servidor) e gravado em dist/data/league.json (site estático). */

const { db, getMeta, isReserveTeamName } = require('./db');
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
};

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
    })),
    entries: entries.map(e => ({ id: e.id, driverId: e.driver_id, teamId: e.team_id, fromRound: e.from_round, isReserve: !!e.is_reserve })),
    standings: comp.standings,
    constructors: comp.ctorStandings,
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
      driverAgg.set(id, { driverId: id, name, titles: 0, seasons: 0, points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, races: 0, dnfs: 0, bestFinish: null, bestChampPos: null, titleSeasons: [] });
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
    calendar: F1_CALENDAR,
  };
}

module.exports = { buildLeague, compute, q, activeChampionshipId };
