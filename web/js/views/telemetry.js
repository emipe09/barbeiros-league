/* Aba Telemetria: lista de corridas e a página de cada sessão
   (voltas, comparação de voltas, carro, eventos e estatísticas). */

import { html, raw, esc, $, $$ } from '../util.js';
import { store, driver, teamColor, findRace } from '../data.js';
import { lineChart, tracePanels, trackMap, fmtLap, fmtSec } from '../telemetry-charts.js';

const KIND_LABEL = { race: 'Corrida', quali: 'Classificação', sprint: 'Sprint' };
const COMPOUND = { Soft: ['#e10600', '#fff'], Medium: ['#f2c200', '#1d2129'], Hard: ['#e6e8ec', '#1d2129'], Inter: ['#2fa84f', '#fff'], Wet: ['#2b6fd6', '#fff'] };
const compLetter = (c) => ({ Soft: 'S', Medium: 'M', Hard: 'H', Inter: 'I', Wet: 'W' }[c] || '?');
const cache = new Map();

function getJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error('Não encontrei os dados de telemetria desta corrida.');
      return r.json();
    }).catch(e => { cache.delete(url); throw e; }));
  }
  return cache.get(url);
}
const ver = (T, kind) => encodeURIComponent((T[kind] && T[kind].importedAt) || '1');
const fileUrl = (raceId, T, name, kind) => `data/telemetria/${raceId}/${name}.json?v=${ver(T, kind)}`;

/* ---------- cores e nomes ---------- */
function lighten(hex, k) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex || '#8a8f98';
  const n = parseInt(m[1], 16);
  const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v + (255 - v) * k));
  return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
}
const nameOf = (c) => (c.driverId && driver(c.driverId)?.name) || c.name || `Carro ${c.idx}`;
/** Cada equipe tem uma cor; o segundo carro da mesma equipe ganha tom mais claro e linha tracejada. */
function carStyles(cars) {
  const seen = new Map(); const out = new Map();
  for (const c of cars) {
    const tk = c.teamId || c.gameTeam || 'x'; const k = seen.get(tk) || 0; seen.set(tk, k + 1);
    const base = c.teamId ? teamColor(c.teamId) : '#8a8f98';
    out.set(c.idx, k === 0 ? { color: base, dashed: false } : { color: lighten(base, 0.38), dashed: true });
  }
  return out;
}
const ptDur = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f1 = (v, d = 1) => (v == null ? '—' : v.toFixed(d).replace('.', ','));
const signed = (ms) => `${ms >= 0 ? '+' : '−'}${fmtSec(Math.abs(ms))}`;

/* ---------- lista ---------- */
export function renderTelemetryIndex(main) {
  const T = store.league.telemetry || {};
  const items = [];
  for (const c of [...store.league.championships].reverse()) {
    for (const r of c.races) if (T[r.id]) items.push({ c, r, t: T[r.id] });
  }
  main.innerHTML = String(html`
    <section class="block">
      <div class="block-head"><h1 class="page-title">Telemetria</h1></div>
      <p class="muted">Voltas, setores, pneus, ritmo e comparação de voltas direto da telemetria do jogo (Pits n' Giggles).</p>
      ${items.length ? html`<ol class="race-list">${items.map(({ c, r, t }) => html`<li class="race-row done"><a href="#/telemetria/${r.id}">
        <span class="rr-round">${r.round}</span><span class="rr-flag">${r.flag || '🏁'}</span>
        <span class="rr-name"><b>${r.name}</b><small>${c.name}${r.circuit ? ' | ' + r.circuit : ''}</small></span>
        <span class="rr-result">${['quali', 'race', 'sprint'].filter(k => t[k]).map(k => html`<span class="chip on">${KIND_LABEL[k]}</span> `)}</span></a></li>`)}</ol>`
        : html`<section class="empty small"><p>Ainda não há telemetria importada.</p><p class="muted">No computador do campeonato: <code>npm run telemetria -- --todas "pasta csv_output"</code> e depois "Publicar no site".</p></section>`}
    </section>`);
}

