/* Gráficos de telemetria em SVG puro (sem bibliotecas).
   - lineChart: séries por volta (tempos, posições, desgaste...)
   - tracePanels: painéis empilhados por distância (velocidade, freio...) com cursor único
   - trackMap: traçado da pista colorido pela velocidade */

import { esc } from './util.js';

const nice = (raw) => {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1e-9, raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
};
export const fmtLap = (ms) => {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000); const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};
export const fmtSec = (ms) => (ms / 1000).toFixed(3);

/** Gráfico de linhas por volta. series: [{name,color,dashed,values:[...por volta]}], labels: números das voltas.
    opts: {height, invert (posição: 1 em cima), yFmt, yMin, yMax, clip (marca valores acima de yMax), aria} */
export function lineChart(host, { labels, series, height = 300, invert = false, tipAsc = false, yFmt = (v) => v, yMin, yMax, clip = false, aria = 'Gráfico' }) {
  const W = Math.max(320, host.clientWidth || 720); const H = height;
  const m = { t: 14, r: W < 520 ? 12 : 16, b: 30, l: 56 };
  const iw = W - m.l - m.r; const ih = H - m.t - m.b;
  const all = series.flatMap(s => s.values.filter(v => v != null && Number.isFinite(v)));
  if (!all.length) { host.innerHTML = '<p class="muted">Sem dados para este gráfico.</p>'; return; }
  let lo = yMin != null ? yMin : Math.min(...all); let hi = yMax != null ? yMax : Math.max(...all);
  if (hi - lo < 1e-9) { hi = lo + 1; }
  const step = nice((hi - lo) / 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const n = labels.length;
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => { const t = (v - lo) / (hi - lo); return m.t + (invert ? t : 1 - t) * ih; };
  let g = '';
  for (let v = lo; v <= hi + 1e-9; v += step) {
    g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${m.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(yFmt(v))}</text>`;
  }
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 34)));
  labels.forEach((l, i) => { if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 10}" class="tick" text-anchor="middle">${esc(l)}</text>`; });
  let lines = '';
  for (const s of series) {
    let seg = [];
    const flush = () => { if (seg.length > 1) lines += `<polyline points="${seg.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`; else if (seg.length === 1) { const [px, py] = seg[0].split(','); lines += `<circle cx="${px}" cy="${py}" r="2.5" fill="${s.color}"/>`; } seg = []; };
    s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) { flush(); return; }
      if (clip && yMax != null && v > yMax) { flush(); lines += `<path d="M${x(i) - 4},${m.t + 8} l4,-7 l4,7z" fill="${s.color}" opacity=".7"/>`; return; }
      seg.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    flush();
  }
  host.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(aria)}">
    <g>${g}</g><g>${lines}</g>
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <rect class="hit" x="${m.l - 6}" y="${m.t}" width="${iw + 12}" height="${ih}" fill="transparent"/></svg><div class="tip" hidden></div></div>`;
  const svg = host.querySelector('svg'); const tip = host.querySelector('.tip'); const cross = host.querySelector('.cross');
  const move = (cx) => {
    const rect = svg.getBoundingClientRect();
    const px = ((cx - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const rows = series.map(s => ({ s, v: s.values[i] })).filter(r => r.v != null && Number.isFinite(r.v)).sort((a, b) => (invert || tipAsc ? a.v - b.v : b.v - a.v));
    tip.innerHTML = `<b>Volta ${esc(labels[i])}</b>` + rows.map(r => `<div class="tip-row"><i style="background:${r.s.color}"></i><span>${esc(r.s.name)}</span><b>${esc(yFmt(r.v))}</b></div>`).join('');
    tip.hidden = false;
    const left = (x(i) / W) * rect.width;
    tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
  };
  const hit = host.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => move(e.clientX)); hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

/** Painéis empilhados com o mesmo eixo X (distância na volta, em metros).
    panels: [{title, unit, height, series:[{name,color,dashed,values}], min, max, step?: true (degraus, p/ marcha)}]
    onCursor(i|null) avisa o mapa da pista. */
export function tracePanels(host, { length, panels, onCursor }) {
  const W = Math.max(320, host.clientWidth || 720);
  const m = { l: 52, r: 14, t: 6, gap: 22, b: 26 };
  const iw = W - m.l - m.r;
  const total = panels.reduce((a, p) => a + p.height + m.gap, 0) - m.gap;
  const H = m.t + total + m.b;
  const N = panels[0].series[0].values.length;
  const x = (i) => m.l + (i / (N - 1)) * iw;
  let top = m.t; let body = '';
  const geo = panels.map((p) => {
    const vals = p.series.flatMap(s => s.values).filter(Number.isFinite);
    let lo = p.min != null ? p.min : Math.min(...vals); let hi = p.max != null ? p.max : Math.max(...vals);
    if (hi - lo < 1e-9) hi = lo + 1;
    const pad = p.min == null ? (hi - lo) * 0.06 : 0; lo -= pad; if (p.max == null) hi += pad;
    const o = { top, h: p.height, lo, hi };
    top += p.height + m.gap; return o;
  });
  panels.forEach((p, k) => {
    const { top: t0, h, lo, hi } = geo[k];
    const y = (v) => t0 + h - ((v - lo) / (hi - lo)) * h;
    const ticks = p.ticks || [lo, (lo + hi) / 2, hi].map(v => Math.round(v * 10) / 10);
    body += `<text x="${m.l}" y="${t0 - 0}" class="ptitle" dy="-1" style="display:none">${esc(p.title)}</text>`;
    body += `<rect x="${m.l}" y="${t0}" width="${iw}" height="${h}" class="pbg"/>`;
    for (const v of ticks) body += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${m.l - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(p.fmt ? p.fmt(v) : v)}</text>`;
    body += `<text x="${m.l + 6}" y="${t0 + 13}" class="ptag">${esc(p.title)}${p.unit ? ' (' + esc(p.unit) + ')' : ''}</text>`;
    if (p.zero != null) body += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(p.zero)}" y2="${y(p.zero)}" class="zero"/>`;
    for (const s of p.series) {
      let d = '';
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      });
      body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
    }
  });
  const step = nice(length / 6);
  for (let d = 0; d <= length; d += step) body += `<text x="${m.l + (d / length) * iw}" y="${H - 8}" class="tick" text-anchor="middle">${d >= 1000 ? (d / 1000).toFixed(d % 1000 ? 1 : 0) + ' km' : d + ' m'}</text>`;
  host.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Telemetria por distância">${body}
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip" hidden></div></div>`;
  const svg = host.querySelector('svg'); const tip = host.querySelector('.tip'); const cross = host.querySelector('.cross');
  const move = (cx) => {
    const rect = svg.getBoundingClientRect();
    const px = ((cx - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(N - 1, Math.round(((px - m.l) / iw) * (N - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const dist = Math.round((i / (N - 1)) * length);
    tip.innerHTML = `<b>${dist} m</b>` + panels.map(p => p.series.map(s => `<div class="tip-row"><i style="background:${s.color}"></i><span>${esc(s.name)} · ${esc(p.title)}</span><b>${esc(p.fmt ? p.fmt(s.values[i]) : Math.round(s.values[i] * 10) / 10)}${p.unit ? ' ' + esc(p.unit) : ''}</b></div>`).join('')).join('');
    tip.hidden = false;
    const left = (x(i) / W) * rect.width;
    tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
    if (onCursor) onCursor(i);
  };
  const hit = host.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => move(e.clientX)); hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); if (onCursor) onCursor(null); });
}

