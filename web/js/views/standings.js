/* Página inicial: classificação da temporada selecionada. */

import { html, raw, esc, cellClass, fmtPts, plural, $, $$ } from '../util.js';
import { champ, teamColor, store } from '../data.js';
import { lineChart } from '../charts.js';

export function renderStandings(main) {
  const c = champ();
  if (!c) { main.innerHTML = emptyLeague(); return; }

  const done = c.races.filter(r => r.done);
  const next = c.races.find(r => !r.done);
  const last = done[done.length - 1];
  const [p1, p2] = c.standings;
  const finished = c.status === 'finished';

  main.innerHTML = String(html`
    <section class="hero">
      <div class="hero-main">
        <p class="hero-kicker">${finished ? `Campeão de ${c.name}` : `Líder após ${plural(done.length, 'etapa', 'etapas')} de ${c.races.length}`}</p>
        ${p1 ? html`
          <h1 class="hero-name"><a href="#/piloto/${p1.id}">${p1.name}</a></h1>
          <p class="hero-meta">
            <span class="team-tag" style="--tc:${p1.teamColor}">${p1.teamName || 'Sem equipe'}</span>
            <span class="hero-pts"><b>${fmtPts(p1.points)}</b> pts</span>
            ${p2 ? html`<span class="hero-gap">${p1.points - p2.points === 0 ? 'empatado com' : `+${fmtPts(p1.points - p2.points)} sobre`} <a href="#/piloto/${p2.id}">${p2.name}</a></span>` : ''}
          </p>` : html`<h1 class="hero-name">Temporada sem resultados</h1>`}
        ${progressBar(c)}
      </div>
      <div class="hero-side">
        ${next && !finished ? raceMini('Próxima corrida', next, c) : ''}
        ${last ? podiumCard(last) : ''}
      </div>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>Pilotos</h2>
        <p class="hint">Toque numa célula para ver a corrida. <span class="legend-inline">${raw(legendCells())}</span></p>
      </div>
      ${raw(driversMatrix(c))}
    </section>

    <div class="two-col">
      <section class="block">
        <div class="block-head"><h2>Construtores</h2></div>
        ${raw(constructorsList(c))}
      </section>
      <section class="block">
        <div class="block-head">
          <h2>Evolução dos pontos</h2>
          <div class="seg" role="tablist" aria-label="Tipo de gráfico">
            <button class="seg-btn on" data-mode="drivers" role="tab" aria-selected="true">Pilotos</button>
            <button class="seg-btn" data-mode="teams" role="tab" aria-selected="false">Construtores</button>
          </div>
        </div>
        <div id="evo-chips" class="chips"></div>
        <div id="evo-chart" class="chart-host"></div>
      </section>
    </div>
  `);

  setupChart(c);
}

function emptyLeague() {
  return String(html`<section class="empty"><h1>Nenhuma temporada ainda</h1>
    <p>Quando o admin criar a primeira temporada, a classificação aparece aqui.</p>
    ${store.session.canEdit ? html`<a class="btn primary" href="#/admin/temporadas">Criar temporada</a>` : ''}</section>`);
}

export function progressBar(c) {
  const total = c.races.length || 1;
  return html`<ol class="progress" aria-label="Etapas da temporada">${c.races.map(r =>
    html`<li class="${r.done ? 'done' : ''}" title="${r.round}. ${r.name}"><a href="#/corrida/${r.id}"><span class="sr">${r.name}</span></a></li>`)}</ol>
    <p class="progress-lbl">${c.doneCount} de ${total} corridas disputadas</p>`;
}

function raceMini(title, r, c) {
  return html`<a class="side-card" href="#/corrida/${r.id}">
    <span class="side-title">${title}</span>
    <span class="side-race"><span class="flag">${r.flag || '🏁'}</span><span><b>${r.name}</b><small>Etapa ${r.round} de ${c.races.length}${r.isSprint ? ', com sprint' : ''}</small></span></span>
  </a>`;
}

function podiumCard(r) {
  const top = r.results.filter(x => x.pos != null && x.pos <= 3);
  return html`<a class="side-card" href="#/corrida/${r.id}">
    <span class="side-title">Última corrida: ${r.flag || ''} ${r.name}</span>
    <ol class="mini-podium">${top.map(x => html`<li class="m${x.pos}"><span class="medal">${x.pos}</span><span class="nm" style="--tc:${teamColor(x.teamId)}">${x.name}</span><span class="pt">${fmtPts(x.pts)}</span></li>`)}</ol>
  </a>`;
}

function legendCells() {
  return [['c-p1', '1º'], ['c-p2', '2º'], ['c-p3', '3º'], ['c-pts', 'Pontuou'], ['c-fin', 'Sem pontos'], ['c-dnf', 'Abandono']]
    .map(([k, l]) => `<span class="lg"><i class="cell ${k}"></i>${l}</span>`).join('')
    + '<span class="lg"><i class="mk pole"></i>Pole</span><span class="lg"><i class="mk fl"></i>Volta rápida</span>';
}

