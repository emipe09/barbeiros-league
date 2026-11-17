/* Temporadas: criar, ativar, finalizar, excluir, pontuação e calendário. */

import { html, $, $$, toast, openDialog, confirmDialog } from '../util.js';
import { store, champ, admin, setChamp } from '../data.js';

export function renderSeasons(body, { reload }) {
  const L = store.league;
  const c = champ();
  const list = [...L.championships].reverse();

  body.innerHTML = String(html`
    <section class="admin-card">
      <div class="block-head"><h2>Temporadas</h2><button class="btn primary sm" id="btn-new">Nova temporada</button></div>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Ano</th><th>Situação</th><th class="num">Corridas</th><th></th></tr></thead>
        <tbody>${list.map(ch => html`<tr data-id="${ch.id}" class="${ch.id === c?.id ? 'selected' : ''}">
          <td><input name="name" value="${ch.name}" maxlength="60" aria-label="Nome" /></td>
          <td><input name="season" value="${ch.season || ''}" maxlength="10" size="6" aria-label="Ano" /></td>
          <td>${ch.status === 'finished' ? 'Finalizada' : (ch.id === L.activeChampionshipId ? html`<b class="live">Atual</b>` : 'Aberta')}</td>
          <td class="num">${ch.doneCount}/${ch.races.length}</td>
          <td><div class="actions">
            <button class="btn sm" data-act="save">Salvar</button>
            ${ch.id !== c?.id ? html`<button class="btn ghost sm" data-act="select">Editar esta</button>` : ''}
            ${ch.id !== L.activeChampionshipId ? html`<button class="btn ghost sm" data-act="activate">Tornar atual</button>` : ''}
            ${ch.status !== 'finished' ? html`<button class="btn ghost sm" data-act="finish">Finalizar</button>` : ''}
            <button class="btn danger sm" data-act="delete">Excluir</button>
          </div></td></tr>`)}</tbody>
      </table></div>
      <p class="muted">A temporada "atual" é a que abre primeiro no site. Finalizar registra o campeão no Hall da fama.</p>
    </section>

    ${c ? html`
    <section class="admin-card">
      <div class="block-head"><h2>Calendário de ${c.name}</h2>
        <form id="add-race" class="form-row">
          <select name="trackId" aria-label="Pista">${{ __raw: L.calendar.map(t => `<option value="${t.id}">${t.flag} ${t.name}</option>`).join('') }}</select>
          <button class="btn sm">Adicionar corrida</button>
        </form></div>
      <ol class="cal-edit">${c.races.map((r, i) => html`<li data-race="${r.id}">
        <span class="rr-round">${r.round}</span><span class="flag">${r.flag || '🏁'}</span>
        <span class="grow"><b>${r.name}</b> <small class="muted">${r.circuit}${r.done ? ' | com resultado' : ''}</small></span>
        <label class="check"><input type="checkbox" data-sprint ${r.isSprint ? 'checked' : ''} /> Sprint</label>
        <button class="btn ghost sm" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
        <button class="btn ghost sm" data-move="1" ${i === c.races.length - 1 ? 'disabled' : ''} aria-label="Descer">↓</button>
        <button class="btn danger sm" data-del-race>Remover</button></li>`)}</ol>
    </section>

    <section class="admin-card">
      <h2>Pontuação de ${c.name}</h2>
      <form id="pts-form" class="pts-form">
        <fieldset><legend>Corrida (P1 em diante)</legend><div class="pts-grid">${c.config.points.map((p, i) => html`<label>P${i + 1}<input type="number" min="0" step="1" name="p" value="${p}" /></label>`)}</div></fieldset>
        <fieldset><legend>Sprint (S1 em diante)</legend><div class="pts-grid">${c.config.sprintPoints.map((p, i) => html`<label>S${i + 1}<input type="number" min="0" step="1" name="s" value="${p}" /></label>`)}</div></fieldset>
        <div class="form-row">
          <label class="field">Pontos por volta rápida<input type="number" min="0" name="fl" value="${c.config.fastestLapPoint}" /></label>
          <label class="check"><input type="checkbox" name="top10" ${c.config.fastestLapTop10 ? 'checked' : ''} /> Só vale para quem terminar no top 10</label>
        </div>
        <p class="muted">Mudar a pontuação recalcula toda a classificação desta temporada.</p>
        <button class="btn primary">Salvar pontuação</button>
      </form>
    </section>` : ''}`);

  const run = async (fn, ok) => { try { await fn(); toast(ok); reload(); } catch (e) { toast(e.message, 'err'); } };

  $$('tr[data-id] [data-act]').forEach(b => b.addEventListener('click', async () => {
    const tr = b.closest('tr'); const id = tr.dataset.id; const ch = L.championships.find(x => x.id === id);
    const act = b.dataset.act;
    if (act === 'save') return run(() => admin('PUT', `/championships/${id}`, { name: tr.querySelector('[name=name]').value, season: tr.querySelector('[name=season]').value }), 'Temporada salva');
    if (act === 'select') { setChamp(id); return reload(); }
    if (act === 'activate') return run(() => admin('POST', `/championships/${id}/activate`), `${ch.name} agora é a temporada atual`);
    if (act === 'finish') {
      const lead = ch.standings[0];
      if (!await confirmDialog(`Finalizar ${ch.name}? ${lead ? `${lead.name} será registrado como campeão com ${lead.points} pts.` : ''}`, { okLabel: 'Finalizar temporada' })) return;
      return run(() => admin('POST', `/championships/${id}/finish`), 'Temporada finalizada');
    }
    if (act === 'delete') {
      if (!await confirmDialog(`Excluir ${ch.name} com todas as corridas e resultados? Uma cópia do banco é salva antes, mas a temporada some do site.`, { okLabel: 'Excluir temporada', danger: true })) return;
      return run(() => admin('DELETE', `/championships/${id}`), 'Temporada excluída');
    }
  }));

  if (c) {
    $('#add-race').addEventListener('submit', (e) => {
      e.preventDefault();
      const trackId = new FormData(e.target).get('trackId');
      const t = L.calendar.find(x => x.id === trackId);
      run(() => admin('POST', `/championships/${c.id}/races`, { trackId, isSprint: !!t?.sprint }), 'Corrida adicionada');
    });
    $$('.cal-edit li').forEach(li => {
      const id = li.dataset.race; const r = c.races.find(x => x.id === id);
      li.querySelector('[data-sprint]').addEventListener('change', (e) => run(() => admin('PUT', `/championships/${c.id}/races/${id}`, { isSprint: e.target.checked }), 'Corrida atualizada'));
      $$('[data-move]', li).forEach(b => b.addEventListener('click', () => run(() => admin('POST', `/championships/${c.id}/races/${id}/move`, { dir: Number(b.dataset.move) }), 'Ordem atualizada')));
      li.querySelector('[data-del-race]').addEventListener('click', async () => {
        if (!await confirmDialog(`Remover ${r.name}${r.done ? ' e o resultado dela' : ''} do calendário?`, { okLabel: 'Remover', danger: true })) return;
        run(() => admin('DELETE', `/championships/${c.id}/races/${id}`), 'Corrida removida');
      });
    });
    $('#pts-form').addEventListener('submit', (e) => {
      e.preventDefault(); const f = e.target;
      run(() => admin('PUT', `/championships/${c.id}/settings`, {
        points: $$('[name=p]', f).map(i => Number(i.value)), sprintPoints: $$('[name=s]', f).map(i => Number(i.value)),
        fastestLapPoint: Number(f.fl.value), fastestLapTop10: f.top10.checked,
      }), 'Pontuação salva');
    });
  }

  $('#btn-new').addEventListener('click', () => openNewSeason(run));
}