/** Mapa da pista: segmentos coloridos pela velocidade (azul = lento, vermelho = rápido).
    Devolve { setCursor(i) } para sincronizar com os painéis. */
export function trackMap(host, { xs, zs, speeds, label }) {
  if (!xs || !xs.length) { host.innerHTML = '<p class="muted">Sem mapa para esta sessão.</p>'; return { setCursor() {} }; }
  const W = Math.max(260, Math.min(host.clientWidth || 420, 560)); const H = Math.round(W * 0.72);
  const pad = 16;
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minZ = Math.min(...zs); const maxZ = Math.max(...zs);
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = (W - (maxX - minX) * sc) / 2; const oz = (H - (maxZ - minZ) * sc) / 2;
  const px = (i) => ox + (xs[i] - minX) * sc; const pz = (i) => oz + (zs[i] - minZ) * sc;
  const vmin = Math.min(...speeds); const vmax = Math.max(...speeds);
  const color = (v) => { const t = (v - vmin) / ((vmax - vmin) || 1); return `hsl(${Math.round(220 - 220 * t)} 85% ${50 - 4 * Math.abs(t - 0.5)}%)`; };
  let segs = '';
  for (let i = 0; i < xs.length - 1; i++) segs += `<line x1="${px(i).toFixed(1)}" y1="${pz(i).toFixed(1)}" x2="${px(i + 1).toFixed(1)}" y2="${pz(i + 1).toFixed(1)}" stroke="${color((speeds[i] + speeds[i + 1]) / 2)}" stroke-width="4" stroke-linecap="round"/>`;
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Mapa da pista colorido pela velocidade${label ? ' de ' + esc(label) : ''}">${segs}
    <circle id="map-dot" r="6" fill="#fff" stroke="#111" stroke-width="2" visibility="hidden"/></svg>
    <div class="map-legend"><span>${Math.round(vmin)} km/h</span><i></i><span>${Math.round(vmax)} km/h</span></div>`;
  const dot = host.querySelector('#map-dot');
  return {
    setCursor(i) {
      if (i == null) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('cx', px(i)); dot.setAttribute('cy', pz(i)); dot.setAttribute('visibility', 'visible');
    },
  };
}
