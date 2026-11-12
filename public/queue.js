// Panel lateral: cola, historial, suscripciones y ajustes. Además: portapapeles y arrastrar-y-soltar.
// Comparte globals con app.js ($, el, api, getJson, cfg, saveSettings, saveBlob, showError).

(() => {
'use strict';
const panel = $('panel');
const scrim = $('panelScrim');
const btn = $('panelBtn');
let jobsView = [];
let subsView = null;
const autoSave = new Set();   // jobs de esta sesión que se bajan solos al terminar
const saved = new Set();      // ya bajados
let activeTab = 'queue';
let pollTimer = null;

const ACTIVE = new Set(['queued', 'running']);
const when = (ms) => (ms ? new Date(ms).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : '');
const sizeMb = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '');
const jobName = (j) => [j.artist, j.title].filter(Boolean).join(' — ') || j.name || j.url;

// ---------- abrir / cerrar ----------
function openPanel(tab) {
  if (tab) setTab(tab);
  panel.hidden = false;
  scrim.hidden = false;
  document.body.classList.add('panel-open');
  btn.setAttribute('aria-expanded', 'true');
  refresh();
  panel.querySelector('.ptab[aria-selected=true]')?.focus();
}
function closePanel() {
  panel.hidden = true;
  scrim.hidden = true;
  document.body.classList.remove('panel-open');
  btn.setAttribute('aria-expanded', 'false');
  btn.focus();
}
btn.addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
$('panelClose').addEventListener('click', closePanel);
scrim.addEventListener('click', closePanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closePanel(); });

