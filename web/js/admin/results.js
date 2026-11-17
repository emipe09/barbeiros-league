/* Lançamento de resultados de uma corrida. */

import { html, $, $$, toast, confirmDialog } from '../util.js';
import { champ, admin, teamColor, team, driver } from '../data.js';

const NON_FINISH = ['DNF', 'DNS', 'DSQ'];

function entryAt(c, driverId, round) {
  let best = null;
  for (const e of c.entries) if (e.driverId === driverId && e.fromRound <= round && (!best || e.fromRound > best.fromRound)) best = e;
  return best;
}

function pointsFor(cfg, pos, sprint, fl) {
  let p = 0;
  if (typeof pos === 'number') p += cfg.points[pos - 1] || 0;
  if (fl && cfg.fastestLapPoint > 0 && (!cfg.fastestLapTop10 || (typeof pos === 'number' && pos <= 10))) p += cfg.fastestLapPoint;
  if (typeof sprint === 'number') p += cfg.sprintPoints[sprint - 1] || 0;
  return p;
}

export function renderResults(body, raceId, { reload }) {
  const c = champ();
  if (!c) { body.innerHTML = '<p>Crie uma temporada primeiro, na aba Temporadas e corridas.</p>'; return; }
  const race = c.races.find(r => r.id === raceId) || c.races.find(r => !r.done) || c.races[c.races.length - 1];
  if (!race) { body.innerHTML = '<p>Esta temporada não tem corridas. Adicione na aba Temporadas e corridas.</p>'; return; }

  // Pilotos inscritos nesta etapa + quem já tem resultado
  const ids = new Set(c.entries.filter(e => entryAt(c, e.driverId, race.round)).map(e => e.driverId));
  race.results.forEach(r => ids.add(r.driverId));
  const order = new Map(c.standings.map((s, i) => [s.id, i]));
  const existing = new Map(race.results.map(r => [r.driverId, r]));
  const rows = [...ids].map(id => {
    const e = entryAt(c, id, race.round);
    const r = existing.get(id);
    return { id, name: driver(id)?.name || id, teamId: e?.teamId || r?.teamId, isReserve: !!e?.isReserve,
      pos: r ? (r.pos ?? r.status ?? '') : '', sprint: r?.sprintPos ?? '', pole: !!r?.pole, fl: !!r?.fl };
  }).sort((a, b) => {
    const ka = typeof a.pos === 'number' ? a.pos : (a.pos ? 100 : 1000 + (order.get(a.id) ?? 99));
    const kb = typeof b.pos === 'number' ? b.pos : (b.pos ? 100 : 1000 + (order.get(b.id) ?? 99));
    return ka - kb || a.name.localeCompare(b.name);
  });
  const n = rows.length;
  const showSprint = race.isSprint || rows.some(r => r.sprint !== '');

  const posOpts = (cur) => `<option value="">—</option>` +
    Array.from({ length: Math.max(n, 1) }, (_, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>P${i + 1}</option>`).join('') +
    NON_FINISH.map(s => `<option value="${s}" ${cur === s ? 'selected' : ''}>${s}</option>`).join('');
  const spOpts = (cur) => `<option value="">—</option>` + Array.from({ length: Math.max(n, 1) }, (_, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>S${i + 1}</option>`).join('');

  body.innerHTML = String(html`
    <div class="race-picker" role="tablist" aria-label="Corridas de ${c.name}">
      ${c.races.map(r => html`<a href="#/admin/resultados/${r.id}" class="rp ${r.id === race.id ? 'on' : ''} ${r.done ? 'done' : ''}" title="${r.name}">
        <span>${r.flag || '🏁'}</span><small>${r.round}</small></a>`)}
    </div>
    <section class="admin-card">
      <div class="block-head">
        <div><h2>${race.flag} ${race.name}</h2><p class="muted">${c.name}, etapa ${race.round}${race.isSprint ? ', com sprint' : ''}. Pilotos sem posição ficam de fora (não correram).</p></div>
        <a class="btn ghost sm" href="#/corrida/${race.id}">Ver página da corrida</a>
      </div>
      <form id="res-form">
        <div class="table-scroll"><table class="tbl res-tbl">
          <thead><tr><th>Piloto</th><th>Chegada</th>${showSprint ? '<th>Sprint</th>' : ''}<th class="ctr">Pole</th><th class="ctr">Volta rápida</th><th class="num">Pts</th></tr></thead>
          <tbody>${rows.map(r => html`<tr data-id="${r.id}">
            <td><span class="team-dot" style="--tc:${teamColor(r.teamId)}"></span><b>${r.name}</b> <small class="muted">${team(r.teamId)?.name || ''}${r.isReserve ? ' (reserva)' : ''}</small></td>
            <td><select name="pos" aria-label="Chegada de ${r.name}">${{ __raw: posOpts(r.pos) }}</select></td>
            ${showSprint ? html`<td><select name="sprint" aria-label="Sprint de ${r.name}">${{ __raw: spOpts(r.sprint) }}</select></td>` : ''}
            <td class="ctr"><input type="radio" name="pole" value="${r.id}" ${r.pole ? 'checked' : ''} aria-label="Pole: ${r.name}" /></td>
            <td class="ctr"><input type="radio" name="fl" value="${r.id}" ${r.fl ? 'checked' : ''} aria-label="Volta rápida: ${r.name}" /></td>
            <td class="num pts-prev">0</td></tr>`)}
          </tbody></table></div>
        <p id="res-warn" class="warn" aria-live="polite"></p>
        <div class="form-row between">
          <div class="form-row">
            <button type="button" class="btn ghost sm" id="clear-pole">Tirar pole</button>
            <button type="button" class="btn ghost sm" id="clear-fl">Tirar volta rápida</button>
            <button type="button" class="btn danger sm" id="clear-all">Apagar resultado da corrida</button>
          </div>
          <button class="btn primary" id="save">Salvar resultado</button>
        </div>
      </form>
    </section>`);

  const form = $('#res-form');
  let dirty = false;
  const read = () => $$('tbody tr', form).map(tr => {
    const pv = tr.querySelector('[name=pos]').value;
    const sv = tr.querySelector('[name=sprint]')?.value || '';
    return {
      tr, id: tr.dataset.id,
      pos: pv === '' ? null : (NON_FINISH.includes(pv) ? pv : Number(pv)),
      sprint: sv === '' ? null : Number(sv),
      pole: tr.querySelector('[name=pole]').checked,
      fl: tr.querySelector('[name=fl]').checked,
    };
  });
  const update = () => {
    const data = read();
    const count = (k) => data.reduce((m, d) => (typeof d[k] === 'number' ? m.set(d[k], (m.get(d[k]) || 0) + 1) : m), new Map());
    const dupP = count('pos'); const dupS = count('sprint');
    const problems = [];
    data.forEach(d => {
      d.tr.querySelector('.pts-prev').textContent = pointsFor(c.config, typeof d.pos === 'number' ? d.pos : null, d.sprint, d.fl) || '';
      const bp = typeof d.pos === 'number' && dupP.get(d.pos) > 1;
      const bs = typeof d.sprint === 'number' && dupS.get(d.sprint) > 1;
      d.tr.querySelector('[name=pos]').classList.toggle('bad', bp);
      d.tr.querySelector('[name=sprint]')?.classList.toggle('bad', bs);
    });
    [...dupP].filter(([, k]) => k > 1).forEach(([p]) => problems.push(`P${p} repetida`));
    [...dupS].filter(([, k]) => k > 1).forEach(([p]) => problems.push(`S${p} repetida`));
    const positions = [...dupP.keys()].sort((a, b) => a - b);
    const gaps = positions.length ? Array.from({ length: positions[positions.length - 1] }, (_, i) => i + 1).filter(p => !dupP.has(p)) : [];
    const warn = $('#res-warn');
    warn.textContent = problems.length ? `Corrija antes de salvar: ${problems.join(', ')}.` : (gaps.length ? `Atenção: faltam as posições ${gaps.map(p => 'P' + p).join(', ')}.` : '');
    warn.classList.toggle('err', problems.length > 0);
    $('#save').disabled = problems.length > 0 || !dirty;
    $('#save').textContent = dirty || !race.done ? 'Salvar resultado' : 'Resultado salvo';
  };
  form.addEventListener('change', () => { dirty = true; update(); });
  $('#clear-pole').addEventListener('click', () => { $$('[name=pole]', form).forEach(i => { i.checked = false; }); dirty = true; update(); });
  $('#clear-fl').addEventListener('click', () => { $$('[name=fl]', form).forEach(i => { i.checked = false; }); dirty = true; update(); });
  $('#clear-all').addEventListener('click', async () => {
    if (!await confirmDialog(`Apagar todo o resultado de ${race.name}?`, { okLabel: 'Apagar', danger: true })) return;
    try { await admin('DELETE', `/championships/${c.id}/results/${race.id}`); toast('Resultado apagado'); reload(); } catch (e) { toast(e.message, 'err'); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const results = {};
    for (const d of read()) results[d.id] = { position: d.pos, sprintPosition: d.sprint, pole: d.pole, fastestLap: d.fl };
    $('#save').disabled = true;
    try {
      await admin('PUT', `/championships/${c.id}/results/${race.id}`, { results });
      dirty = false;
      toast(`Resultado de ${race.name} salvo`);
      reload();
    } catch (err) { toast(err.message, 'err'); $('#save').disabled = false; }
  });
  window.onbeforeunload = () => (dirty ? true : undefined);
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });
  update();
}

