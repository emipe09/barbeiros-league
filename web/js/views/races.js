/* Calendário da temporada e página de cada corrida. */

import { html, fmtPts } from '../util.js';
import { champ, findRace, teamColor, team, store } from '../data.js';
import { fmtLap } from '../telemetry-charts.js';

export function renderRaces(main) {
  const c = champ();
  if (!c) { main.innerHTML = '<section class="empty"><h1>Nenhuma temporada</h1></section>'; return; }
  const nextId = c.races.find(r => !r.done)?.id;
  main.innerHTML = String(html`
    <section class="block">
      <div class="block-head"><h1 class="page-title">Calendário: ${c.name}</h1></div>
      <ol class="race-list">
        ${c.races.map(r => {
          const win = r.results.find(x => x.pos === 1);
          const pole = r.results.find(x => x.pole);
          const state = r.done ? 'done' : (r.id === nextId && c.status !== 'finished' ? 'next' : 'todo');
          return html`<li class="race-row ${state}">
            <a href="#/corrida/${r.id}">
              <span class="rr-round">${r.round}</span>
              <span class="rr-flag">${r.flag || '🏁'}</span>
              <span class="rr-name"><b>${r.name}</b><small>${r.circuit || r.country}${r.isSprint ? ' | sprint' : ''}</small></span>
              <span class="rr-result">${r.done && win
                ? html`<span class="rr-win" style="--tc:${teamColor(win.teamId)}">${win.name}</span>${pole ? html`<small>Pole: ${pole.name}</small>` : ''}`
                : html`<span class="rr-state">${state === 'next' ? 'Próxima' : 'A disputar'}</span>`}</span>
            </a></li>`;
        })}
      </ol>
    </section>`);
}

export function renderRace(main, raceId) {
  const found = findRace(raceId);
  if (!found) { main.innerHTML = '<section class="empty"><h1>Corrida não encontrada</h1><p><a href="#/corridas">Voltar ao calendário</a></p></section>'; return; }
  const { champ: c, race: r } = found;
  const idx = c.races.findIndex(x => x.id === r.id);
  const prev = c.races[idx - 1]; const next = c.races[idx + 1];
  const pole = r.results.find(x => x.pole);
  const fl = r.results.find(x => x.fl);
  const hasSprint = r.isSprint || r.results.some(x => x.sprintPos != null);
  const top3 = [2, 1, 3].map(p => r.results.find(x => x.pos === p)).filter(Boolean);

  main.innerHTML = String(html`
    <nav class="crumbs"><a href="#/corridas">${c.name}</a> <span aria-hidden="true">/</span> Etapa ${r.round}</nav>
    <section class="race-hero">
      <span class="race-flag">${r.flag || '🏁'}</span>
      <div>
        <h1 class="page-title">${r.name}</h1>
        <p class="muted">${r.circuit || ''}${r.circuit ? ', ' : ''}${r.country}${r.isSprint ? '. Fim de semana com sprint.' : ''}</p>
      </div>
    </section>

    ${r.done ? html`
      <section class="podium" aria-label="Pódio">
        ${top3.map(x => html`<a class="pod p${x.pos}" href="#/piloto/${x.driverId}" style="--tc:${teamColor(x.teamId)}">
          <span class="pod-name">${x.name}</span><span class="pod-team">${team(x.teamId)?.name || ''}</span>
          <span class="pod-block"><span class="pod-pos">${x.pos}</span></span></a>`)}
      </section>
      <div class="race-facts">
        ${pole ? html`<p><i class="mk pole"></i> Pole: <a href="#/piloto/${pole.driverId}">${pole.name}</a></p>` : ''}
        ${fl ? html`<p><i class="mk fl"></i> Volta mais rápida: <a href="#/piloto/${fl.driverId}">${fl.name}</a></p>` : ''}
      </div>
      ${store.league.telemetry?.[r.id] ? html`<p class="race-facts"><a class="btn sm" href="#/telemetria/${r.id}">Ver telemetria desta corrida</a></p>` : ''}
      ${r.quali.length ? html`<section class="block">
        <h2>Classificação (grid)</h2>
        <div class="table-scroll"><table class="tbl">
          <thead><tr><th class="pos">Pos</th><th>Piloto</th><th>Equipe</th><th class="num">Melhor volta</th><th class="num">Diferença</th></tr></thead>
          <tbody>${r.quali.map(x => html`<tr>
            <td class="pos">${x.pos}</td>
            <td><a href="#/piloto/${x.driverId}">${x.name}</a></td>
            <td><span class="team-dot" style="--tc:${teamColor(x.teamId)}"></span>${team(x.teamId)?.name || ''}</td>
            <td class="num">${x.ms ? fmtLap(x.ms) : ''}</td>
            <td class="num">${x.ms && r.quali[0].ms && x.pos > 1 ? '+' + ((x.ms - r.quali[0].ms) / 1000).toFixed(3) : ''}</td></tr>`)}</tbody>
        </table></div>
      </section>` : ''}
      <section class="block">
        <h2>Classificação final</h2>
        <div class="table-scroll"><table class="tbl">
          <thead><tr><th class="pos">Pos</th><th>Piloto</th><th>Equipe</th>${hasSprint ? html`<th class="num">Sprint</th>` : ''}<th class="num">Pts</th></tr></thead>
          <tbody>${r.results.map(x => html`<tr>
            <td class="pos ${x.pos == null ? 'out' : ''}">${x.pos ?? x.status}</td>
            <td><a href="#/piloto/${x.driverId}">${x.name}</a>${x.pole ? html` <i class="mk pole" title="Pole"></i>` : ''}${x.fl ? html` <i class="mk fl" title="Volta mais rápida"></i>` : ''}${x.isReserve ? html` <small class="muted">reserva</small>` : ''}</td>
            <td><span class="team-dot" style="--tc:${teamColor(x.teamId)}"></span>${team(x.teamId)?.name || ''}</td>
            ${hasSprint ? html`<td class="num">${x.sprintPos ? 'S' + x.sprintPos : ''}</td>` : ''}
            <td class="num"><b>${x.pts ? fmtPts(x.pts) : ''}</b></td></tr>`)}</tbody>
        </table></div>
      </section>` : html`
      <section class="empty small"><p>Essa corrida ainda não foi disputada.</p>
      ${store.session.canEdit ? html`<a class="btn primary" href="#/admin/resultados/${r.id}">Lançar resultado</a>` : ''}</section>`}

    <nav class="pager">
      ${prev ? html`<a href="#/corrida/${prev.id}" class="btn ghost">← ${prev.flag} ${prev.name}</a>` : html`<span></span>`}
      ${next ? html`<a href="#/corrida/${next.id}" class="btn ghost">${next.flag} ${next.name} →</a>` : ''}
    </nav>
    ${store.session.canEdit && r.done ? html`<p class="admin-link"><a href="#/admin/resultados/${r.id}">Editar resultado desta corrida</a> | <a href="#/admin/classificacao/${r.id}">Editar classificação</a></p>` : ''}
  `);
}
