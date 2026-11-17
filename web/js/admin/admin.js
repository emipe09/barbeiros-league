/* Painel de admin: login, abas e a aba "Publicar e backup". */

import { html, $, toast, download, confirmDialog, fmtDateTime } from '../util.js';
import { store, api, admin, loadSession } from '../data.js';
import { renderResults } from './results.js';
import { renderRoster } from './roster.js';
import { renderSeasons } from './seasons.js';

const TABS = [
  ['resultados', 'Lançar resultados'],
  ['elenco', 'Pilotos e equipes'],
  ['temporadas', 'Temporadas e corridas'],
  ['publicar', 'Publicar e backup'],
];

export async function renderAdmin(main, sub, ctx) {
  await loadSession();
  if (!store.session.canEdit) return renderLogin(main, ctx);

  const [tab, ...rest] = sub.split('/');
  const current = TABS.some(t => t[0] === tab) ? tab : 'resultados';
  main.innerHTML = String(html`
    <div class="admin-head">
      <h1 class="page-title">Admin</h1>
      <p class="muted">Edições ficam salvas no banco deste computador. Para a galera ver, use <a href="#/admin/publicar">Publicar no site</a>.</p>
    </div>
    <nav class="admin-tabs" aria-label="Seções do admin">
      ${TABS.map(([k, l]) => html`<a href="#/admin/${k}" class="${k === current ? 'on' : ''}" ${k === current ? 'aria-current="page"' : ''}>${l}</a>`)}
    </nav>
    <div id="admin-body"></div>`);
  const body = $('#admin-body');
  const helpers = { ...ctx, reload: async () => { await ctx.refresh({ keepRoute: false }); renderAdmin(main, sub, ctx); } };
  if (current === 'resultados') renderResults(body, rest[0], helpers);
  else if (current === 'elenco') renderRoster(body, helpers);
  else if (current === 'temporadas') renderSeasons(body, helpers);
  else renderPublish(body, helpers);
}

function renderLogin(main, ctx) {
  main.innerHTML = String(html`
    <section class="login">
      <h1 class="page-title">Entrar como admin</h1>
      ${store.session.needsPassword ? html`
        <form id="login" class="dlg-body card">
          <label class="field">Senha de admin<input type="password" name="password" autocomplete="current-password" required autofocus /></label>
          <button class="btn primary">Entrar</button>
        </form>` : html`<p>O painel de admin só abre no computador onde o servidor está rodando. Acesse <b>http://localhost:3000</b> nele ou defina <code>ADMIN_PASSWORD</code> no arquivo <code>.env</code>.</p>`}
    </section>`);
  const f = $('#login');
  if (f) f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/login', { password: new FormData(f).get('password') });
      await ctx.refresh();
      toast('Bem-vindo, admin.');
    } catch (err) { toast(err.message, 'err'); }
  });
}

function renderPublish(body, { reload }) {
  body.innerHTML = String(html`
    <section class="admin-card">
      <h2>Publicar no site</h2>
      <p>Envia o banco atualizado para o GitHub. O site público é refeito sozinho em 1 a 2 minutos.</p>
      <div class="form-row">
        <label class="field grow">Descrição (opcional)<input id="pub-msg" placeholder="Ex.: Resultado do GP do Japão" maxlength="120" /></label>
        <button class="btn primary" id="pub-go">Publicar no site</button>
      </div>
      <p id="pub-out" class="muted" aria-live="polite"></p>
    </section>

    <section class="admin-card">
      <h2>Backup</h2>
      <p>Uma cópia do banco é salva automaticamente em <code>data/backups/</code> antes de cada operação arriscada (nova temporada, finalizar, excluir, restaurar, publicar).</p>
      <div class="form-row">
        <button class="btn" id="bk-now">Criar cópia agora</button>
        <button class="btn" id="bk-dl">Baixar backup (.json)</button>
        <label class="btn">Restaurar de um .json<input type="file" id="bk-up" accept="application/json,.json" hidden /></label>
      </div>
    </section>

    <section class="admin-card">
      <h2>Nome da liga</h2>
      <form id="league-form" class="form-row">
        <label class="field grow">Nome exibido no site<input name="name" value="${store.league.league.name}" maxlength="60" required /></label>
        <button class="btn">Salvar nome</button>
      </form>
    </section>

    ${store.session.needsPassword ? html`<p><button class="btn ghost" id="logout">Sair do admin</button></p>` : ''}
    <p class="muted">Dados carregados em ${fmtDateTime(store.league.generatedAt)}.</p>`);

  $('#pub-go').addEventListener('click', async (e) => {
    const out = $('#pub-out'); e.target.disabled = true; out.textContent = 'Publicando…';
    try {
      const r = await admin('POST', '/publish', { message: $('#pub-msg').value.trim() || undefined });
      out.textContent = r.committed ? 'Publicado. O site atualiza em 1 a 2 minutos.' : 'Nada novo para publicar: o site já está com estes dados.';
      toast('Publicado');
    } catch (err) { out.textContent = err.message; toast('A publicação falhou', 'err'); }
    e.target.disabled = false;
  });
  $('#bk-now').addEventListener('click', async () => {
    try { const r = await admin('POST', '/backup'); toast('Cópia salva: ' + r.file); } catch (err) { toast(err.message, 'err'); }
  });
  $('#bk-dl').addEventListener('click', async () => {
    try {
      const data = await admin('GET', '/export');
      download(`barbeiros-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#bk-up').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!await confirmDialog('Restaurar substitui todos os dados atuais pelos do arquivo. Uma cópia do banco atual será salva antes. Continuar?', { okLabel: 'Restaurar', danger: true })) return;
    try { await admin('POST', '/import', JSON.parse(await file.text())); toast('Backup restaurado'); reload(); } catch (err) { toast(err.message, 'err'); }
  });
  $('#league-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await admin('PUT', '/league', { name: new FormData(e.target).get('name') }); toast('Nome salvo'); reload(); } catch (err) { toast(err.message, 'err'); }
  });
  const lo = $('#logout');
  if (lo) lo.addEventListener('click', async () => { await api('POST', '/api/logout'); location.hash = '#/'; location.reload(); });
}
