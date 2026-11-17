/* Pilotos, equipes e transferências na temporada selecionada. */

import { html, $, $$, toast, openDialog, confirmDialog } from '../util.js';
import { store, champ, admin, team, driver } from '../data.js';

export function renderRoster(body, { reload }) {
  const L = store.league;
  const c = champ();
  const teamsActive = L.teams.filter(t => t.active);
  const teamOpts = (sel, list = teamsActive) => list.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.name}${t.isReserve ? ' (reservas)' : ''}</option>`).join('');

  // Escalação atual = última inscrição de cada piloto na temporada
  const latest = new Map();
  for (const e of c ? c.entries : []) { const cur = latest.get(e.driverId); if (!cur || e.fromRound > cur.fromRound) latest.set(e.driverId, e); }
  const byTeam = new Map();
  for (const e of latest.values()) { if (!byTeam.has(e.teamId)) byTeam.set(e.teamId, []); byTeam.get(e.teamId).push(e); }
  const transfers = c ? c.entries.filter(e => e.fromRound > 1).sort((a, b) => a.fromRound - b.fromRound) : [];
  const enrolled = new Set(latest.keys());

  body.innerHTML = String(html`
    ${c ? html`<section class="admin-card">
      <div class="block-head"><h2>Grid de ${c.name}</h2>
        <button class="btn primary sm" id="btn-transfer">Transferir ou inscrever piloto</button></div>
      <div class="lineup">${[...byTeam.entries()].sort((a, b) => (team(a[0])?.isReserve ? 1 : 0) - (team(b[0])?.isReserve ? 1 : 0) || (team(a[0])?.name || '').localeCompare(team(b[0])?.name || '')).map(([tid, list]) => html`
        <div class="lineup-team" style="--tc:${team(tid)?.color || '#888'}">
          <b>${team(tid)?.name || 'Sem equipe'}</b>
          <ul>${list.map(e => html`<li>${driver(e.driverId)?.name || e.driverId}${e.isReserve ? html` <small class="muted">reserva</small>` : ''}${e.fromRound > 1 ? html` <small class="muted">desde a etapa ${e.fromRound}</small>` : ''}</li>`)}</ul>
        </div>`)}</div>
      ${transfers.length ? html`<h3 class="sub-h">Transferências nesta temporada</h3>
        <ul class="plain">${transfers.map(e => html`<li>${driver(e.driverId)?.name} para ${team(e.teamId)?.name} a partir da etapa ${e.fromRound}
          <button class="btn ghost sm" data-del-entry="${e.id}">Desfazer</button></li>`)}</ul>` : ''}
    </section>` : ''}

    <section class="admin-card">
      <div class="block-head"><h2>Pilotos</h2><button class="btn sm" id="btn-new-driver">Novo piloto</button></div>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Nome</th><th>Equipe padrão (novas temporadas)</th><th class="ctr">Ativo</th><th></th></tr></thead>
        <tbody>${[...L.drivers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map(d => html`<tr data-driver="${d.id}" class="${d.active ? '' : 'inactive'}">
          <td><input name="name" value="${d.name}" maxlength="40" aria-label="Nome" />${enrolled.has(d.id) ? html` <small class="muted">no grid</small>` : ''}</td>
          <td><select name="team" aria-label="Equipe padrão"><option value="">Nenhuma</option>${{ __raw: teamOpts(d.defaultTeamId, L.teams) }}</select></td>
          <td class="ctr"><input type="checkbox" name="active" ${d.active ? 'checked' : ''} aria-label="Ativo" /></td>
          <td><button class="btn sm" data-save-driver>Salvar</button></td></tr>`)}</tbody>
      </table></div>
    </section>

    <section class="admin-card">
      <div class="block-head"><h2>Equipes</h2><button class="btn sm" id="btn-new-team">Nova equipe</button></div>
      <p class="muted">Equipes com nome começando por "Reserv" são de reservas: seus pilotos pontuam no campeonato de pilotos, mas não no de construtores.</p>
      <div class="table-scroll"><table class="tbl">
        <thead><tr><th>Cor</th><th>Nome</th><th class="ctr">Ativa</th><th></th></tr></thead>
        <tbody>${[...L.teams].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map(t => html`<tr data-team="${t.id}" class="${t.active ? '' : 'inactive'}">
          <td><input type="color" name="color" value="${t.color}" aria-label="Cor" /></td>
          <td><input name="name" value="${t.name}" maxlength="40" aria-label="Nome" /></td>
          <td class="ctr"><input type="checkbox" name="active" ${t.active ? 'checked' : ''} aria-label="Ativa" /></td>
          <td><button class="btn sm" data-save-team>Salvar</button></td></tr>`)}</tbody>
      </table></div>
    </section>`);

  const run = async (fn, ok) => { try { await fn(); toast(ok); reload(); } catch (e) { toast(e.message, 'err'); } };

  $$('[data-save-driver]').forEach(b => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    run(() => admin('PUT', `/drivers/${tr.dataset.driver}`, {
      name: tr.querySelector('[name=name]').value, teamId: tr.querySelector('[name=team]').value || null, active: tr.querySelector('[name=active]').checked,
    }), 'Piloto salvo');
  }));
  $$('[data-save-team]').forEach(b => b.addEventListener('click', () => {
    const tr = b.closest('tr');
    run(() => admin('PUT', `/teams/${tr.dataset.team}`, {
      name: tr.querySelector('[name=name]').value, color: tr.querySelector('[name=color]').value, active: tr.querySelector('[name=active]').checked,
    }), 'Equipe salva');
  }));
  $$('[data-del-entry]').forEach(b => b.addEventListener('click', async () => {
    if (!await confirmDialog('Desfazer esta transferência? Os resultados voltam a contar para a equipe anterior.', { okLabel: 'Desfazer' })) return;
    run(() => admin('DELETE', `/championships/${c.id}/entries/${b.dataset.delEntry}`), 'Transferência desfeita');
  }));

  $('#btn-new-driver').addEventListener('click', () => {
    const d = openDialog(html`<form class="dlg-body" id="f">
      <h2>Novo piloto</h2>
      <label class="field">Nome<input name="name" required maxlength="40" autofocus /></label>
      <label class="field">Equipe<select name="teamId"><option value="">Nenhuma</option>${{ __raw: teamOpts('') }}</select></label>
      ${c ? html`<label class="check"><input type="checkbox" name="enroll" checked /> Inscrever em ${c.name}</label>
      <label class="field">A partir da etapa<input type="number" name="fromRound" value="1" min="1" max="${c.races.length || 1}" /></label>` : ''}
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Criar piloto</button></div></form>`);
    $('#f', d).addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      run(() => admin('POST', '/drivers', { name: fd.get('name'), teamId: fd.get('teamId') || null, enroll: !!fd.get('enroll'), fromRound: Number(fd.get('fromRound') || 1) }).then(() => d.close()), 'Piloto criado');
    });
  });

  $('#btn-new-team').addEventListener('click', () => {
    const d = openDialog(html`<form class="dlg-body" id="f">
      <h2>Nova equipe</h2>
      <div class="form-row"><label class="field grow">Nome<input name="name" required maxlength="40" autofocus /></label>
      <label class="field">Cor<input type="color" name="color" value="#e10600" /></label></div>
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Criar equipe</button></div></form>`);
    $('#f', d).addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      run(() => admin('POST', '/teams', { name: fd.get('name'), color: fd.get('color') }).then(() => d.close()), 'Equipe criada');
    });
  });

  const bt = $('#btn-transfer');
  if (bt) bt.addEventListener('click', () => {
    const drivers = L.drivers.filter(x => x.active).sort((a, b) => a.name.localeCompare(b.name));
    const d = openDialog(html`<form class="dlg-body" id="f">
      <h2>Transferir ou inscrever</h2>
      <p class="muted">Os resultados a partir da etapa escolhida passam a contar para a nova equipe. Para tornar alguém reserva, escolha a equipe de reservas.</p>
      <label class="field">Piloto<select name="driverId" required>${{ __raw: drivers.map(x => `<option value="${x.id}">${x.name}${enrolled.has(x.id) ? ` (${team(latest.get(x.id).teamId)?.name || ''})` : ' (fora do grid)'}</option>`).join('') }}</select></label>
      <label class="field">Nova equipe<select name="teamId" required>${{ __raw: teamOpts('') }}</select></label>
      <label class="field">A partir da etapa<select name="fromRound">${{ __raw: c.races.map(r => `<option value="${r.round}">${r.round}. ${r.name}${r.done ? ' (já disputada)' : ''}</option>`).join('') }}</select></label>
      <div class="dlg-actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Confirmar transferência</button></div></form>`);
    $('#f', d).addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      run(() => admin('POST', `/championships/${c.id}/transfer`, { driverId: fd.get('driverId'), teamId: fd.get('teamId'), fromRound: Number(fd.get('fromRound')) }).then(() => d.close()), 'Transferência feita');
    });
  });
}
