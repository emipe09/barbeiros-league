'use strict';

/* Leitura dos CSVs do Pits n' Giggles e geração dos dados de telemetria do site.

   Cada sessão (quali ou corrida) vira:
     - um arquivo "meta" (voltas, setores, posições, pneus, combustível, eventos...)
     - um arquivo de traço por carro (velocidade, acelerador, freio... reamostrados
       por DISTÂNCIA na pista, N pontos por volta). Assim as voltas de pilotos
       diferentes ficam alinhadas e o site pode compará-las ponto a ponto.
   O resultado tem alguns MB por sessão (os CSVs brutos têm centenas de MB). */

const fs = require('node:fs');
const path = require('node:path');

const N_POINTS = 240;
const key = (frame, car) => frame * 64 + car; // frame_id + índice do carro

/* ---------- CSV ---------- */
function splitCsvLine(line) {
  if (line.indexOf('"') === -1) return line.split(',');
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function oddQuotes(line) {
  let n = 0;
  for (let i = line.indexOf('"'); i !== -1; i = line.indexOf('"', i + 1)) n++;
  return n % 2 === 1;
}

/** Percorre um CSV linha a linha: onRow(colunas, H) com H = {nomeDaColuna: índice}.
    Tolera bytes NUL (aparecem em alguns arquivos do Pits n' Giggles). Devolve H, ou null se não existir. */
function readCsv(file, onRow) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, 'utf8').replace(/\0/g, '').split(/\r?\n/);
  if (!lines.length || !lines[0]) return null;
  const H = Object.create(null);
  splitCsvLine(lines[0]).forEach((h, i) => { H[h] = i; });
  let pending = '';
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i];
    if (pending) { line = pending + '\n' + line; pending = ''; }
    if (!line) continue;
    if (line.indexOf('"') !== -1 && oddQuotes(line)) { pending = line; continue; }
    onRow(splitCsvLine(line), H);
  }
  return H;
}
const num = (v) => { const n = +v; return Number.isFinite(n) ? n : 0; };
const bool = (v) => String(v).toLowerCase() === 'true';

/* ---------- Reamostragem por distância ---------- */
/** dist: distâncias (qualquer ordem; só entram pontos crescentes). series: arrays alinhados com dist.
    Devolve N pontos igualmente espaçados em [0, length], interpolados (ou "nearest" nas séries discretas). */
function resampleByDistance(dist, series, N, length, discrete = []) {
  const d = []; const idx = []; let last = -Infinity;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > last && dist[i] <= length * 1.02) { d.push(dist[i]); idx.push(i); last = dist[i]; }
  }
  const out = series.map(() => new Array(N));
  if (d.length < 2) return { out, coverage: 0 };
  let j = 0;
  for (let k = 0; k < N; k++) {
    const x = (k / (N - 1)) * length;
    while (j < d.length - 2 && d[j + 1] < x) j++;
    const t = Math.max(0, Math.min(1, (x - d[j]) / ((d[j + 1] - d[j]) || 1)));
    for (let s = 0; s < series.length; s++) {
      const a = series[s][idx[j]]; const b = series[s][idx[j + 1]];
      out[s][k] = discrete.includes(s) ? (t < 0.5 ? a : b) : a + (b - a) * t;
    }
  }
  return { out, coverage: (d[d.length - 1] - d[0]) / length };
}

/* ---------- Sessão ---------- */
const kindOf = (type) => {
  const t = String(type || '').toLowerCase();
  if (/qualifying|shootout|^q[123]$/.test(t)) return 'quali';
  if (t === 'race' || /^race/.test(t)) return t.includes('sprint') ? 'sprint' : 'race';
  if (/sprint/.test(t)) return 'sprint';
  return null;
};