export function driversMatrix(c, { compact = false } = {}) {
  const races = c.races;
  const head = races.map(r => `<th class="rc" scope="col" title="${esc(r.name)}"><a href="#/corrida/${r.id}"><span class="flag">${r.flag || '🏁'}</span><span class="rc-n">${r.round}</span></a></th>`).join('');
  const rows = c.standings.map(s => {
    const cells = compact ? '' : races.map(r => {
      const x = s.perRace[r.id];
      if (!r.done && !x) return '<td class="cell c-future"></td>';
      const lbl = x ? (x.pos != null ? x.pos : x.status) : '';
      const marks = x ? `${x.pole ? '<i class="mk pole" title="Pole"></i>' : ''}${x.fl ? '<i class="mk fl" title="Volta mais rápida"></i>' : ''}` : '';
      const title = x ? `${r.name}: ${x.pos != null ? 'P' + x.pos : x.status}${x.sprintPos ? `, sprint S${x.sprintPos}` : ''}, ${x.pts} pts` : `${r.name}: não correu`;
      return `<td class="cell ${cellClass(x)}"><a href="#/corrida/${r.id}" title="${esc(title)}">${esc(lbl)}${marks}</a></td>`;
    }).join('');
    return `<tr class="${s.isReserve ? 'is-res' : ''}">
      <td class="pos">${s.position}</td>
      <th scope="row" class="drv"><a href="#/piloto/${s.id}"><span class="stripe" style="--tc:${s.teamColor}"></span><span class="drv-name">${esc(s.name)}</span><small>${esc(s.teamName || '')}${s.isReserve ? ' (reserva)' : ''}</small></a></th>
      <td class="num pts">${fmtPts(s.points)}</td>
      <td class="num hide-xs">${s.wins}</td><td class="num hide-xs">${s.podiums}</td><td class="num hide-sm">${s.poles}</td>
      ${cells}</tr>`;
  }).join('');
  return `<div class="matrix-scroll"><table class="matrix">
    <thead><tr><th class="pos" scope="col"><abbr title="Posição">#</abbr></th><th class="drv" scope="col">Piloto</th>
    <th class="num" scope="col"><abbr title="Pontos">Pts</abbr></th><th class="num hide-xs" scope="col"><abbr title="Vitórias">V</abbr></th>
    <th class="num hide-xs" scope="col"><abbr title="Pódios">Pód</abbr></th><th class="num hide-sm" scope="col"><abbr title="Poles">Pol</abbr></th>
    ${compact ? '' : head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function constructorsList(c) {
  if (!c.constructors.length) return '<p class="muted">Nenhuma equipe nesta temporada.</p>';
  const max = Math.max(1, c.constructors[0].points);
  const nameOf = (id) => c.standings.find(s => s.id === id)?.name || store.league.drivers.find(d => d.id === id)?.name || '';
  return `<ol class="ctor-list">${c.constructors.map(t => `
    <li>
      <span class="pos">${t.position}</span>
      <span class="ctor-body">
        <span class="ctor-top"><b>${esc(t.name)}</b><span class="ctor-pts">${fmtPts(t.points)} <small>pts</small></span></span>
        <span class="bar"><i style="width:${(t.points / max) * 100}%;background:${t.color}"></i></span>
        <small class="muted">${esc(t.lineup.map(nameOf).filter(Boolean).join(', '))}${t.wins ? ` | ${plural(t.wins, 'vitória', 'vitórias')}` : ''}</small>
      </span>
    </li>`).join('')}</ol>`;
}

function setupChart(c) {
  const host = $('#evo-chart');
  const chipsHost = $('#evo-chips');
  if (!host) return;
  const done = c.races.filter(r => r.done);
  if (!done.length) { host.innerHTML = '<p class="muted">O gráfico aparece depois da primeira corrida.</p>'; return; }
  let mode = 'drivers';
  let hidden = new Set();

  const build = () => {
    const labels = ['Início', ...done.map(r => `${r.flag || ''} ${r.round}`)];
    let all;
    if (mode === 'drivers') {
      const seenTeam = new Map();
      all = c.standings.map(s => {
        const k = s.teamId || s.id;
        const dashed = seenTeam.has(k); seenTeam.set(k, true);
        return { id: s.id, name: s.name, color: s.teamColor, dashed, values: [0, ...done.map(r => s.cumByRace[r.id] ?? null)] };
      });
      if (!hidden.size && all.length > 6) all.slice(6).forEach(s => hidden.add(s.id));
    } else {
      all = c.constructors.map(t => ({ id: t.id, name: t.name, color: t.color, values: [0, ...done.map(r => t.cumByRace[r.id] ?? null)] }));
    }
    chipsHost.innerHTML = all.map(s => `<button class="chip ${hidden.has(s.id) ? 'off' : ''}" data-id="${esc(s.id)}" aria-pressed="${!hidden.has(s.id)}"><i style="background:${s.color}" class="${s.dashed ? 'dash' : ''}"></i>${esc(s.name)}</button>`).join('');
    lineChart(host, { labels, series: all.filter(s => !hidden.has(s.id)) });
  };

  chipsHost.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const id = b.dataset.id;
    hidden.has(id) ? hidden.delete(id) : hidden.add(id);
    if (hidden.size === 0) hidden.add('__none__');
    build();
  });
  $$('.seg-btn').forEach(b => b.addEventListener('click', () => {
    $$('.seg-btn').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
    mode = b.dataset.mode; hidden = new Set(); build();
  }));
  build();
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => document.body.contains(host) && build(), 150); }, { passive: true });
}
