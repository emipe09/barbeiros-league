/* Utilidades de DOM e formatação. */

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Template literal que escapa interpolações (use raw() para HTML confiável). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map(x => (x && x.__raw != null ? x.__raw : esc(x))).join('');
      else out += v && v.__raw != null ? v.__raw : esc(v);
    }
  });
  return { __raw: out, toString() { return out; } };
}
export const raw = (s) => ({ __raw: String(s ?? ''), toString() { return String(s ?? ''); } });

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const fmtPts = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); } catch (_) { return ''; }
}
export function fmtDateTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
}

/** Texto legível sobre a cor da equipe (preto ou branco). */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#111' : '#fff';
}

export function initials(name) {
  const p = String(name || '?').trim().split(/\s+/);
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ''))).toUpperCase();
}

export function resultLabel(r) {
  if (!r) return '';
  if (r.pos != null) return 'P' + r.pos;
  return r.status || '';
}

/** Classe de célula da grade de resultados (estilo tabela da F1). */
export function cellClass(r) {
  if (!r) return 'c-none';
  if (r.pos === 1) return 'c-p1';
  if (r.pos === 2) return 'c-p2';
  if (r.pos === 3) return 'c-p3';
  if (r.pos != null && r.pts > 0) return 'c-pts';
  if (r.pos != null) return 'c-fin';
  if (r.status === 'DSQ') return 'c-dsq';
  if (r.status === 'DNS') return 'c-dns';
  return 'c-dnf';
}

let toastTimer;
export function toast(msg, kind = 'ok') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, kind === 'err' ? 5000 : 2600);
}

/** Caixa de diálogo nativa <dialog>. Retorna o elemento. */
export function openDialog(content, { wide = false } = {}) {
  closeDialog();
  const d = document.createElement('dialog');
  d.className = 'dlg' + (wide ? ' wide' : '');
  d.innerHTML = String(content);
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  $$('[data-close]', d).forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal();
  return d;
}
export function closeDialog() { $$('dialog.dlg').forEach(d => d.close()); }

export function confirmDialog(message, { okLabel = 'Confirmar', danger = false } = {}) {
  return new Promise(resolve => {
    const d = openDialog(html`<form method="dialog" class="dlg-body">
      <p class="confirm-msg">${message}</p>
      <div class="dlg-actions">
        <button value="no" class="btn ghost">Cancelar</button>
        <button value="yes" class="btn ${danger ? 'danger' : 'primary'}">${okLabel}</button>
      </div></form>`);
    d.addEventListener('close', () => resolve(d.returnValue === 'yes'));
  });
}

export function download(filename, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