function readSessionInfo(dir) {
  let session = null;
  readCsv(path.join(dir, 'session.csv'), (c, H) => {
    if (session) { session.durationS = num(c[H.session_time_s]); return; }
    session = {
      uid: c[H.session_uid], type: c[H.session_type], track: c[H.track_id], length: num(c[H.track_length]),
      totalLaps: num(c[H.total_laps]), weather: c[H.weather], trackTemp: num(c[H.track_temperature]),
      airTemp: num(c[H.air_temperature]), startedAt: c[H.recv_time],
    };
  });
  if (!session) return null;
  session.kind = kindOf(session.type);
  const cars = new Map();
  readCsv(path.join(dir, 'participants.csv'), (c, H) => {
    if (!c[H.team]) return;
    cars.set(num(c[H.car_idx]), {
      idx: num(c[H.car_idx]), gameName: c[H.driver], team: c[H.team], number: num(c[H.race_number]),
      ai: bool(c[H.ai_controlled]), restricted: c[H.telemetry_setting] !== 'Public',
    });
  });
  return { session, cars };
}

/** Lê a sessão inteira e devolve { meta, traces: Map(idx -> {laps:{n:{...}}}) }.
    resolveCar(car) -> { driverId, teamId, name } | null decide quem é cada carro. */
function importSession(dir, { resolveCar = () => null, points = N_POINTS, log = () => {} } = {}) {
  const info = readSessionInfo(dir);
  if (!info) throw new Error('session.csv não encontrado em ' + dir);
  const { session, cars } = info;
  const f = (n) => path.join(dir, n + '.csv');
  const LEN = session.length || 5000;

  /* Classificação final */
  const fin = new Map();
  readCsv(f('final_classification'), (c, H) => {
    const stints = [];
    for (let i = 0; H['tyre_stints_visual_' + i] !== undefined; i++) {
      if (c[H['tyre_stints_visual_' + i]]) stints.push({ compound: c[H['tyre_stints_visual_' + i]], endLap: num(c[H['tyre_stints_end_laps_' + i]]) });
    }
    fin.set(num(c[H.car_idx]), {
      position: num(c[H.position]), grid: num(c[H.grid_position]), laps: num(c[H.num_laps]), bestLapMs: num(c[H.best_lap_time_ms]),
      totalTime: num(c[H.total_race_time]), penaltySec: num(c[H.penalties_time]), pitStops: num(c[H.num_pit_stops]),
      status: c[H.result_status], stints,
    });
  });

  /* Histórico de voltas e setores (cada linha é uma "foto"; vale a última de cada volta) */
  const hist = new Map(); // car*1000+item -> [ms, s1, s2, s3, flags]
  const histInfo = new Map();
  readCsv(f('session_history_lap_history_data'), (c, H) => {
    const car = num(c[H.car_index]);
    hist.set(car * 1000 + num(c[H.item_idx]), [
      num(c[H.lap_time_in_ms]),
      num(c[H.sector_1_time_in_ms]) + 60000 * num(c[H.sector_1_time_minutes]),
      num(c[H.sector_2_time_in_ms]) + 60000 * num(c[H.sector_2_time_minutes]),
      num(c[H.sector_3_time_in_ms]) + 60000 * num(c[H.sector_3_time_minutes]),
      num(c[H.lap_valid_bit_flags]),
    ]);
    histInfo.set(car, { numLaps: num(c[H.num_laps]), bestLapNum: num(c[H.best_lap_time_lap_num]) });
  });

  /* lap_data: volta atual, distância na volta, posição, pit — e o "índice" de cada quadro */
  const frameRow = new Map();
  const Lap = []; const Dist = []; const Ms = [];
  const lapEnd = new Map();  // car*1000+lap -> {pos, pit}
  const timeline = new Map(); // car -> {t:[], lap:[]} (para achar a volta de um evento)
  readCsv(f('lap_data'), (c, H) => {
    const car = num(c[H.car_idx]); const lap = num(c[H.current_lap_num]);
    frameRow.set(key(num(c[H.frame_id]), car), Lap.length);
    Lap.push(lap); Dist.push(num(c[H.lap_distance])); Ms.push(num(c[H.current_lap_time_in_ms]));
    const k = car * 1000 + lap;
    let e = lapEnd.get(k);
    if (!e) { e = { pos: 0, pit: false }; lapEnd.set(k, e); }
    e.pos = num(c[H.car_position]);
    if (c[H.pit_status] !== 'NONE') e.pit = true;
    let tl = timeline.get(car);
    if (!tl) { tl = { t: [], lap: [] }; timeline.set(car, tl); }
    tl.t.push(num(c[H.session_time_s])); tl.lap.push(lap);
  });
  const lapAt = (car, t) => {
    const tl = timeline.get(car); if (!tl || !tl.t.length) return null;
    let lo = 0; let hi = tl.t.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tl.t[mid] <= t) lo = mid; else hi = mid - 1; }
    return tl.lap[lo];
  };

  /* Telemetria do carro: traço + acumuladores por volta */
  const raw = new Map(); // car*1000+lap -> arrays
  const acc = new Map();
  const getAcc = (k) => { let a = acc.get(k); if (!a) { a = { n: 0, vmax: 0, full: 0, brk: 0, drs: 0, tyre: [0, 0, 0, 0] }; acc.set(k, a); } return a; };
  readCsv(f('car_telemetry'), (c, H) => {
    const car = num(c[H.car_idx]);
    const i = frameRow.get(key(num(c[H.frame_id]), car));
    if (i === undefined) return;
    const lap = Lap[i]; if (lap < 1) return;
    const speed = num(c[H.speed]); const thr = num(c[H.throttle]); const brk = num(c[H.brake]);
    const k = car * 1000 + lap;
    let r = raw.get(k);
    if (!r) { r = { d: [], ms: [], v: [], th: [], br: [], st: [], g: [], rpm: [], drs: [] }; raw.set(k, r); }
    r.d.push(Dist[i]); r.ms.push(Ms[i]); r.v.push(speed); r.th.push(thr * 100); r.br.push(brk * 100);
    r.st.push(num(c[H.steer]) * 100); r.g.push(num(c[H.gear])); r.rpm.push(num(c[H.engine_rpm])); r.drs.push(bool(c[H.drs]) ? 1 : 0);
    const a = getAcc(k);
    a.n++; if (speed > a.vmax) a.vmax = speed;
    if (thr >= 0.98) a.full++;
    if (brk > 0.05) a.brk++;
    if (bool(c[H.drs])) a.drs++;
    for (let t = 0; t < 4; t++) a.tyre[t] += num(c[H['tyres_inner_temperature_' + t]]);
  });

  /* Combustível, ERS, pneus (última leitura de cada volta) */
  const lapState = new Map();
  readCsv(f('car_status'), (c, H) => {
    const car = num(c[H.car_idx]);
    const i = frameRow.get(key(num(c[H.frame_id]), car));
    if (i === undefined) return;
    const cap = num(c[H.ers_max_capacity]) || 4000000;
    const k = car * 1000 + Lap[i];
    const s = lapState.get(k) || {};
    s.fuel = num(c[H.fuel_in_tank]); s.fuelLaps = num(c[H.fuel_remaining_laps]);
    s.ers = (num(c[H.ers_store_energy]) / cap) * 100;
    s.compound = c[H.visual_tyre_compound]; s.age = num(c[H.tyres_age_laps]);
    lapState.set(k, s);
  });
  readCsv(f('car_damage'), (c, H) => {
    const car = num(c[H.car_idx]);
    const i = frameRow.get(key(num(c[H.frame_id]), car));
    if (i === undefined) return;
    const k = car * 1000 + Lap[i];
    const s = lapState.get(k) || {};
    s.wear = [0, 1, 2, 3].map(t => num(c[H['tyres_wear_' + t]]));
    s.dmg = Math.max(num(c[H.front_left_wing_damage]), num(c[H.front_right_wing_damage]), num(c[H.rear_wing_damage]),
      num(c[H.floor_damage]), num(c[H.diffuser_damage]), num(c[H.sidepod_damage]));
    lapState.set(k, s);
  });

  /* Melhor volta da sessão (para o mapa da pista) */
  let ref = null;
  for (const [k, v] of hist) {
    if (v[0] > 0 && (v[4] & 1) && (!ref || v[0] < ref.ms)) ref = { car: Math.floor(k / 1000), lap: (k % 1000) + 1, ms: v[0] };
  }
  const track = { name: session.track, length: LEN, x: [], z: [] };
  if (ref) {
    const px = []; const pz = []; const pd = [];
    readCsv(f('motion'), (c, H) => {
      if (num(c[H.car_idx]) !== ref.car) return;
      const i = frameRow.get(key(num(c[H.frame_id]), ref.car));
      if (i === undefined || Lap[i] !== ref.lap) return;
      pd.push(Dist[i]); px.push(num(c[H.world_position_x])); pz.push(num(c[H.world_position_z]));
    });
    const rs = resampleByDistance(pd, [px, pz], points, LEN);
    track.x = rs.out[0].map(v => Math.round(v * 10) / 10);
    track.z = rs.out[1].map(v => Math.round(v * 10) / 10);
  }

  /* Eventos */
  const events = []; const speedTrap = new Map();
  readCsv(f('event'), (c, H) => {
    const code = c[H.event_code];
    if (!['OVTK', 'PENA', 'COLL', 'FTLP', 'RCWN', 'SCAR', 'CHQF', 'SPTP'].includes(code)) return;
    let d = {};
    try { d = JSON.parse(c[H.details_json]) || {}; } catch (_) { d = {}; }
    const t = num(c[H.session_time_s]);
    if (code === 'SPTP') {
      const v = d['vehicle-idx']; const sp = Math.round(d.speed || 0);
      if (v != null && sp > (speedTrap.get(v) || 0)) speedTrap.set(v, sp);
      return;
    }
    if (code === 'SCAR' && d['safety-car-event-type'] === 'RESUME_RACE') return;
    const ev = { t: Math.round(t * 10) / 10, code };
    if (code === 'OVTK') { ev.cars = [d['overtaking-vehicle-idx'], d['being-overtaken-vehicle-idx']]; }
    else if (code === 'PENA') {
      ev.cars = [d['vehicle-idx']]; if (d['other-vehicle-idx'] != null && d['other-vehicle-idx'] !== 255) ev.cars.push(d['other-vehicle-idx']);
      ev.kind = d['penalty-type']; ev.why = d['infringement-type']; ev.sec = d.time === 255 ? 0 : d.time; ev.lap = d['lap-num'];
    } else if (code === 'COLL') { ev.cars = [d['vehicle-1-index'], d['vehicle-2-index']]; ev.sev = d.severity; }
    else if (code === 'FTLP') { ev.cars = [d['vehicle-idx']]; ev.ms = Math.round((d['lap-time'] || 0) * 1000); }
    else if (code === 'RCWN') ev.cars = [d['vehicle-idx']];
    else if (code === 'SCAR') { ev.kind = d['safety-car-type']; ev.what = d['safety-car-event-type']; }
    if (ev.lap == null && ev.cars && ev.cars[0] != null) ev.lap = lapAt(ev.cars[0], t);
    events.push(ev);
  });
  events.sort((a, b) => a.t - b.t);

  /* Monta carros, voltas e traços */
  const outCars = []; const traces = new Map();
  const idxs = [...new Set([...cars.keys(), ...fin.keys()])].sort((a, b) => a - b);
  for (const idx of idxs) {
    const pc = cars.get(idx) || { idx, gameName: '?', team: '?', number: 0, ai: false, restricted: false };
    const fc = fin.get(idx) || null;
    const who = resolveCar(pc) || {};
    const hi = histInfo.get(idx) || { numLaps: 0, bestLapNum: 0 };
    const laps = []; const lapTraces = {};
    let prevAge = Infinity; const stints = [];
    for (let item = 0; item < Math.max(hi.numLaps, 0); item++) {
      const h = hist.get(idx * 1000 + item);
      const n = item + 1;
      if (!h || h[0] <= 0) continue;
      const st = lapState.get(idx * 1000 + n) || {};
      const a = acc.get(idx * 1000 + n);
      const le = lapEnd.get(idx * 1000 + n) || {};
      const lap = {
        n, ms: h[0], s1: h[1], s2: h[2], s3: h[3], valid: (h[4] & 1) === 1,
        pos: le.pos || null, pit: !!le.pit, compound: st.compound || null, age: st.age ?? null,
        fuel: st.fuel != null ? Math.round(st.fuel * 100) / 100 : null,
        ers: st.ers != null ? Math.round(st.ers) : null,
        wear: st.wear ? st.wear.map(v => Math.round(v * 10) / 10) : null,
        dmg: st.dmg || 0,
      };
      if (a && a.n) {
        lap.vmax = Math.round(a.vmax);
        lap.full = Math.round((a.full / a.n) * 100); lap.brk = Math.round((a.brk / a.n) * 100); lap.drs = Math.round((a.drs / a.n) * 100);
        lap.tyreT = a.tyre.map(v => Math.round(v / a.n));
      }
      // Traço por distância
      const r = raw.get(idx * 1000 + n);
      if (r && r.d.length > 30) {
        const rs = resampleByDistance(r.d, [r.ms, r.v, r.th, r.br, r.st, r.g, r.rpm, r.drs], points, LEN, [5, 7]);
        if (rs.coverage >= 0.85) {
          const [ms, v, th, br, stv, g, rpm, drs] = rs.out;
          lapTraces[n] = {
            ms: ms.map(Math.round), v: v.map(Math.round), th: th.map(Math.round), br: br.map(Math.round),
            st: stv.map(Math.round), g: g, rpm: rpm.map(x => Math.round(x / 10)), drs,
          };
          lap.trace = true;
        }
      }
      // Stints (troca de pneu = idade do pneu volta a cair)
      if (lap.age != null && lap.compound) {
        if (!stints.length || lap.age < prevAge) stints.push({ compound: lap.compound, from: n, to: n });
        else stints[stints.length - 1].to = n;
        prevAge = lap.age;
      }
      laps.push(lap);
    }
    const valid = laps.filter(l => l.valid && l.ms > 0);
    const best = valid.length ? valid.reduce((m, l) => (l.ms < m.ms ? l : m)) : null;
    outCars.push({
      idx, driverId: who.driverId || null, teamId: who.teamId || null, name: who.name || pc.gameName,
      gameName: pc.gameName, gameTeam: pc.team, number: pc.number, ai: pc.ai, restricted: pc.restricted,
      grid: fc ? fc.grid : null, finalPos: fc ? fc.position : null, status: fc ? fc.status : null,
      bestLapMs: best ? best.ms : (fc ? fc.bestLapMs : 0), bestLapNum: best ? best.n : null,
      pitStops: fc ? fc.pitStops : null, penaltySec: fc ? fc.penaltySec : 0, totalTime: fc ? fc.totalTime : null,
      topSpeed: speedTrap.get(idx) || (laps.length ? Math.max(...laps.map(l => l.vmax || 0)) : 0),
      stints, laps,
    });
    if (Object.keys(lapTraces).length) traces.set(idx, { idx, points, laps: lapTraces });
    log(`  carro ${idx} ${pc.team} #${pc.number} → ${who.name || pc.gameName}: ${laps.length} voltas, ${Object.keys(lapTraces).length} com traço`);
  }

  // Posição final: o jogo omite quem saiu da sala antes do fim. Corrida: usa a posição da última volta.
  // Quali: ranqueia pelo melhor tempo válido (o jogo pode deixar buracos na lista).
  if (session.kind === 'quali') {
    const ranked = outCars.filter(c => c.bestLapMs > 0).sort((a, b) => a.bestLapMs - b.bestLapMs);
    outCars.forEach(c => { c.gamePos = c.finalPos; c.finalPos = null; });
    ranked.forEach((c, i) => { c.finalPos = i + 1; });
  } else {
    for (const c of outCars) {
      if (c.finalPos) continue;
      const last = c.laps.filter(l => l.pos).pop();
      if (last) { c.finalPos = last.pos; c.unclassified = true; }
    }
  }

  const meta = {
    v: 1, kind: session.kind, sessionUid: session.uid, sessionType: session.type, startedAt: session.startedAt,
    track, totalLaps: session.totalLaps, points, weather: session.weather, trackTemp: session.trackTemp, airTemp: session.airTemp,
    cars: outCars, events,
  };
  return { meta, traces, session };
}

module.exports = { readCsv, splitCsvLine, resampleByDistance, importSession, readSessionInfo, kindOf, N_POINTS };
