/* Inicialização, cabeçalho e rotas (#/...) do site. */

import { $, $$, html, esc, fmtDateTime, toast } from './util.js';
import { store, loadLeague, loadSession, setChamp, champ, isStatic, findRace } from './data.js';
import { renderStandings } from './views/standings.js';
import { renderRaces, renderRace } from './views/races.js';
import { renderDriver } from './views/driver.js';
import { renderHistory } from './views/history.js';

const main = $('#main');

const ROUTES = [
  [/^\/?$/, () => renderStandings(main), 'home'],
  [/^\/corridas$/, () => renderRaces(main), 'races'],
  [/^\/corrida\/([^/]+)$/, (id) => { syncChampFromRace(id); renderRace(main, id); }, 'races'],
  [/^\/piloto\/([^/]+)$/, (id) => renderDriver(main, id), ''],
  [/^\/hall$/, () => renderHistory(main), 'hall'],
  [/^\/temporada\/([^/]+)$/, (id) => { setChamp(id); location.replace('#/'); }, 'home'],
  [/^\/admin(?:\/(.*))?$/, (sub) => renderAdmin(sub || ''), 'admin'],
];

function syncChampFromRace(raceId) {
  const f = findRace(raceId);
  if (f && f.champ.id !== store.champId) { setChamp(f.champ.id); renderHeader(); }
}

async function renderAdmin(sub) {
  if (isStatic) { location.replace('#/'); return; }
  const mod = await import('./admin/admin.js');
  mod.renderAdmin(main, sub, { refresh });
}

function route() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  for (const [re, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (m) {
      $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === nav));
      $$('.nav a').forEach(a => a.toggleAttribute('aria-current', a.dataset.nav === nav));
      document.body.dataset.page = nav || 'page';
      fn(...m.slice(1));
      if (!path.startsWith('/admin/resultados')) window.scrollTo({ top: 0 });
      return;
    }
  }
  main.innerHTML = '<section class="empty"><h1>Página não encontrada</h1><p><a href="#/">Ir para a classificação</a></p></section>';
}

function renderHeader() {
  const L = store.league;
  $('#brand-name').textContent = L.league.name;
  document.title = `${L.league.name}${champ() ? ' — ' + champ().name : ''}`;
  const sel = $('#season');
  const list = [...L.championships].reverse();
  sel.innerHTML = list.map(c => `<option value="${esc(c.id)}" ${c.id === store.champId ? 'selected' : ''}>${esc(c.name)}${c.status === 'active' ? ' (atual)' : ''}</option>`).join('');
  sel.hidden = !list.length;

  const adminLink = $('#nav-admin');
  if (isStatic) adminLink.hidden = true;
  else {
    adminLink.hidden = false;
    adminLink.textContent = store.session.canEdit ? 'Admin' : 'Entrar';
  }
  $('#updated').textContent = `Dados atualizados em ${fmtDateTime(L.generatedAt)}`;
}

/** Recarrega os dados (depois de uma edição) e redesenha a página atual. */
async function refresh({ keepRoute = true } = {}) {
  await loadLeague();
  renderHeader();
  if (keepRoute) route();
}

async function init() {
  try {
    await Promise.all([loadLeague(), loadSession()]);
  } catch (e) {
    main.innerHTML = String(html`<section class="empty"><h1>Não deu para carregar a liga</h1><p>${e.message}</p><p><button class="btn primary" onclick="location.reload()">Tentar de novo</button></p></section>`);
    return;
  }
  renderHeader();
  $('#season').addEventListener('change', (e) => {
    setChamp(e.target.value);
    renderHeader();
    const p = location.hash.replace(/^#/, '');
    if (p.startsWith('/corrida/')) location.hash = '#/corridas'; else route();
    toast(`Mostrando ${champ().name}`);
  });
  window.addEventListener('hashchange', route);
  route();
}

init();
