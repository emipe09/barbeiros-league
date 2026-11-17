'use strict';

/* Cálculo puro da classificação de um campeonato (sem acesso ao banco). */

const DEFAULT_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const DEFAULT_SPRINT = [8, 7, 6, 5, 4, 3, 2, 1];
const NON_FINISH = ['DNF', 'DNS', 'DSQ'];

function parsePoints(champ) {
  const safe = (v, def) => {
    try { const a = JSON.parse(v); return Array.isArray(a) && a.length ? a.map(Number) : def; } catch (_) { return def; }
  };
  return {
    points: safe(champ && champ.points, DEFAULT_POINTS),
    sprintPoints: safe(champ && champ.sprint_points, DEFAULT_SPRINT),
    fastestLapPoint: Number(champ && champ.fastest_lap_point != null ? champ.fastest_lap_point : 1),
    fastestLapTop10: !!(champ && (champ.fastest_lap_top10 == null ? 1 : champ.fastest_lap_top10)),
  };
}

/** Inscrição válida do piloto numa etapa (considera transferências). */
function entryAtRound(entries, driverId, round) {
  let best = null;
  for (const e of entries) {
    if (e.driver_id === driverId && e.from_round <= round && (!best || e.from_round > best.from_round)) best = e;
  }
  return best;
}
const teamAtRound = (entries, driverId, round) => (entryAtRound(entries, driverId, round) || {}).team_id || null;

function latestEntry(entries, driverId) {
  let best = null;
  for (const e of entries) {
    if (e.driver_id === driverId && (!best || e.from_round > best.from_round)) best = e;
  }
  return best;
}
const currentTeam = (entries, driverId) => (latestEntry(entries, driverId) || {}).team_id || null;

function pointsForResult(cfg, pos, sprintPos, fastestLap) {
  let pts = 0;
  if (typeof pos === 'number') pts += cfg.points[pos - 1] || 0;
  if (fastestLap && cfg.fastestLapPoint > 0) {
    const inTop10 = typeof pos === 'number' && pos <= 10;
    if (!cfg.fastestLapTop10 || inTop10) pts += cfg.fastestLapPoint;
  }
  if (typeof sprintPos === 'number') pts += cfg.sprintPoints[sprintPos - 1] || 0;
  return pts;
}

function cmpDrivers(a, b) {
  return (b.points - a.points) || (b.wins - a.wins) || (b.podiums - a.podiums) || (b.poles - a.poles)
    || (b.fastestLaps - a.fastestLaps)
    || ((a.bestFinish ?? Infinity) - (b.bestFinish ?? Infinity))
    || (a.name || '').localeCompare(b.name || '');
}
function cmpConstructors(a, b) {
  return (b.points - a.points) || (b.wins - a.wins) || (b.podiums - a.podiums) || (b.poles - a.poles)
    || (a.name || '').localeCompare(b.name || '');
}

/**
 * @param {{championship, drivers, teams, races, results, entries}} p
 */
