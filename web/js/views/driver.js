/* Perfil do piloto: carreira em todas as temporadas. */

import { html, fmtPts, cellClass, initials } from '../util.js';
import { store, driver, teamColor, findRace } from '../data.js';

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
  const q = hist && hist.qCount ? hist : null;
  const qTiles = q ? [
    ['Grids registrados', q.qCount],
    ['Melhor classificação', 'P' + q.bestQuali],
    ['Grid médio', 'P' + q.avgQuali.toFixed(1).replace('.', ',')],
    ['Poles (P1 no grid)', q.qPoles],
    ['Top 3 no grid', q.qTop3],
    ['Top 5 no grid', q.qTop5],
  ] : [];
  const bestAt = q ? q.bestQualiAt.map(findRace).filter(Boolean) : [];
  const qSeasons = seasons.filter(x => x.c.qualiStats && x.c.qualiStats[id]);

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

    <section class="block">
      <h2>Histórico de classificação</h2>
      ${q ? html`
        <div class="tiles">${qTiles.map(([l, v]) => html`<div class="tile"><span class="tile-v">${v}</span><span class="tile-l">${l}</span></div>`)}</div>
        <p class="muted small-note">Melhor classificação: <b>P${q.bestQuali}</b> em ${bestAt.slice(0, 4).map((f, i) => html`${i ? ', ' : ''}<a href="#/corrida/${f.race.id}">${f.race.flag} ${f.race.name}</a> (${f.champ.name})`)}${bestAt.length > 4 ? ` e mais ${bestAt.length - 4}` : ''}.</p>
        <div class="table-scroll"><table class="tbl">
          <thead><tr><th>Temporada</th><th>Equipe</th><th class="num">Grids</th><th class="num">Grid médio</th><th class="num">Melhor</th><th class="num">P1</th><th class="num">Top 3</th><th class="num">Chegada média</th></tr></thead>
          <tbody>${qSeasons.map(({ c, s }) => { const qs = c.qualiStats[id]; return html`<tr>
            <td><a href="#/temporada/${c.id}">${c.name}</a></td>
            <td><span class="team-dot" style="--tc:${s.teamColor}"></span>${s.teamName || ''}</td>
            <td class="num">${qs.count}</td><td class="num">${(qs.sum / qs.count).toFixed(1).replace('.', ',')}</td>
            <td class="num"><b>P${qs.best}</b></td><td class="num">${qs.poles}</td><td class="num">${qs.top3}</td>
            <td class="num">${s.avgFinish != null ? s.avgFinish.toFixed(1).replace('.', ',') : '—'}</td></tr>`; })}</tbody>
        </table></div>`
      : html`<p class="muted">Ainda não há classificação registrada para este piloto. ${store.session.canEdit ? html`<a href="#/admin/classificacao">Cadastrar no admin</a>.` : ''}</p>`}
    </section>

    ${seasons.map(({ c, s }) => html`
      <section class="block">
        <h2>${c.name}: corrida a corrida</h2>
        <ol class="strip">${c.races.map(r => {
          const x = s.perRace[r.id];
          return html`<li class="cell ${r.done || x ? cellClass(x) : 'c-future'}"><a href="#/corrida/${r.id}" title="${r.name}">
            <span class="flag">${r.flag || '🏁'}</span><b>${x ? (x.pos ?? x.status) : ''}</b><small>${x && x.pts ? '+' + fmtPts(x.pts) : ''}</small></a></li>`;
        })}</ol>
        ${c.qualiStats?.[id] ? html`<h3 class="sub">Classificação (grid) em cada etapa</h3>
        <ol class="strip">${c.races.map(r => {
          const qp = c.qualiStats[id].perRace[r.id];
          return html`<li class="cell ${qp ? cellClass({ pos: qp }) : 'c-future'}"><a href="#/corrida/${r.id}" title="${r.name}">
            <span class="flag">${r.flag || '🏁'}</span><b>${qp ? 'P' + qp : ''}</b><small></small></a></li>`;
        })}</ol>` : ''}
      </section>`)}
  `);
}

export function teamColorOf(id) { return teamColor(id); }