/* ---------- página da sessão ---------- */
export async function renderTelemetry(main, raceId, kindParam) {
  const found = findRace(raceId);
  const T = (store.league.telemetry || {})[raceId];
  if (!found || !T) { main.innerHTML = '<section class="empty"><h1>Sem telemetria para esta corrida</h1><p><a href="#/telemetria">Ver corridas com telemetria</a></p></section>'; return; }
  const kinds = ['race', 'quali', 'sprint'].filter(k => T[k]);
  const kind = kinds.includes(kindParam) ? kindParam : kinds[0];
  const { champ: c, race: r } = found;
  main.innerHTML = '<div class="loading" aria-live="polite">Carregando telemetria…</div>';
  let meta;
  try { meta = await getJson(fileUrl(raceId, T, kind, kind)); } catch (e) { main.innerHTML = `<section class="empty"><h1>Não deu para carregar</h1><p>${esc(e.message)}</p></section>`; return; }

  const styles = carStyles(meta.cars);
  const sorted = [...meta.cars].sort((a, b) => (a.finalPos ?? 99) - (b.finalPos ?? 99) || a.idx - b.idx);
  const withLaps = sorted.filter(x => x.laps.length);
  const S = { tab: 'voltas', sel: new Set(sorted.map(x => x.idx)), A: null, B: null, lapA: null, lapB: null, metric: 'wear', evf: new Set(['OVTK', 'PENA', 'COLL', 'FTLP', 'SCAR']) };
  const bestOverall = Math.min(...meta.cars.map(x => x.bestLapMs || Infinity));
  const best = (x) => x.laps.filter(l => l.valid).reduce((m, l) => (!m || l.ms < m.ms ? l : m), null);
  const TABS = [['voltas', 'Voltas'], ['comparar', 'Comparar voltas'], ['carro', 'Carro'], ['eventos', 'Eventos'], ['pilotos', 'Estatísticas']];
  const weatherPt = { Clear: 'Céu limpo', 'Light Cloud': 'Poucas nuvens', Overcast: 'Nublado', 'Light Rain': 'Chuva fraca', 'Heavy Rain': 'Chuva forte', Storm: 'Tempestade' }[meta.weather] || meta.weather;

  main.innerHTML = String(html`
    <nav class="crumbs"><a href="#/telemetria">Telemetria</a> <span aria-hidden="true">/</span> <a href="#/corrida/${r.id}">${r.name}</a></nav>
    <section class="race-hero">
      <span class="race-flag">${r.flag || '🏁'}</span>
      <div><h1 class="page-title">${r.name}: ${KIND_LABEL[kind]}</h1>
        <p class="muted">${meta.track.name} | ${meta.totalLaps > 1 ? meta.totalLaps + ' voltas | ' : ''}${weatherPt}, pista ${meta.trackTemp}°C, ar ${meta.airTemp}°C | ${c.name}</p></div>
    </section>
    ${kinds.length > 1 ? html`<div class="chips" aria-label="Sessão">${kinds.map(k => html`<a class="chip ${k === kind ? 'on' : ''}" href="#/telemetria/${r.id}/${k}">${KIND_LABEL[k]}</a>`)}</div>` : ''}
    <nav class="admin-tabs tel-tabs" id="tel-tabs" aria-label="Seções da telemetria">${TABS.map(([k, l]) => html`<a href="#" data-tab="${k}" class="${k === S.tab ? 'on' : ''}">${l}</a>`)}</nav>
    <div id="tel-body"></div>`);

  const body = $('#tel-body');
  const chipsHtml = (cars, selSet) => html`<div class="chips" id="car-chips">${cars.map(x => html`<button type="button" class="chip ${selSet.has(x.idx) ? 'on' : ''}" data-idx="${x.idx}" style="--tc:${styles.get(x.idx).color}"><i class="sw ${styles.get(x.idx).dashed ? 'dash' : ''}"></i>${nameOf(x)}</button>`)}
    <button type="button" class="chip ghost" data-all="1">Todos</button><button type="button" class="chip ghost" data-none="1">Nenhum</button></div>`;
  const wireChips = (cars, redraw) => {
    $$('#car-chips [data-idx]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.idx; if (S.sel.has(i)) S.sel.delete(i); else S.sel.add(i); redraw(); }));
    $('#car-chips [data-all]').addEventListener('click', () => { cars.forEach(x => S.sel.add(x.idx)); redraw(); });
    $('#car-chips [data-none]').addEventListener('click', () => { S.sel.clear(); redraw(); });
  };
  const syncChips = () => $$('#car-chips [data-idx]').forEach(b => b.classList.toggle('on', S.sel.has(+b.dataset.idx)));

  /* ===== Voltas ===== */
  function tabVoltas() {
    const isRace = kind !== 'quali';
    const rowsHtml = sorted.map(x => {
      const gap = x.bestLapMs && bestOverall < Infinity ? x.bestLapMs - bestOverall : null;
      const delta = isRace && x.grid && x.finalPos ? x.grid - x.finalPos : null;
      return html`<tr>
        <td class="pos">${x.finalPos ?? '—'}</td>
        <td><span class="team-dot" style="--tc:${styles.get(x.idx).color}"></span>${x.driverId ? html`<a href="#/piloto/${x.driverId}">${nameOf(x)}</a>` : nameOf(x)}${x.unclassified ? html` <small class="muted" title="O jogo não classificou este carro; vale a posição da última volta">*</small>` : ''}</td>
        ${isRace ? html`<td class="num">${x.grid || '—'}${delta ? html` <small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' + delta : '▼' + -delta}</small>` : ''}</td>` : ''}
        <td class="num ${x.bestLapMs === bestOverall ? 'purple' : ''}">${fmtLap(x.bestLapMs)}${x.bestLapNum ? html` <small class="muted">V${x.bestLapNum}</small>` : ''}</td>
        <td class="num">${gap ? '+' + fmtSec(gap) : ''}</td>
        <td class="num">${x.topSpeed || '—'}</td>
        ${isRace ? html`<td class="num">${x.pitStops ?? '—'}</td><td>${(x.stints || []).map(s => html`<span class="cmp" style="--cb:${(COMPOUND[s.compound] || [])[0] || '#999'};--cf:${(COMPOUND[s.compound] || [])[1] || '#fff'}" title="${s.compound}, voltas ${s.from} a ${s.to}">${compLetter(s.compound)}</span>`)}</td>` : ''}
      </tr>`;
    });
    const secBest = (laps, n) => Math.min(...laps.filter(l => l.valid && l['s' + n] > 0).map(l => l['s' + n]), Infinity);
    const bs = [1, 2, 3].map(n => Math.min(...withLaps.map(x => secBest(x.laps, n))));
    body.innerHTML = String(html`
      <section class="block"><h2>${isRace ? 'Classificação e ritmo' : 'Resultado da classificação'}</h2>
        <div class="table-scroll"><table class="tbl">
          <thead><tr><th class="pos">Pos</th><th>Piloto</th>${isRace ? html`<th class="num">Grid</th>` : ''}<th class="num">Melhor volta</th><th class="num">Gap</th><th class="num">V. máx</th>${isRace ? html`<th class="num">Paradas</th><th>Pneus</th>` : ''}</tr></thead>
          <tbody>${rowsHtml}</tbody></table></div>
        <p class="muted small-note">Roxo = melhor da sessão. ${isRace ? 'No grid, ▲ = posições ganhas e ▼ = posições perdidas em relação à largada.' : ''}</p>
      </section>
      <section class="block"><h2>Tempos volta a volta</h2>${chipsHtml(withLaps, S.sel)}<div id="ch-laps" class="chart"></div>
        <p class="muted small-note">Voltas muito lentas (entrada e saída dos boxes, incidentes) saem do gráfico e aparecem como triângulos no topo.</p></section>
      ${isRace ? html`<section class="block"><h2>Posição volta a volta</h2><div id="ch-pos" class="chart"></div></section>
      <section class="block"><h2>Estratégia de pneus</h2><div id="stints"></div></section>` : ''}
      <section class="block"><h2>Melhores setores</h2><div class="table-scroll"><table class="tbl"><thead><tr><th>Piloto</th><th class="num">Setor 1</th><th class="num">Setor 2</th><th class="num">Setor 3</th><th class="num">Volta ideal</th></tr></thead>
        <tbody>${withLaps.map(x => {
          const sb = [1, 2, 3].map(n => secBest(x.laps, n));
          const ideal = sb.every(Number.isFinite) ? sb[0] + sb[1] + sb[2] : null;
          return html`<tr><td><span class="team-dot" style="--tc:${styles.get(x.idx).color}"></span>${nameOf(x)}</td>${sb.map((v, i) => html`<td class="num ${v === bs[i] ? 'purple' : ''}">${Number.isFinite(v) ? fmtSec(v) : '—'}</td>`)}<td class="num">${ideal ? fmtLap(ideal) : '—'}</td></tr>`;
        })}</tbody></table></div></section>`);
    wireChips(withLaps, drawVoltas);
    drawVoltas();
    if (isRace) drawStints();
  }
  function drawVoltas() {
    syncChips();
    const cars = withLaps.filter(x => S.sel.has(x.idx));
    const maxN = Math.max(1, ...withLaps.flatMap(x => x.laps.map(l => l.n)));
    const labels = Array.from({ length: maxN }, (_, i) => i + 1);
    const bestAll = Math.min(...cars.flatMap(x => x.laps.filter(l => l.valid).map(l => l.ms)), Infinity);
    const cap = Number.isFinite(bestAll) ? bestAll * (kind === 'quali' ? 1.25 : 1.07) : undefined;
    lineChart($('#ch-laps'), {
      labels, height: 320, yMin: Number.isFinite(bestAll) ? bestAll * 0.995 : undefined, yMax: cap, clip: true, tipAsc: true,
      yFmt: (v) => fmtLap(Math.round(v)), aria: 'Tempo de cada volta',
      series: cars.map(x => ({ name: nameOf(x), ...styles.get(x.idx), values: labels.map(n => { const l = x.laps.find(z => z.n === n); return l ? l.ms : null; }) })),
    });
    if (kind !== 'quali' && $('#ch-pos')) {
      lineChart($('#ch-pos'), {
        labels, height: 320, invert: true, yMin: 1, yMax: sorted.length, yFmt: (v) => 'P' + Math.round(v), aria: 'Posição de cada piloto volta a volta',
        series: cars.map(x => ({ name: nameOf(x), ...styles.get(x.idx), values: labels.map(n => { const l = x.laps.find(z => z.n === n); return l && l.pos ? l.pos : null; }) })),
      });
    }
  }
  function drawStints() {
    const total = Math.max(1, ...withLaps.map(x => Math.max(...x.laps.map(l => l.n))));
    $('#stints').innerHTML = withLaps.map(x => `<div class="stint-row"><span class="stint-name">${esc(nameOf(x))}</span><div class="stint-bar">${(x.stints || []).map(s => {
      const [bg, fg] = COMPOUND[s.compound] || ['#999', '#fff'];
      return `<span class="stint" style="flex:${s.to - s.from + 1};background:${bg};color:${fg}" title="${esc(s.compound)}: voltas ${s.from} a ${s.to}">${compLetter(s.compound)} <small>${s.from}-${s.to}</small></span>`;
    }).join('')}</div></div>`).join('') + `<p class="muted small-note">Largura proporcional às voltas (${total} no total). S = macio, M = médio, H = duro, I = intermediário, W = chuva.</p>`;
  }

  /* ===== Comparar ===== */
  const traceCars = withLaps.filter(x => x.laps.some(l => l.trace));
  const bestTraceLap = (x) => { const ls = x.laps.filter(l => l.trace && l.valid); return (ls.length ? ls : x.laps.filter(l => l.trace)).reduce((m, l) => (!m || l.ms < m.ms ? l : m), null); };
  function tabComparar() {
    if (traceCars.length < 1) { body.innerHTML = '<section class="block"><p class="muted">Esta sessão não tem traços de telemetria por volta.</p></section>'; return; }
    if (S.A == null) {
      S.A = traceCars[0].idx; S.B = (traceCars[1] || traceCars[0]).idx;
      S.lapA = bestTraceLap(traceCars.find(x => x.idx === S.A)).n; S.lapB = bestTraceLap(traceCars.find(x => x.idx === S.B)).n;
    }
    const opts = (sel) => traceCars.map(x => `<option value="${x.idx}" ${x.idx === sel ? 'selected' : ''}>${esc(nameOf(x))}</option>`).join('');
    const lapOpts = (idx, sel) => traceCars.find(x => x.idx === idx).laps.filter(l => l.trace).map(l => `<option value="${l.n}" ${l.n === sel ? 'selected' : ''}>V${l.n} · ${fmtLap(l.ms)}${l.valid ? '' : ' (inválida)'}</option>`).join('');
    body.innerHTML = String(html`
      <section class="block"><h2>Comparar duas voltas</h2>
        <div class="cmp-pick">
          <div class="pick a"><span class="pick-tag">A</span><select id="selA" aria-label="Piloto A">${raw(opts(S.A))}</select><select id="lapA" aria-label="Volta do piloto A">${raw(lapOpts(S.A, S.lapA))}</select></div>
          <div class="pick b"><span class="pick-tag">B</span><select id="selB" aria-label="Piloto B">${raw(opts(S.B))}</select><select id="lapB" aria-label="Volta do piloto B">${raw(lapOpts(S.B, S.lapB))}</select></div>
        </div>
        <div id="cmp-out"><div class="loading">Carregando voltas…</div></div>
      </section>`);
    $('#selA').addEventListener('change', (e) => { S.A = +e.target.value; S.lapA = bestTraceLap(traceCars.find(x => x.idx === S.A)).n; tabComparar(); });
    $('#selB').addEventListener('change', (e) => { S.B = +e.target.value; S.lapB = bestTraceLap(traceCars.find(x => x.idx === S.B)).n; tabComparar(); });
    $('#lapA').addEventListener('change', (e) => { S.lapA = +e.target.value; drawComparar(); });
    $('#lapB').addEventListener('change', (e) => { S.lapB = +e.target.value; drawComparar(); });
    drawComparar();
  }
  async function drawComparar() {
    const out = $('#cmp-out'); if (!out) return;
    const cA = meta.cars.find(x => x.idx === S.A); const cB = meta.cars.find(x => x.idx === S.B);
    let tA; let tB;
    try { [tA, tB] = await Promise.all([getJson(fileUrl(raceId, T, `${kind}-${S.A}`, kind)), getJson(fileUrl(raceId, T, `${kind}-${S.B}`, kind))]); } catch (e) { out.innerHTML = `<p class="warn err">${esc(e.message)}</p>`; return; }
    if (!$('#cmp-out')) return;
    const a = tA.laps[S.lapA]; const b = tB.laps[S.lapB];
    const lA = cA.laps.find(l => l.n === S.lapA); const lB = cB.laps.find(l => l.n === S.lapB);
    if (!a || !b) { out.innerHTML = '<p class="muted">Volta sem traço.</p>'; return; }
    const sa = { ...styles.get(cA.idx) }; let sb = { ...styles.get(cB.idx) };
    if (sa.color === sb.color && sa.dashed === sb.dashed) sb = { color: lighten(sb.color, 0.4), dashed: true };
    const nA = `${nameOf(cA)} V${S.lapA}`; const nB = `${nameOf(cB)} V${S.lapB}`;
    const delta = a.ms.map((v, i) => (b.ms[i] - v) / 1000);
    const dm = Math.max(0.2, ...delta.filter(Number.isFinite).map(Math.abs));
    out.innerHTML = String(html`
      <div class="cmp-top">
        <div class="cmp-table"><table class="tbl"><thead><tr><th></th><th class="num" style="color:${sa.color}">A</th><th class="num" style="color:${sb.color}">B</th><th class="num">B − A</th></tr></thead><tbody>
          <tr><th>Volta</th><td class="num"><b>${fmtLap(lA.ms)}</b></td><td class="num"><b>${fmtLap(lB.ms)}</b></td><td class="num">${signed(lB.ms - lA.ms)}</td></tr>
          ${[1, 2, 3].map(n => html`<tr><th>Setor ${n}</th><td class="num">${fmtSec(lA['s' + n])}</td><td class="num">${fmtSec(lB['s' + n])}</td><td class="num">${signed(lB['s' + n] - lA['s' + n])}</td></tr>`)}
          <tr><th>V. máx (km/h)</th><td class="num">${lA.vmax ?? '—'}</td><td class="num">${lB.vmax ?? '—'}</td><td class="num">${lA.vmax && lB.vmax ? lB.vmax - lA.vmax : ''}</td></tr>
          <tr><th>Acel. pleno</th><td class="num">${lA.full ?? '—'}%</td><td class="num">${lB.full ?? '—'}%</td><td class="num"></td></tr>
          <tr><th>Freando</th><td class="num">${lA.brk ?? '—'}%</td><td class="num">${lB.brk ?? '—'}%</td><td class="num"></td></tr>
          <tr><th>Pneu</th><td class="num">${lA.compound || '—'} (${lA.age ?? '?'}v)</td><td class="num">${lB.compound || '—'} (${lB.age ?? '?'}v)</td><td class="num"></td></tr></tbody></table>
          <p class="muted small-note">Positivo = B mais lento que A. O mapa mostra a volta A colorida pela velocidade; passe o mouse nos gráficos para ver onde cada trecho está na pista.</p></div>
        <div class="cmp-map" id="cmp-map"></div>
      </div>
      <div id="cmp-charts" class="chart"></div>`);
    const map = trackMap($('#cmp-map'), { xs: meta.track.x, zs: meta.track.z, speeds: a.v, label: nameOf(cA) });
    tracePanels($('#cmp-charts'), {
      length: meta.track.length, onCursor: (i) => map.setCursor(i),
      panels: [
        { title: 'Velocidade', unit: 'km/h', height: 150, series: [{ name: nA, ...sa, values: a.v }, { name: nB, ...sb, values: b.v }], fmt: (v) => Math.round(v) },
        { title: 'Acelerador', unit: '%', height: 64, min: 0, max: 100, ticks: [0, 100], series: [{ name: nA, ...sa, values: a.th }, { name: nB, ...sb, values: b.th }], fmt: (v) => Math.round(v) },
        { title: 'Freio', unit: '%', height: 64, min: 0, max: 100, ticks: [0, 100], series: [{ name: nA, ...sa, values: a.br }, { name: nB, ...sb, values: b.br }], fmt: (v) => Math.round(v) },
        { title: 'Marcha', height: 70, min: 1, max: 8, ticks: [2, 4, 6, 8], series: [{ name: nA, ...sa, values: a.g }, { name: nB, ...sb, values: b.g }], fmt: (v) => Math.round(v) },
        { title: 'Delta de tempo', unit: 's', height: 90, min: -dm, max: dm, zero: 0, ticks: [-dm, 0, dm].map(v => Math.round(v * 100) / 100), series: [{ name: 'B − A', color: 'var(--ink)', values: delta }], fmt: (v) => (Math.round(v * 1000) / 1000).toFixed(3) },
      ],
    });
  }

  /* ===== Carro ===== */
  const METRICS = {
    wear: ['Desgaste dos pneus', (l) => (l.wear ? avg(l.wear) : null), (v) => `${Math.round(v)}%`],
    fuel: ['Combustível', (l) => l.fuel, (v) => `${(Math.round(v * 10) / 10).toFixed(1)} kg`],
    ers: ['Bateria (ERS)', (l) => l.ers, (v) => `${Math.round(v)}%`],
    tyret: ['Temp. dos pneus', (l) => (l.tyreT ? avg(l.tyreT) : null), (v) => `${Math.round(v)}°C`],
    vmax: ['Velocidade máx.', (l) => l.vmax, (v) => `${Math.round(v)}`],
    full: ['Acelerador a fundo', (l) => l.full, (v) => `${Math.round(v)}%`],
  };
  function tabCarro() {
    body.innerHTML = String(html`
      <section class="block"><h2>Carro e pneus</h2>
        <div class="chips" id="metrics">${Object.entries(METRICS).map(([k, m]) => html`<button type="button" class="chip ${k === S.metric ? 'on' : ''}" data-m="${k}">${m[0]}</button>`)}</div>
        ${chipsHtml(withLaps, S.sel)}<div id="ch-car" class="chart"></div>
        <p class="muted small-note">Desgaste e temperatura são a média das quatro rodas. Combustível e bateria são lidos no fim de cada volta.</p></section>
      ${kind === 'race' ? html`<section class="block"><h2>Desgaste final por pneu</h2><div class="table-scroll"><table class="tbl"><thead><tr><th>Piloto</th><th class="num">Diant. esq.</th><th class="num">Diant. dir.</th><th class="num">Tras. esq.</th><th class="num">Tras. dir.</th><th class="num">Dano máx.</th></tr></thead>
        <tbody>${withLaps.map(x => { const l = [...x.laps].reverse().find(z => z.wear); return html`<tr><td><span class="team-dot" style="--tc:${styles.get(x.idx).color}"></span>${nameOf(x)}</td>${l ? [2, 3, 0, 1].map(i => html`<td class="num">${Math.round(l.wear[i])}%</td>`) : html`<td colspan="4"></td>`}<td class="num">${Math.round(Math.max(0, ...x.laps.map(z => z.dmg || 0)))}%</td></tr>`; })}</tbody></table></div></section>` : ''}`);
    $$('#metrics [data-m]').forEach(b => b.addEventListener('click', () => { S.metric = b.dataset.m; $$('#metrics [data-m]').forEach(z => z.classList.toggle('on', z === b)); drawCarro(); }));
    wireChips(withLaps, drawCarro);
    drawCarro();
  }
  function drawCarro() {
    syncChips();
    const [title, get, fmt] = METRICS[S.metric];
    const cars = withLaps.filter(x => S.sel.has(x.idx));
    const maxN = Math.max(1, ...withLaps.flatMap(x => x.laps.map(l => l.n)));
    const labels = Array.from({ length: maxN }, (_, i) => i + 1);
    lineChart($('#ch-car'), {
      labels, height: 320, yFmt: fmt, aria: title,
      series: cars.map(x => ({ name: nameOf(x), ...styles.get(x.idx), values: labels.map(n => { const l = x.laps.find(z => z.n === n); const v = l ? get(l) : null; return v == null || !Number.isFinite(v) ? null : v; }) })),
    });
  }

  /* ===== Eventos ===== */
  const carByIdx = new Map(meta.cars.map(x => [x.idx, x]));
  const cn = (i) => (carByIdx.get(i) ? nameOf(carByIdx.get(i)) : `Carro ${i}`);
  const PEN = { Warning: 'Aviso', 'Drive Through': 'Drive-through', 'Stop Go': 'Stop-and-go', 'Time Penalty': 'Acréscimo de tempo', 'Grid Penalty': 'Perda de posições no grid', Disqualified: 'Desclassificação' };
  const WHY = [[/corner cutting/i, 'cortou a curva'], [/collision/i, 'colisão'], [/speeding/i, 'excesso de velocidade nos boxes'], [/wrong way/i, 'sentido contrário'], [/pit lane/i, 'infração nos boxes'], [/track limits|ran wide/i, 'limites da pista'], [/safety car/i, 'safety car'], [/blocking/i, 'bloqueio']];
  const why = (s) => { const f = WHY.find(([re]) => re.test(s || '')); return f ? f[1] : String(s || '').toLowerCase(); };
  const EV = {
    OVTK: ['Ultrapassagens', '↗', (e) => `${cn(e.cars[0])} ultrapassou ${cn(e.cars[1])}`],
    PENA: ['Punições', '⚠', (e) => `${cn(e.cars[0])}: ${PEN[e.kind] || e.kind}${e.why ? ' (' + why(e.why) + ')' : ''}${e.sec ? ' +' + e.sec + 's' : ''}`],
    COLL: ['Colisões', '✖', (e) => `Contato entre ${cn(e.cars[0])} e ${cn(e.cars[1])}${e.sev ? ' (' + ({ LOW: 'leve', MEDIUM: 'médio', HIGH: 'forte' }[e.sev] || String(e.sev).toLowerCase()) + ')' : ''}`],
    FTLP: ['Voltas mais rápidas', '⏱', (e) => `${cn(e.cars[0])} fez a volta mais rápida: ${fmtLap(e.ms)}`],
    SCAR: ['Safety car', '!', (e) => `Safety car: ${String(e.what || e.kind || '').toLowerCase().replace(/_/g, ' ')}`],
    RCWN: ['Vencedor', '🏆', (e) => `${cn(e.cars[0])} venceu`],
    CHQF: ['Bandeira', '🏁', () => 'Bandeira quadriculada'],
  };
  function tabEventos() {
    const evs = meta.events;
    const ov = new Map();
    const bump = (i, k) => { const v = ov.get(i) || [0, 0]; v[k]++; ov.set(i, v); };
    for (const e of evs.filter(z => z.code === 'OVTK')) { bump(e.cars[0], 0); bump(e.cars[1], 1); }
    body.innerHTML = String(html`
      ${ov.size ? html`<section class="block"><h2>Ultrapassagens</h2><div class="table-scroll"><table class="tbl"><thead><tr><th>Piloto</th><th class="num">Feitas</th><th class="num">Sofridas</th><th class="num">Saldo</th></tr></thead>
        <tbody>${[...ov.entries()].sort((a, b) => (b[1][0] - b[1][1]) - (a[1][0] - a[1][1])).map(([i, v]) => html`<tr><td><span class="team-dot" style="--tc:${(styles.get(i) || {}).color || '#8a8f98'}"></span>${cn(i)}</td><td class="num">${v[0]}</td><td class="num">${v[1]}</td><td class="num"><b>${v[0] - v[1] > 0 ? '+' : ''}${v[0] - v[1]}</b></td></tr>`)}</tbody></table></div>
        <p class="muted small-note">Contagem do jogo: inclui trocas de posição na pista, não só disputas diretas.</p></section>` : ''}
      <section class="block"><h2>Linha do tempo</h2>
        <div class="chips" id="evf">${Object.entries(EV).filter(([k]) => !['RCWN', 'CHQF'].includes(k) && evs.some(e => e.code === k)).map(([k, v]) => html`<button type="button" class="chip ${S.evf.has(k) ? 'on' : ''}" data-k="${k}">${v[1]} ${v[0]}</button>`)}</div>
        <ol class="events" id="ev-list"></ol></section>`);
    const draw = () => {
      const rows = evs.filter(e => S.evf.has(e.code) || ['RCWN', 'CHQF'].includes(e.code));
      $('#ev-list').innerHTML = rows.length ? rows.map(e => `<li class="ev ev-${e.code}"><span class="ev-t">${e.lap ? 'V' + e.lap : ''}<small>${ptDur(e.t)}</small></span><span class="ev-i" aria-hidden="true">${EV[e.code][1]}</span><span>${esc(EV[e.code][2](e))}</span></li>`).join('') : '<li class="muted">Nenhum evento com esses filtros.</li>';
    };
    $$('#evf [data-k]').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; if (S.evf.has(k)) S.evf.delete(k); else S.evf.add(k); b.classList.toggle('on'); draw(); }));
    draw();
  }

  /* ===== Estatísticas ===== */
  function tabPilotos() {
    const ov = new Map();
    const bump = (i, k) => { const v = ov.get(i) || [0, 0]; v[k]++; ov.set(i, v); };
    for (const e of meta.events.filter(z => z.code === 'OVTK')) { bump(e.cars[0], 0); bump(e.cars[1], 1); }
    const rows = withLaps.map(x => {
      const b = best(x);
      const clean = x.laps.filter(l => l.valid && !l.pit && l.n > 1 && b && l.ms <= b.ms * 1.07);
      const mean = avg(clean.map(l => l.ms));
      const sd = clean.length > 2 ? Math.sqrt(avg(clean.map(l => (l.ms - mean) ** 2))) : null;
      const sum = (k) => avg(x.laps.filter(l => l[k] != null).map(l => l[k]));
      return { x, mean, sd, full: sum('full'), brk: sum('brk'), o: ov.get(x.idx) || [0, 0] };
    });
    const minMean = Math.min(...rows.map(rw => rw.mean || Infinity));
    body.innerHTML = String(html`
      <section class="block"><h2>Estatísticas dos pilotos</h2>
        <div class="table-scroll"><table class="tbl"><thead><tr><th>Piloto</th><th class="num">Melhor volta</th><th class="num">Ritmo médio</th><th class="num" title="Desvio padrão das voltas limpas: quanto menor, mais constante">Constância (±s)</th><th class="num">V. máx</th><th class="num">Acel. pleno</th><th class="num">Freando</th>${kind === 'race' ? html`<th class="num">Ultrap. +/−</th><th class="num">Punição</th>` : ''}</tr></thead>
        <tbody>${rows.map(rw => html`<tr><td><span class="team-dot" style="--tc:${styles.get(rw.x.idx).color}"></span>${nameOf(rw.x)}</td>
          <td class="num ${rw.x.bestLapMs === bestOverall ? 'purple' : ''}">${fmtLap(rw.x.bestLapMs)}</td>
          <td class="num ${rw.mean === minMean ? 'purple' : ''}">${rw.mean ? fmtLap(Math.round(rw.mean)) : '—'}${rw.mean && rw.mean !== minMean ? html` <small class="muted">+${((rw.mean - minMean) / 1000).toFixed(2)}</small>` : ''}</td>
          <td class="num">${rw.sd != null ? f1(rw.sd / 1000, 2) : '—'}</td><td class="num">${rw.x.topSpeed || '—'}</td>
          <td class="num">${rw.full != null ? Math.round(rw.full) + '%' : '—'}</td><td class="num">${rw.brk != null ? Math.round(rw.brk) + '%' : '—'}</td>
          ${kind === 'race' ? html`<td class="num">${rw.o[0]} / ${rw.o[1]}</td><td class="num">${rw.x.penaltySec ? '+' + rw.x.penaltySec + 's' : ''}</td>` : ''}</tr>`)}</tbody></table></div>
        <p class="muted small-note">Ritmo médio e constância usam só voltas válidas, sem box, fora a volta 1 e até 107% da melhor.</p></section>`);
  }

  /* ===== Navegação interna ===== */
  const show = () => {
    $$('#tel-tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === S.tab));
    ({ voltas: tabVoltas, comparar: tabComparar, carro: tabCarro, eventos: tabEventos, pilotos: tabPilotos }[S.tab])();
  };
  $$('#tel-tabs a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); S.tab = a.dataset.tab; show(); }));
  let rz;
  const onResize = () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!$('#tel-body')) { window.removeEventListener('resize', onResize); return; }
      if (S.tab === 'voltas') drawVoltas(); else if (S.tab === 'comparar') drawComparar(); else if (S.tab === 'carro') drawCarro();
    }, 200);
  };
  window.addEventListener('resize', onResize);
  show();
}