function openNewSeason(run) {
  const L = store.league;
  const year = new Date().getFullYear() + 1;
  const n = L.championships.length + 1;
  const drivers = L.drivers.filter(d => d.active).sort((a, b) => a.name.localeCompare(b.name));
  const teams = L.teams.filter(t => t.active);
  const d = openDialog(html`<form class="dlg-body" id="f">
    <h2>Nova temporada</h2>
    <div class="form-row">
      <label class="field grow">Nome<input name="name" value="Barbeiros League ${n}" required maxlength="60" /></label>
      <label class="field">Ano<input name="season" value="${year}" maxlength="10" size="6" /></label>
    </div>
    <fieldset><legend>Pistas (na ordem em que vão acontecer). <span id="cnt" class="muted"></span></legend>
      <p class="muted">Marque as pistas. A ordem segue a lista; dá para reordenar depois.</p>
      <div class="track-pick">${L.calendar.map(t => html`<label class="track"><input type="checkbox" name="track" value="${t.id}" />
        <span>${t.flag} ${t.name}</span><span class="sp"><input type="checkbox" name="sprint-${t.id}" ${t.sprint ? 'checked' : ''} /> sprint</span></label>`)}</div>
    </fieldset>
    <fieldset><legend>Grid inicial</legend>
      <p class="muted">Equipe de cada piloto na etapa 1. Deixe "Fora" para não inscrever.</p>
      <div class="grid-pick">${drivers.map(dr => html`<label>${dr.name}<select name="team-${dr.id}"><option value="">Fora</option>${{ __raw: teams.map(t => `<option value="${t.id}" ${t.id === dr.defaultTeamId ? 'selected' : ''}>${t.name}</option>`).join('') }}</select></label>`)}</div>
    </fieldset>
    ${L.activeChampionshipId ? html`<label class="check"><input type="checkbox" name="finishPrev" checked /> Finalizar a temporada atual e registrar o campeão</label>` : ''}
    <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Criar temporada</button></div>
  </form>`, { wide: true });
  const f = $('#f', d);
  const count = () => { $('#cnt', d).textContent = `${$$('[name=track]:checked', f).length} selecionadas`; };
  f.addEventListener('change', count); count();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const races = $$('[name=track]:checked', f).map(i => ({ trackId: i.value, isSprint: f[`sprint-${i.value}`].checked }));
    if (!races.length) { toast('Marque pelo menos uma pista.', 'err'); return; }
    const lineup = drivers.map(dr => ({ driverId: dr.id, teamId: f[`team-${dr.id}`].value })).filter(x => x.teamId);
    run(async () => {
      const r = await admin('POST', '/championships', {
        name: f.name.value, season: f.season.value, races, lineup, finishPrevious: f.finishPrev ? f.finishPrev.checked : true,
      });
      setChamp(r.id); d.close();
    }, 'Temporada criada');
  });
}