function computeChampionship(p) {
  const cfg = parsePoints(p.championship);
  const teams = p.teams || [];
  const races = [...(p.races || [])].sort((a, b) => a.round - b.round);
  const results = p.results || [];
  const entries = p.entries || [];

  const participantIds = new Set([...entries.map(e => e.driver_id), ...results.map(r => r.driver_id)]);
  const drivers = (p.drivers || []).filter(d => participantIds.has(d.id));
  const teamById = new Map(teams.map(t => [t.id, t]));

  const resultIndex = new Map(results.map(r => [r.race_id + '|' + r.driver_id, r]));
  const doneIds = new Set(results.filter(r => typeof r.position === 'number').map(r => r.race_id));

  const stats = new Map();
  for (const d of drivers) {
    const le = latestEntry(entries, d.id);
    stats.set(d.id, {
      points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, dnfs: 0, finishes: 0, races: 0,
      bestFinish: null, sumPos: 0, perRace: {}, cumByRace: {},
      teamId: le ? le.team_id : null, isReserve: !!(le && le.is_reserve),
    });
  }
  const ctor = new Map(teams.map(t => [t.id, { points: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, dnfs: 0, races: 0, perRace: {}, cumByRace: {} }]));
  const usedTeamIds = new Set();
  const raceResults = {}; // raceId -> classificação da etapa

  for (const race of races) {
    const rows = [];
    for (const d of drivers) {
      const s = stats.get(d.id);
      const r = resultIndex.get(race.id + '|' + d.id);
      const pos = r && typeof r.position === 'number' ? r.position : null;
      const status = r ? (NON_FINISH.includes(r.status) ? r.status : (pos != null ? 'finished' : null)) : null;
      const sprintPos = r && typeof r.sprint_position === 'number' ? r.sprint_position : null;
      const fl = !!(r && r.fastest_lap);
      const pole = !!(r && r.pole);
      const pts = r ? pointsForResult(cfg, pos, sprintPos, fl) : 0;

      if (r) s.races++;
      if (pos != null) {
        s.finishes++; s.sumPos += pos;
        if (pos === 1) s.wins++;
        if (pos <= 3) s.podiums++;
        if (s.bestFinish === null || pos < s.bestFinish) s.bestFinish = pos;
      } else if (status === 'DNF') s.dnfs++;
      if (pole) s.poles++;
      if (fl) s.fastestLaps++;
      s.points += pts;
      if (doneIds.has(race.id)) s.cumByRace[race.id] = s.points;

      const entry = entryAtRound(entries, d.id, race.round);
      const isReserve = !!(entry && entry.is_reserve);
      if (r) {
        s.perRace[race.id] = { pos, status, sprintPos, pole, fl, pts };
        rows.push({
          driverId: d.id, name: d.name, teamId: r.team_id, isReserve,
          pos, status, sprintPos, pole, fl, pts,
        });
      }
      if (r && r.team_id && !isReserve) {
        usedTeamIds.add(r.team_id);
        const c = ctor.get(r.team_id);
        if (c) {
          c.races++; c.points += pts;
          c.perRace[race.id] = (c.perRace[race.id] || 0) + pts;
          if (pos === 1) c.wins++;
          if (pos != null && pos <= 3) c.podiums++;
          if (pole) c.poles++;
          if (fl) c.fastestLaps++;
          if (status === 'DNF') c.dnfs++;
        }
      }
    }
    for (const [, c] of ctor) if (doneIds.has(race.id)) c.cumByRace[race.id] = c.points;

    rows.sort((a, b) => {
      const ka = a.pos != null ? a.pos : (a.status === 'DNF' ? 900 : a.status === 'DSQ' ? 950 : 990);
      const kb = b.pos != null ? b.pos : (b.status === 'DNF' ? 900 : b.status === 'DSQ' ? 950 : 990);
      return ka - kb || a.name.localeCompare(b.name);
    });
    raceResults[race.id] = rows;
  }

  const standings = drivers.map(d => {
    const s = stats.get(d.id);
    const team = teamById.get(s.teamId);
    return {
      id: d.id, name: d.name, teamId: s.teamId,
      teamName: team ? team.name : null, teamColor: team ? team.color : '#888888',
      isReserve: s.isReserve,
      points: s.points, wins: s.wins, podiums: s.podiums, poles: s.poles, fastestLaps: s.fastestLaps,
      dnfs: s.dnfs, finishes: s.finishes, races: s.races, bestFinish: s.bestFinish,
      avgFinish: s.finishes ? +(s.sumPos / s.finishes).toFixed(1) : null,
      perRace: s.perRace, cumByRace: s.cumByRace,
    };
  }).sort(cmpDrivers);
  standings.forEach((s, i) => { s.position = i + 1; });

  entries.forEach(e => { if (!e.is_reserve) usedTeamIds.add(e.team_id); });
  const ctorStandings = teams.filter(t => usedTeamIds.has(t.id)).map(t => {
    const a = ctor.get(t.id);
    const lineup = [...new Set(entries.filter(e => e.team_id === t.id && !e.is_reserve).map(e => e.driver_id))];
    return { id: t.id, name: t.name, color: t.color, lineup, ...a };
  }).sort(cmpConstructors);
  ctorStandings.forEach((c, i) => { c.position = i + 1; });

  return {
    cfg,
    raceOrder: races,
    doneRaceIds: races.filter(r => doneIds.has(r.id)).map(r => r.id),
    raceResults,
    standings,
    ctorStandings,
    leader: standings[0] || null,
    ctorLeader: ctorStandings[0] || null,
  };
}

module.exports = {
  computeChampionship, entryAtRound, teamAtRound, currentTeam, latestEntry, pointsForResult, parsePoints,
  NON_FINISH, DEFAULT_POINTS, DEFAULT_SPRINT,
};
