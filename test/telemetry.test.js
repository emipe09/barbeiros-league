'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { splitCsvLine, readCsv, resampleByDistance, kindOf } = require('../src/telemetry');

test('splitCsvLine entende campos entre aspas com vírgula e aspas duplas', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('1,"[{""x"": 1, ""y"": 2}]",3'), ['1', '[{"x": 1, "y": 2}]', '3']);
});

test('readCsv ignora bytes NUL e junta campos com quebra de linha entre aspas', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tel-')), 'x.csv');
  fs.writeFileSync(f, 'a,b\n1,\0two\n3,"quatro\ncinco"\n');
  const rows = [];
  const H = readCsv(f, (c) => rows.push(c));
  assert.deepEqual(Object.keys(H), ['a', 'b']);
  assert.deepEqual(rows, [['1', 'two'], ['3', 'quatro\ncinco']]);
  assert.equal(readCsv(f + '.nao-existe', () => {}), null);
});

test('resampleByDistance interpola e devolve N pontos de 0 ao comprimento da pista', () => {
  const dist = [0, 50, 100]; const v = [0, 100, 200];
  const { out, coverage } = resampleByDistance(dist, [v], 5, 100);
  assert.deepEqual(out[0].map(Math.round), [0, 50, 100, 150, 200]);
  assert.equal(coverage, 1);
});

test('resampleByDistance descarta pontos que voltam atrás e usa "nearest" nas séries discretas', () => {
  const dist = [0, 40, 30, 100]; const gear = [1, 2, 9, 3];
  const { out } = resampleByDistance(dist, [gear], 3, 100, [0]);
  assert.ok(!out[0].includes(9));
  assert.deepEqual(out[0], [1, 2, 3]);
});

test('kindOf classifica o tipo de sessão do jogo', () => {
  assert.equal(kindOf('Short Qualifying'), 'quali');
  assert.equal(kindOf('Race'), 'race');
  assert.equal(kindOf('Sprint Shootout'), 'quali');
  assert.equal(kindOf('Practice 1'), null);
});
