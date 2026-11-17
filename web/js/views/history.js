/* Hall da fama: campeões de cada temporada, ranking de todos os tempos e recordes. */

import { html, fmtPts, $, $$, esc } from '../util.js';
import { store } from '../data.js';

const COLS = [
  ['titles', 'Títulos'], ['points', 'Pts'], ['wins', 'V'], ['podiums', 'Pód'],
  ['poles', 'Pol'], ['fastestLaps', 'VR'], ['races', 'Corridas'], ['seasons', 'Temp.'],
];

export function renderHistory(main) {
  const h = store.league.history;
  main.innerHTML = String(html`
    <h1 class="page-title">Hall da fama</h1>

    <section class="block">
      <h2>Campeões</h2>
      ${h.champions.length ? html`<ol class="champions">${h.champions.map(ch => html`<li>
        <a class="champ-card" href="#/temporada/${ch.championshipId}">
          <span class="champ-season">${ch.name}</span>
          <span class="champ-driver" style="--tc:${ch.driver?.teamColor || '#888'}">${ch.driver?.name || '—'}</span>
          <span class="champ-detail">${ch.driver ? `${fmtPts(ch.driver.points)} pts, ${ch.driver.wins} vitórias` : ''}${ch.runnerUp ? `. Vice: ${ch.runnerUp.name} (${fmtPts(ch.runnerUp.points)})` : ''}</span>
          ${ch.team ? html`<span class="champ-team"><span class="team-dot" style="--tc:${ch.team.color}"></span>Construtores: ${ch.team.name} (${fmtPts(ch.team.points)} pts)</span>` : ''}
        </a></li>`)}</ol>` : html`<p class="muted">Nenhuma temporada finalizada ainda.</p>`}
    </section>

    ${h.records.length ? html`<section class="block">
      <h2>Recordes</h2>
      <div class="records">${h.records.map(r => html`<a class="record" href="#/piloto/${r.driverId}">
        <span class="rec-v">${fmtPts(r.value)}</span>
        <span class="rec-l">${r.label}</span>
        <span class="rec-who">${r.name}${r.season ? `, ${r.season}` : ''}</span></a>`)}</div>
    </section>` : ''}

    <section class="block">
      <div class="block-head"><h2>Pilotos de todos os tempos</h2><p class="hint">Clique no título de uma coluna para ordenar.</p></div>
      <div id="alltime"></div>
    </section>

    <section class="block">
      <h2>Equipes de todos os tempos</h2>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Equipe</th><th class="num">Títulos</th><th class="num">Pts</th><th class="num">V</th><th class="num">Pód</th><th class="num">Temp.</th></tr></thead>
        <tbody>${h.teams.map(t => html`<tr><td><span class="team-dot" style="--tc:${t.color}"></span>${t.name}</td>
          <td class="num"><b>${t.titles || ''}</b></td><td class="num">${fmtPts(t.points)}</td><td class="num">${t.wins}</td><td class="num">${t.podiums}</td><td class="num">${t.seasons}</td></tr>`)}</tbody>
      </table></div>
    </section>
  `);

  let sortKey = 'titles';
  const draw = () => {
    const rows = [...h.drivers].sort((a, b) => (b[sortKey] - a[sortKey]) || (b.points - a.points) || a.name.localeCompare(b.name));
    $('#alltime').innerHTML = `<div class="table-scroll"><table class="tbl sortable">
      <thead><tr><th class="pos">#</th><th>Piloto</th>${COLS.map(([k, l]) => `<th class="num"><button data-k="${k}" class="${k === sortKey ? 'on' : ''}" aria-sort="${k === sortKey ? 'descending' : 'none'}">${l}</button></th>`).join('')}</tr></thead>
      <tbody>${rows.map((d, i) => `<tr><td class="pos">${i + 1}</td><td><a href="#/piloto/${esc(d.driverId)}">${esc(d.name)}</a></td>
        ${COLS.map(([k]) => `<td class="num ${k === sortKey ? 'sorted' : ''}">${k === 'titles' ? (d[k] || '') : fmtPts(d[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    $$('#alltime th button').forEach(b => b.addEventListener('click', () => { sortKey = b.dataset.k; draw(); }));
  };
  draw();
}