function setTab(tab) {
  activeTab = tab;
  panel.querySelectorAll('.ptab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  for (const t of ['queue', 'history', 'subs', 'settings']) $(`tab-${t}`).hidden = t !== tab;
  if (tab === 'subs') loadSubs();
  render();
}
panel.querySelectorAll('.ptab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ---------- sondeo de la cola ----------
async function refresh() {
  try {
    jobsView = (await getJson('/api/jobs')).jobs;
  } catch { return; }
  for (const j of jobsView) {
    if (j.status === 'done' && j.fileReady && autoSave.has(j.id) && !saved.has(j.id)) {
      saved.add(j.id);
      saveJob(j);
    }
  }
  const active = jobsView.filter((j) => ACTIVE.has(j.status)).length;
  $('panelBadge').textContent = String(active);
  $('panelBadge').hidden = active === 0;
  btn.classList.toggle('busy', active > 0);
  if (!panel.hidden) render();
  schedule(active > 0 ? 1500 : 12000);
}
function schedule(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(refresh, ms); }

window.afterEnqueue = (jobs, auto) => {
  if (auto) jobs.forEach((j) => autoSave.add(j.id));
  jobsView = [...jobs, ...jobsView];
  $('panelBadge').hidden = false;
  refresh();
};

// Enlace a una ruta propia del servidor (el() solo admite http/https en href, por seguridad).
function localLink(path, download, text, cls) {
  const a = el('a', { class: cls || '' }, text || '');
  a.setAttribute('href', path);
  if (download) a.setAttribute('download', download);
  return a;
}
const fileUrl = (j) => `/api/jobs/file?id=${encodeURIComponent(j.id)}`;

function saveJob(j) {
  const a = localLink(fileUrl(j), j.name || 'audio');
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- render de pestañas ----------
function render() {
  if (activeTab === 'queue') renderQueue();
  else if (activeTab === 'history') renderHistory();
  else if (activeTab === 'subs') renderSubs();
  else renderSettings();
}

const post = (path, body) => api(path, body).then((r) => r.json());

function bar(pct) {
  const b = el('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct || 0)) });
  b.append(el('i', { style: `width:${Math.max(2, Math.min(100, pct || 0))}%` }));
  return b;
}

function renderQueue() {
  const active = jobsView.filter((j) => ACTIVE.has(j.status)).sort((a, b) => a.createdAt - b.createdAt);
  const recent = jobsView.filter((j) => !ACTIVE.has(j.status)).slice(0, 5);
  const root = $('tab-queue');
  root.replaceChildren(
    el('p', { class: 'muted small panel-note' }, `Se procesan hasta ${cfg.concurrency} a la vez.`),
    active.length
      ? el('ul', { class: 'jobs' }, ...active.map((j) => {
        const cancel = el('button', { type: 'button', class: 'mini' }, 'Cancelar');
        cancel.addEventListener('click', async () => { await post('/api/jobs/cancel', { id: j.id }); refresh(); });
        return el('li', { class: 'job' },
          el('div', { class: 'job-main' }, el('b', {}, jobName(j)), el('small', {}, `${j.stage}${j.status === 'running' ? ` · ${j.pct}%` : ''} · ${j.dest === 'library' ? 'biblioteca' : 'dispositivo'}`)),
          j.status === 'running' ? bar(j.pct) : null,
          cancel);
      }))
      : el('p', { class: 'empty' }, 'No hay nada en curso.'),
    recent.length ? el('h3', {}, 'Terminadas hace poco') : null,
    recent.length ? el('ul', { class: 'jobs' }, ...recent.map(finishedRow)) : null);
}

function finishedRow(j) {
  const actions = [];
  if (j.fileReady) {
    const dl = localLink(fileUrl(j), j.name || 'audio', 'Guardar', 'mini');
    actions.push(dl);
  }
  const rm = el('button', { type: 'button', class: 'mini ghost', 'aria-label': 'Quitar del historial' }, 'Quitar');
  rm.addEventListener('click', async () => { await post('/api/jobs/remove', { id: j.id }); refresh(); });
  actions.push(rm);
  const state = { done: 'Listo', error: 'Error', canceled: 'Cancelado' }[j.status] || j.status;
  const detail = j.status === 'done'
    ? [j.dest === 'library' ? 'en la biblioteca' : 'para bajar', sizeMb(j.size), when(j.finishedAt)].filter(Boolean).join(' · ')
    : [j.error, when(j.finishedAt)].filter(Boolean).join(' · ');
  return el('li', { class: `job ${j.status}` },
    el('div', { class: 'job-main' }, el('b', {}, jobName(j)), el('small', {}, `${state} · ${detail}`)),
    el('div', { class: 'job-actions' }, ...actions));
}

function renderHistory() {
  const done = jobsView.filter((j) => !ACTIVE.has(j.status));
  const clear = el('button', { type: 'button', class: 'mini' }, 'Limpiar todo');
  clear.addEventListener('click', async () => { if (done.length && confirm('¿Borrar todo el historial? Los archivos pendientes de bajar también se borran del servidor.')) { await post('/api/jobs/clear', {}); refresh(); } });
  $('tab-history').replaceChildren(
    el('div', { class: 'panel-tools' }, clear, localLink('/api/history/export', 'drstify-historial.json', 'Exportar JSON', 'mini')),
    done.length ? el('ul', { class: 'jobs' }, ...done.map(finishedRow)) : el('p', { class: 'empty' }, 'Todavía no hay historial.'));
}

// ---------- suscripciones ----------
async function loadSubs() {
  try { subsView = await getJson('/api/subs'); } catch (e) { subsView = { enabled: false, items: [], error: e.message }; }
  if (activeTab === 'subs') renderSubs();
}

function renderSubs() {
  const root = $('tab-subs');
  if (!subsView) return root.replaceChildren(el('p', { class: 'empty' }, 'Cargando…'));
  if (!subsView.enabled) return root.replaceChildren(el('p', { class: 'empty' }, 'Las suscripciones guardan lo nuevo en la biblioteca del servidor, y este servidor no la tiene configurada (LIBRARY_DIR).'));
  const input = el('input', { type: 'url', placeholder: 'Link de una playlist o de un canal', 'aria-label': 'Link de playlist o canal', autocomplete: 'off', spellcheck: 'false' });
  const add = el('button', { type: 'submit', class: 'secondary' }, 'Suscribirme');
  const msg = el('p', { class: 'muted small', 'aria-live': 'polite' });
  const form = el('form', { class: 'sub-form' }, input, add);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    add.disabled = true;
    msg.textContent = 'Leyendo la lista…';
    try { await post('/api/subs', { url: input.value.trim() }); input.value = ''; msg.textContent = ''; await loadSubs(); } catch (err) { msg.textContent = err.message; } finally { add.disabled = false; }
  });
  const rows = subsView.items.map((s) => {
    const check = el('button', { type: 'button', class: 'mini' }, 'Revisar ahora');
    check.addEventListener('click', async () => { check.disabled = true; check.textContent = 'Revisando…'; try { await post('/api/subs/check', { id: s.id }); } catch {} await loadSubs(); refresh(); });
    const toggle = el('button', { type: 'button', class: 'mini' }, s.enabled ? 'Pausar' : 'Activar');
    toggle.addEventListener('click', async () => { await post('/api/subs/toggle', { id: s.id, enabled: !s.enabled }); loadSubs(); });
    const rm = el('button', { type: 'button', class: 'mini ghost' }, 'Quitar');
    rm.addEventListener('click', async () => { if (confirm(`¿Dejar de seguir "${s.title}"?`)) { await post('/api/subs/remove', { id: s.id }); loadSubs(); } });
    return el('li', { class: `job${s.enabled ? '' : ' paused'}` },
      el('div', { class: 'job-main' }, el('b', {}, s.title), el('small', {}, `${s.kind === 'channel' ? 'Canal' : 'Playlist'} · ${s.enabled ? 'activa' : 'en pausa'} · revisada ${when(s.lastChecked)}${s.lastNew ? ` · ${s.lastNew} nueva(s)` : ''}`),
        s.lastError ? el('small', { class: 'err' }, s.lastError) : null),
      el('div', { class: 'job-actions' }, check, toggle, rm));
  });
  root.replaceChildren(
    el('p', { class: 'muted small panel-note' }, `Cada ${cfg.subCheckMinutes} min se revisan y lo nuevo se baja a la biblioteca con tus ajustes. Lo que ya existe al suscribirte no se baja.`),
    form, msg,
    rows.length ? el('ul', { class: 'jobs' }, ...rows) : el('p', { class: 'empty' }, 'Sin suscripciones.'));
}

// ---------- ajustes (modo inteligente) ----------
function field(label, control, hint) {
  return el('label', { class: 'set-field' }, el('span', {}, label), control, hint ? el('small', {}, hint) : null);
}
function select(options, value, onChange) {
  const s = el('select', {}, ...options.map(([v, t]) => { const o = el('option', { value: v }, t); o.selected = v === value; return o; }));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function renderSettings() {
  const st = cfg.settings;
  const langs = el('input', { type: 'text', value: st.subLangs.join(', '), placeholder: 'es, en', autocomplete: 'off', spellcheck: 'false' });
  langs.addEventListener('change', () => saveSettings({ subLangs: langs.value.split(/[\s,]+/).filter(Boolean).slice(0, 5) }));
  const clipOn = el('input', { type: 'checkbox' });
  clipOn.checked = clipEnabled();
  clipOn.disabled = !navigator.clipboard?.readText;
  clipOn.addEventListener('change', () => { try { localStorage.setItem('drs-clip', clipOn.checked ? '1' : '0'); } catch {} if (clipOn.checked) checkClipboard(); });

  $('tab-settings').replaceChildren(
    el('p', { class: 'muted small panel-note' }, 'Drstify recuerda lo que elegís. Estos valores también los usan los lotes, las suscripciones y Telegram.'),
    field('Formato por defecto', select(cfg.outputs.map((o) => [o.id, o.label]), st.target, (v) => saveSettings({ target: v }))),
    cfg.library ? field('Destino por defecto', select([['browser', 'Mi dispositivo'], ['library', 'Biblioteca del servidor']], st.dest, (v) => saveSettings({ dest: v }))) : null,
    field('Plataforma de datos', select(cfg.platforms.map((p) => [p.id, p.label]), st.platform, (v) => saveSettings({ platform: v }))),
    field('Completar datos automáticamente con', select([['', 'Nada'], ...cfg.platforms.filter((p) => p.ready).map((p) => [p.id, p.label])], st.autoMeta, (v) => saveSettings({ autoMeta: v })), 'Para lotes, suscripciones y Telegram. Solo si la coincidencia es alta.'),
    cfg.library ? field('Subtítulos a guardar con la música', langs, 'Códigos de idioma separados por coma (es, en). Solo en la biblioteca. Vacío = ninguno.') : null,
    el('label', { class: 'set-check' }, clipOn, el('span', {}, 'Detectar links en el portapapeles'),
      el('small', {}, navigator.clipboard?.readText ? 'Al volver a esta pestaña, si copiaste un link de YouTube te lo ofrece.' : 'Tu navegador no lo permite aquí (requiere https o localhost).')),
    el('dl', { class: 'set-info' },
      el('dt', {}, 'Biblioteca'), el('dd', {}, cfg.library ? `activa (${cfg.layout === 'tree' ? 'artista/álbum' : 'carpeta plana'})` : 'no configurada'),
      el('dt', {}, 'Telegram'), el('dd', {}, cfg.telegram ? 'activo' : 'no configurado'),
      el('dt', {}, 'Archivos para bajar'), el('dd', {}, `se borran del servidor a las ${cfg.outboxHours} h`)));
}

// ---------- portapapeles ----------
const YT_RE = /^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i;
let clipDismissed = '';
const clipEnabled = () => { try { return localStorage.getItem('drs-clip') === '1'; } catch { return false; } };

async function checkClipboard() {
  if (!clipEnabled() || !navigator.clipboard?.readText || document.hidden) return;
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!YT_RE.test(text) || text === clipDismissed || text === $('url').value.trim()) return;
    $('clipUrl').textContent = text.length > 60 ? `${text.slice(0, 57)}…` : text;
    $('clipBanner').dataset.url = text;
    $('clipBanner').hidden = false;
  } catch { /* sin permiso: se ignora */ }
}
window.addEventListener('focus', checkClipboard);
document.addEventListener('visibilitychange', checkClipboard);
$('clipUse').addEventListener('click', () => { $('url').value = $('clipBanner').dataset.url; $('clipBanner').hidden = true; $('form').requestSubmit(); });
$('clipDismiss').addEventListener('click', () => { clipDismissed = $('clipBanner').dataset.url; $('clipBanner').hidden = true; });

// ---------- arrastrar y soltar un link ----------
let dragDepth = 0;
const hasLink = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'text/uri-list' || t === 'text/plain');
document.addEventListener('dragenter', (e) => { if (hasLink(e)) { dragDepth++; $('dropHint').hidden = false; } });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropHint').hidden = true; });
document.addEventListener('dragover', (e) => { if (hasLink(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  dragDepth = 0;
  $('dropHint').hidden = true;
  if (!hasLink(e)) return;
  e.preventDefault();
  const text = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').split('\n')[0].trim();
  if (!YT_RE.test(text)) return showError('Eso no parece un link de YouTube.');
  $('url').value = text;
  $('form').requestSubmit();
});

// arranque
cfgReady.then(() => {
  if (cfg.demo) {
    // Instancia de demostración: sin historial editable, suscripciones ni ajustes globales
    document.body.classList.add('demo');
    panel.querySelectorAll('.ptab[data-tab=history], .ptab[data-tab=subs], .ptab[data-tab=settings]').forEach((b) => { b.hidden = true; });
    const banner = $('demoBanner');
    banner.textContent = `Demo compartida: hasta ${cfg.demo.maxMinutes} min por video y ${cfg.demo.maxList} pistas por lista. Para uso sin límites, instala tu propia copia con Docker.`;
    banner.hidden = false;
  }
  refresh();
});
})();
