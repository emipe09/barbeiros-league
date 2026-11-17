'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { computeChampionship, pointsForResult, parsePoints } = require('../src/standings');

const cfg = parsePoints({});

test('pontuação padrão, sprint e volta rápida', () => {
  assert.strictEqual(pointsForResult(cfg, 1, null, false), 25);
  assert.strictEqual(pointsForResult(cfg, 10, null, true), 2);   // P10 + VR
  assert.strictEqual(pointsForResult(cfg, 11, null, true), 0);   // VR fora do top 10 não pontua
  assert.strictEqual(pointsForResult(cfg, 2, 1, false), 26);     // corrida + sprint
});

test('transferência no meio da temporada divide pontos entre equipes', () => {
  const teams = [{ id: 'a', name: 'A', color: '#f00' }, { id: 'b', name: 'B', color: '#00f' }];
  const drivers = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
  const races = [{ id: 'r1', round: 1 }, { id: 'r2', round: 2 }];
  const entries = [
    { driver_id: 'x', team_id: 'a', from_round: 1 }, { driver_id: 'x', team_id: 'b', from_round: 2 },
    { driver_id: 'y', team_id: 'b', from_round: 1 },
  ];
  const results = [
    { race_id: 'r1', driver_id: 'x', team_id: 'a', position: 1 }, { race_id: 'r1', driver_id: 'y', team_id: 'b', position: 2 },
    { race_id: 'r2', driver_id: 'x', team_id: 'b', position: 1 }, { race_id: 'r2', driver_id: 'y', team_id: 'b', position: 2 },
  ];
  const c = computeChampionship({ championship: {}, teams, drivers, races, results, entries });
  assert.strictEqual(c.standings[0].id, 'x');
  assert.strictEqual(c.standings[0].points, 50);
  const byId = Object.fromEntries(c.ctorStandings.map(t => [t.id, t.points]));
  assert.deepStrictEqual(byId, { a: 25, b: 61 });
});

test('reservas pontuam para pilotos mas não para construtores', () => {
  const teams = [{ id: 'r', name: 'Reserva', color: '#999' }, { id: 'a', name: 'A', color: '#f00' }];
  const drivers = [{ id: 'x', name: 'X' }];
  const entries = [{ driver_id: 'x', team_id: 'r', from_round: 1, is_reserve: 1 }];
  const results = [{ race_id: 'r1', driver_id: 'x', team_id: 'r', position: 1 }];
  const c = computeChampionship({ championship: {}, teams, drivers, races: [{ id: 'r1', round: 1 }], results, entries });
  assert.strictEqual(c.standings[0].points, 25);
  assert.strictEqual(c.ctorStandings.length, 0);
});

test('banco real: campeões conferem com a planilha', () => {
  process.env.F1_READONLY = '1';
  const { buildLeague } = require('../src/league');
  const L = buildLeague();
  const l1 = L.championships.find(c => c.id === 'temporada-2026');
  assert.strictEqual(l1.standings[0].name, 'Gabriel Silva');
  assert.strictEqual(l1.standings[0].points, 178);
  assert.strictEqual(l1.constructors[0].name, 'Red Bull');
  assert.strictEqual(l1.constructors[0].points, 323);
});
