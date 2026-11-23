/* Cadastro da classificação (quali) de cada corrida: posição de largada e melhor volta.
   Serve para o histórico de classificação dos pilotos, inclusive de temporadas passadas
   (escolha a temporada no seletor do topo). Aceita colar a ordem inteira de uma vez. */

import { html, raw, esc, $, $$, toast, confirmDialog } from '../util.js';
import { champ, admin, teamColor, team, driver } from '../data.js';
import { fmtLap } from '../telemetry-charts.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function entryAt(c, driverId, round) {
  let best = null;
  for (const e of c.entries) if (e.driverId === driverId && e.fromRound <= round && (!best || e.fromRound > best.fromRound)) best = e;
  return best;
}

/** "1:31.755", "1:31,755", "91.755" -> milissegundos (ou null). */
export function parseLap(text) {
  const t = String(text || '').trim().replace(',', '.');
  if (!t) return null;
  const m = /^(?:(\d+):)?(\d{1,3})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return NaN;
  const ms = Number((m[3] || '0').padEnd(3, '0'));
  return Number(m[1] || 0) * 60000 + Number(m[2]) * 1000 + ms;
}

export function renderQuali(body, raceId, { reload }) {
  const c = champ();
  if (!c) { body.innerHTML = '<p>Crie uma temporada primeiro, na aba Temporadas e corridas.</p>'; return; }
  const race = c.races.find(r => r.id === raceId) || c.races.find(r => r.done && !r.quali.length) || c.races.find(r => r.done) || c.races[0];
  if (!race) { body.innerHTML = '<p>Esta temporada não tem corridas.</p>'; return; }

  const ids = new Set(c.entries.filter(e => entryAt(c, e.driverId, race.round)).map(e => e.driverId));
  race.results.forEach(r => ids.add(r.driverId));
  race.quali.forEach(r => ids.add(r.driverId));
  const existing = new Map(race.quali.map(r => [r.driverId, r]));
  const rows = [...ids].map(id => {
    const e = entryAt(c, id, race.round); const q = existing.get(id);
    const res = race.results.find(r => r.driverId === id);
    return { id, name: driver(id)?.name || id, teamId: e?.teamId || q?.teamId || res?.teamId, isReserve: !!e?.isReserve, pos: q ? q.pos : '', ms: q?.ms || null, source: q?.source || '' };
  }).sort((a, b) => (a.pos === '' ? 1e3 : a.pos) - (b.pos === '' ? 1e3 : b.pos) || a.name.localeCompare(b.name));
  const n = Math.max(rows.length, 20);
  const posOpts = (cur) => `<option value="">—</option>` + Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>P${i + 1}</option>`).join('');
  const pole = race.results.find(r => r.pole);

  body.innerHTML = String(html`
    <div class="race-picker" role="tablist" aria-label="Corridas de ${c.name}">
      ${c.races.map(r => html`<a href="#/admin/classificacao/${r.id}" class="rp ${r.id === race.id ? 'on' : ''} ${r.quali.length ? 'done' : ''}" title="${r.name}"><span>${r.flag || '🏁'}</span><small>${r.round}</small></a>`)}
    </div>
    <section class="admin-card">
      <div class="block-head">
        <div><h2>${race.flag} ${race.name}: classificação</h2>
          <p class="muted">${c.name}, etapa ${race.round}. Marque a posição de cada piloto no grid de largada; o tempo é opcional (ex.: 1:31.755). Para outra temporada, troque no seletor do topo da página.</p></div>
        <a class="btn ghost sm" href="#/corrida/${race.id}">Ver página da corrida</a>
      </div>
      <details class="paste" ${race.quali.length ? '' : 'open'}>
        <summary>Colar a ordem de uma vez</summary>
        <p class="muted">Um piloto por linha, do 1º ao último. Números no começo (1., P2, 3 -) são ignorados. Aceita só o primeiro nome.</p>
        <textarea id="paste" rows="6" placeholder="Pedro&#10;Lucas Amaral&#10;Couto"></textarea>
        <div class="form-row"><button type="button" class="btn sm" id="paste-go">Preencher a tabela</button><span id="paste-msg" class="muted" aria-live="polite"></span></div>
      </details>
      <form id="q-form">
        <div class="table-scroll"><table class="tbl res-tbl">
          <thead><tr><th>Piloto</th><th>Grid</th><th>Melhor volta</th><th>Origem</th></tr></thead>
          <tbody>${rows.map(r => html`<tr data-id="${r.id}">
            <td><span class="team-dot" style="--tc:${teamColor(r.teamId)}"></span><b>${r.name}</b> <small class="muted">${team(r.teamId)?.name || ''}${r.isReserve ? ' (reserva)' : ''}</small></td>
            <td><select name="pos" aria-label="Posição no grid de ${r.name}">${raw(posOpts(r.pos))}</select></td>
            <td><input name="lap" inputmode="decimal" placeholder="m:ss.mmm" value="${r.ms ? fmtLap(r.ms) : ''}" autocomplete="off" aria-label="Melhor volta de ${r.name}" size="10" /></td>
            <td><small class="muted">${r.source || ''}</small></td></tr>`)}</tbody></table></div>
        <p id="q-warn" class="warn" aria-live="polite"></p>
        ${pole ? html`<p class="muted small-note">Pole lançada no resultado da corrida: <b>${pole.name}</b>. <span id="pole-chk"></span></p>` : ''}
        <div class="form-row between">
          <button type="button" class="btn danger sm" id="q-clear" ${race.quali.length ? '' : 'disabled'}>Apagar classificação da corrida</button>
          <button class="btn primary" id="q-save">Salvar classificação</button>
        </div>
      </form>
    </section>`);

  const form = $('#q-form');
  let dirty = false;
  const read = () => $$('tbody tr', form).map(tr => {
    const pv = tr.querySelector('[name=pos]').value;
    const lap = parseLap(tr.querySelector('[name=lap]').value);
    return { tr, id: tr.dataset.id, pos: pv === '' ? null : Number(pv), lap };
  });
  const update = () => {
    const data = read();
    const count = new Map();
    data.forEach(d => { if (d.pos != null) count.set(d.pos, (count.get(d.pos) || 0) + 1); });
    const problems = [];
    data.forEach(d => {
      const dup = d.pos != null && count.get(d.pos) > 1;
      d.tr.querySelector('[name=pos]').classList.toggle('bad', dup);
      const badLap = Number.isNaN(d.lap);
      d.tr.querySelector('[name=lap]').classList.toggle('bad', badLap);
      if (badLap) problems.push(`tempo inválido em ${driver(d.id)?.name || d.id}`);
    });
    [...count].filter(([, k]) => k > 1).forEach(([p]) => problems.push(`P${p} repetida`));
    const warn = $('#q-warn');
    warn.textContent = problems.length ? `Corrija antes de salvar: ${problems.join(', ')}.` : '';
    warn.classList.toggle('err', problems.length > 0);
    $('#q-save').disabled = problems.length > 0 || !dirty;
    const chk = $('#pole-chk');
    if (chk && pole) {
      const p1 = data.find(d => d.pos === 1);
      chk.textContent = !p1 ? '' : (p1.id === pole.driverId ? 'Bate com o P1 daqui.' : `Atenção: o P1 daqui é ${driver(p1.id)?.name}. A pole do resultado não muda sozinha; ajuste em "Lançar resultados" se precisar.`);
    }
  };
  form.addEventListener('input', () => { dirty = true; update(); });

  $('#paste-go').addEventListener('click', () => {
    const names = $('#paste').value.split(/\r?\n/).map(l => l.replace(/^\s*(?:p\s*)?\d+\s*[.)\-:–]?\s*/i, '').trim()).filter(Boolean);
    const pool = rows.map(r => ({ id: r.id, key: norm(r.name) }));
    const used = new Set(); const miss = []; let k = 0;
    const sel = (id) => form.querySelector(`tr[data-id="${id}"] [name=pos]`);
    rows.forEach(r => { sel(r.id).value = ''; });
    for (const line of names) {
      const key = norm(line);
      const cands = pool.filter(p => !used.has(p.id) && (p.key === key));
      const pick = cands[0] || (() => { const loose = pool.filter(p => !used.has(p.id) && (p.key.startsWith(key) || key.startsWith(p.key) || p.key.split(' ')[0] === key.split(' ')[0])); return loose.length === 1 ? loose[0] : null; })();
      if (!pick) { miss.push(line); continue; }
      used.add(pick.id); k++; sel(pick.id).value = String(k);
    }
    dirty = true; update();
    $('#paste-msg').textContent = miss.length ? `${k} preenchidos. Não achei: ${miss.join(', ')}.` : `${k} pilotos preenchidos. Confira e salve.`;
    $('#paste-msg').classList.toggle('err', miss.length > 0);
  });
  $('#q-clear').addEventListener('click', async () => {
    if (!await confirmDialog(`Apagar a classificação de ${race.name}?`, { okLabel: 'Apagar', danger: true })) return;
    try { await admin('DELETE', `/championships/${c.id}/qualifying/${race.id}`); toast('Classificação apagada'); reload(); } catch (e) { toast(e.message, 'err'); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entries = {};
    for (const d of read()) entries[d.id] = { position: d.pos, bestLapMs: d.lap || null };
    $('#q-save').disabled = true;
    try {
      await admin('PUT', `/championships/${c.id}/qualifying/${race.id}`, { entries });
      dirty = false; toast(`Classificação de ${race.name} salva`); reload();
    } catch (err) { toast(err.message, 'err'); $('#q-save').disabled = false; }
  });
  window.onbeforeunload = () => (dirty ? true : undefined);
  window.addEventListener('hashchange', () => { window.onbeforeunload = null; }, { once: true });
  update();
}
