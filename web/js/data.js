/* Carrega os dados da liga e conversa com a API de admin.
   - modo "server": dados vêm de /api/league (seu PC, com edição)
   - modo "static": dados vêm de data/league.json (site publicado, só leitura) */

const CFG = window.BARBEIROS || { mode: 'static' };
export const MODE = CFG.mode;
export const isStatic = MODE === 'static';

export const store = {
  league: null,
  session: { canEdit: false, needsPassword: false },
  champId: null,
};

const LS_KEY = 'barbeiros.champ';

export async function loadLeague() {
  const url = isStatic ? `data/league.json?v=${encodeURIComponent(CFG.builtAt || Date.now())}` : '/api/league';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Não foi possível carregar os dados da liga.');
  store.league = await res.json();
  const saved = safeGet(LS_KEY);
  const ids = store.league.championships.map(c => c.id);
  if (!store.champId || !ids.includes(store.champId)) {
    store.champId = ids.includes(saved) ? saved : store.league.defaultChampionshipId;
  }
  return store.league;
}

export async function loadSession() {
  if (isStatic) return store.session;
  try {
    const r = await fetch('/api/session', { cache: 'no-store' });
    store.session = await r.json();
  } catch (_) { /* offline */ }
  return store.session;
}

export function setChamp(id) {
  store.champId = id;
  safeSet(LS_KEY, id);
}

function safeGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } }

/* ---------- Seletores ---------- */
export const champ = (id = store.champId) => store.league?.championships.find(c => c.id === id) || null;
export const team = (id) => store.league?.teams.find(t => t.id === id) || null;
export const driver = (id) => store.league?.drivers.find(d => d.id === id) || null;
export function findRace(raceId) {
  for (const c of store.league?.championships || []) {
    const r = c.races.find(x => x.id === raceId);
    if (r) return { champ: c, race: r };
  }
  return null;
}
export const teamColor = (id) => team(id)?.color || '#8a8f98';

/* ---------- API de admin ---------- */
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'barbeiros' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* vazio */ }
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}
export const admin = (method, path, body) => api(method, '/api/admin' + path, body);
