/* Perfil do piloto: carreira em todas as temporadas. */

import { html, fmtPts, cellClass, initials } from '../util.js';
import { store, driver, teamColor } from '../data.js';

export function renderDriver(main, id) {
  const d = driver(id);
  const hist = store.league.history.drivers.find(x => x.driverId === id);
  if (!d) { main.innerHTML = '<section class="empty"><h1>Piloto não encontrado</h1></section>'; return; }

  const seasons = store.league.championships
    .map(c => ({ c, s: c.standings.find(x => x.id === id) }))
    .filter(x => x.s)
    .reverse();
  const latest = seasons[0];
  const color = latest ? latest.s.teamColor : '#8a8f98';
  const titles = store.league.history.champions.filter(ch => ch.driver?.id === id);

  const tiles = [
    ['Títulos', hist?.titles || 0],
    ['Vitórias', hist?.wins || 0],
    ['Pódios', hist?.podiums || 0],
    ['Poles', hist?.poles || 0],
    ['Voltas rápidas', hist?.fastestLaps || 0],
    ['Corridas', hist?.races || 0],
    ['Pontos', fmtPts(hist?.points || 0)],
    ['Melhor resultado', hist?.bestFinish ? 'P' + hist.bestFinish : '—'],
  ];

  main.innerHTML = String(html`
    <section class="driver-hero" style="--tc:${color}">
      <span class="avatar" aria-hidden="true">${initials(d.name)}</span>
      <div>
        <h1 class="page-title">${d.name}</h1>
        <p class="muted">${latest ? html`${latest.s.teamName || 'Sem equipe'}${latest.s.isReserve ? ' (reserva)' : ''} em ${latest.c.name}` : 'Ainda sem corridas'}</p>
        ${titles.length ? html`<p class="titles">${titles.map(t => html`<span class="title-badge">Título: ${t.name}</span>`)}</p>` : ''}
      </div>
    </section>

    <section class="tiles">${tiles.map(([l, v]) => html`<div class="tile"><span class="tile-v">${v}</span><span class="tile-l">${l}</span></div>`)}</section>

    <section class="block">
      <h2>Temporada a temporada</h2>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Temporada</th><th>Equipe</th><th class="num">Pos</th><th class="num">Pts</th><th class="num">V</th><th class="num">Pód</th><th class="num">Pol</th><th class="num">Média</th></tr></thead>
        <tbody>${seasons.map(({ c, s }) => html`<tr>
          <td><a href="#/temporada/${c.id}">${c.name}</a>${c.status !== 'finished' ? html` <small class="live">em andamento</small>` : ''}</td>
          <td><span class="team-dot" style="--tc:${s.teamColor}"></span>${s.teamName || ''}</td>
          <td class="num"><b>${s.position}º</b></td><td class="num">${fmtPts(s.points)}</td>
          <td class="num">${s.wins}</td><td class="num">${s.podiums}</td><td class="num">${s.poles}</td>
          <td class="num">${s.avgFinish != null ? s.avgFinish.toFixed(1).replace('.', ',') : '—'}</td></tr>`)}</tbody>
      </table></div>
    </section>

    ${seasons.map(({ c, s }) => html`
      <section class="block">
        <h2>${c.name}: corrida a corrida</h2>
        <ol class="strip">${c.races.map(r => {
          const x = s.perRace[r.id];
          return html`<li class="cell ${r.done || x ? cellClass(x) : 'c-future'}"><a href="#/corrida/${r.id}" title="${r.name}">
            <span class="flag">${r.flag || '🏁'}</span><b>${x ? (x.pos ?? x.status) : ''}</b><small>${x && x.pts ? '+' + fmtPts(x.pts) : ''}</small></a></li>`;
        })}</ol>
      </section>`)}
  `);
}

export function teamColorOf(id) { return teamColor(id); }
