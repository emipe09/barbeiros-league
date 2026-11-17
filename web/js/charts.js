/* Gráfico de linhas em SVG (sem bibliotecas): evolução de pontos por etapa.
   Linhas finas de 2px, grade discreta, rótulo direto no fim de cada linha,
   cruz + tooltip ao passar o mouse/dedo. */

import { esc } from './util.js';

export function lineChart(host, { labels, series, height = 320 }) {
  const W = Math.max(320, host.clientWidth || 720);
  const H = height;
  const m = { t: 16, r: 120, b: 34, l: 40 };
  if (W < 520) m.r = 86;
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = labels.length;
  const maxY = Math.max(10, ...series.flatMap(s => s.values.filter(v => v != null)));
  const step = niceStep(maxY / 4);
  const yMax = Math.ceil(maxY / step) * step;
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - (v / yMax) * ih;

  let g = '';
  for (let v = 0; v <= yMax; v += step) {
    g += `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
    g += `<text x="${m.l - 8}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
  }
  const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
  labels.forEach((l, i) => {
    if (i % every === 0 || i === n - 1) g += `<text x="${x(i)}" y="${H - 12}" class="tick" text-anchor="middle">${esc(l)}</text>`;
  });

  // Rótulos diretos no fim das linhas, afastados para não colidir
  const ends = series.map(s => {
    let last = s.values.length - 1;
    while (last >= 0 && s.values[last] == null) last--;
    return { s, i: last, v: last >= 0 ? s.values[last] : 0 };
  }).filter(e => e.i >= 0).sort((a, b) => y(a.v) - y(b.v));
  let prevY = -Infinity;
  for (const e of ends) { e.ly = Math.max(y(e.v), prevY + 14); prevY = e.ly; }

  let lines = '';
  for (const s of series) {
    const pts = s.values.map((v, i) => (v == null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
    if (!pts.length) continue;
    lines += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 4"' : ''}/>`;
  }
  let labelsSvg = '';
  for (const e of ends) {
    labelsSvg += `<circle cx="${x(e.i)}" cy="${y(e.v)}" r="4" fill="${e.s.color}" class="dot-ring"/>`;
    labelsSvg += `<text x="${x(e.i) + 9}" y="${e.ly + 4}" class="end-label">${esc(short(e.s.name))} <tspan class="end-val">${e.v}</tspan></text>`;
  }

  host.innerHTML = `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Evolução de pontos por etapa">
    <g>${g}</g><g>${lines}</g><g>${labelsSvg}</g>
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <rect class="hit" x="${m.l - 10}" y="${m.t}" width="${iw + 20}" height="${ih}" fill="transparent"/>
  </svg><div class="tip" hidden></div></div>`;

  const svg = host.querySelector('svg');
  const tip = host.querySelector('.tip');
  const cross = host.querySelector('.cross');
  const move = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const rows = series.map(s => ({ s, v: s.values[i] })).filter(r => r.v != null).sort((a, b) => b.v - a.v);
    tip.innerHTML = `<b>${esc(labels[i])}</b>` + rows.map(r =>
      `<div class="tip-row"><i style="background:${r.s.color}"></i><span>${esc(r.s.name)}</span><b>${r.v}</b></div>`).join('');
    tip.hidden = false;
    const left = (x(i) / W) * rect.width;
    tip.style.left = Math.min(rect.width - tip.offsetWidth - 4, Math.max(4, left + 12)) + 'px';
  };
  const hit = host.querySelector('.hit');
  hit.addEventListener('pointermove', (e) => move(e.clientX));
  hit.addEventListener('pointerdown', (e) => move(e.clientX));
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

function short(name) {
  const p = String(name).split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : name;
}
function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}
