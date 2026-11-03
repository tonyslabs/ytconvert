const $ = (id) => document.getElementById(id);
let state = null;

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'href') n.href = /^https?:\/\//i.test(v) ? v : '#';
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null));
  return n;
};
const link = (text, href, cls) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: cls || '' }, text);

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res;
}

const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');
const fmtDate = (d) => (d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : '—');
const fmtSize = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '');
const fmtNum = (n) => (n == null ? '—' : n.toLocaleString('es'));

function showError(msg) {
  $('error').textContent = msg || '';
  $('error').hidden = !msg;
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  $('result').hidden = true;
  $('loading').hidden = false;
  $('go').disabled = true;
  try {
    const url = $('url').value.trim();
    state = await (await api('/api/info', { url })).json();
    state.url = url;
    state.platform = 'deezer';
    state.applied = null;
    render();
    loadLinks();
    loadPlatform();
  } catch (err) {
    showError(err.message);
  } finally {
    $('loading').hidden = true;
    $('go').disabled = false;
  }
});

function radio(name, id, checked, label, detail) {
  const input = el('input', { type: 'radio', name, value: id });
  input.checked = checked;
  return el('label', { class: 'opt' }, input, el('span', {}, label, detail ? el('small', {}, detail) : null));
}

function render() {
  const { meta, guess, formats, outputs } = state;
  state.base = { artist: guess.artist, title: guess.title, album: meta.album || '', cover: meta.thumbnail || '' };
  $('cover').src = meta.thumbnail || '';
  $('artist').value = guess.artist;
  $('title').value = guess.title;
  $('album').value = meta.album || '';
  $('guessNote').textContent = {
    metadata: 'Desde YouTube Music.',
    title: 'Deducido del título del video.',
    channel: 'Usé el canal como artista.',
  }[guess.source];

  const src = $('sources');
  src.replaceChildren(...formats.map((f, i) =>
    radio('source', f.id, i === 0, `${f.codec} · ${f.abr || '?'} kbps`, [f.ext, f.asr && `${f.asr / 1000} kHz`, fmtSize(f.size), i === 0 && 'mejor'].filter(Boolean).join(' · '))));

  const out = $('outputs');
  out.replaceChildren(...outputs.map((o) => radio('target', o.id, o.id === 'flac', o.label)));

  const rows = [
    ['Canal', meta.channelUrl ? link(meta.channel, meta.channelUrl) : meta.channel],
    ['Publicado', fmtDate(meta.uploadDate)],
    ['Duración', fmtDur(meta.duration)],
    ['Vistas', fmtNum(meta.views)],
    ['Likes', fmtNum(meta.likes)],
    ['Licencia', meta.license || '—'],
    ['Categorías', meta.categories.join(', ') || '—'],
    ['Video', link(meta.url, meta.url)],
  ];
  $('meta').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
  $('desc').textContent = meta.description || '(sin descripción)';
  $('tags').replaceChildren(...meta.tags.slice(0, 30).map((t) => el('span', { class: 'chip' }, t)));

  const dl = state.descriptionLinks;
  $('descLinks').replaceChildren(
    ...(dl.length
      ? [el('h3', {}, 'Links en la descripción'), el('div', { class: 'chips' }, ...dl.map((l) => link(`${l.platform}`, l.url, `chip ${l.kind}`)))]
      : []),
  );

  $('result').hidden = false;
}

async function loadLinks() {
  $('linksLoading').hidden = false;
  $('found').replaceChildren();
  $('notFound').hidden = true;
  $('searchLinks').replaceChildren();
  try {
    const r = await (await api('/api/links', { artist: $('artist').value, title: $('title').value, url: state.url })).json();
    const rows = [];
    for (const f of r.found) {
      rows.push(el('div', { class: 'hit' },
        f.cover ? el('img', { src: f.cover, alt: '', width: 48, height: 48 }) : null,
        el('div', {},
          el('b', {}, f.platform), ` · ${f.artist} — ${f.title}`,
          el('small', {}, [f.album, f.date].filter(Boolean).join(' · ')),
        ),
        el('small', { class: 'badge', 'data-conf': f.confidence }, `coincidencia ${f.confidence}`),
        link('Abrir', f.url, 'btn')));
    }
    if (r.odesli) {
      rows.push(el('div', { class: 'hit' }, el('div', {}, el('b', {}, 'Odesli / song.link'), el('small', {}, 'Reconoció este video como canción de catálogo')),
        ...r.odesli.links.map((l) => link(l.platform, l.url, 'chip'))));
    }
    $('found').replaceChildren(...rows);
    if (!rows.length) {
      const weak = r.weak.length ? ` Parecidos: (${r.weak.map((w) => `${w.platform}: ${w.artist} — ${w.title}`).join('; ')}).` : '';
      $('notFound').textContent = `No está en otras plataformas.${weak}`;
      $('notFound').hidden = false;
    }
    $('searchLinks').replaceChildren(...r.searchLinks.map((s) =>
      el('div', { class: 'search-item' }, el('b', {}, s.platform), link('canción', s.track, 'chip'), link('artista', s.artist, 'chip'))));
    if (r.errors.length) $('notFound').hidden = false, $('notFound').textContent += ` (Sin respuesta de: ${r.errors.map((e) => e.platform).join(', ')}.)`;
  } catch (err) {
    $('notFound').textContent = `No se pudo buscar en otras plataformas: ${err.message}`;
    $('notFound').hidden = false;
  } finally {
    $('linksLoading').hidden = true;
  }
}

$('rescan').addEventListener('click', () => { loadLinks(); loadPlatform(); });

// ---------- datos de la plataforma elegida ----------
const fmtFans = (n) => (n == null ? '—' : n.toLocaleString('es'));
const dl = (rows) => el('dl', {}, ...rows.filter(([, v]) => v != null && v !== '' && v !== '—').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));

function renderTabs() {
  $('platformTabs').replaceChildren(...state.platforms.map((p) => {
    const b = el('button', { type: 'button', class: 'tab' + (p.id === state.platform ? ' active' : ''), role: 'tab', 'aria-selected': String(p.id === state.platform) }, p.label, p.ready ? null : el('small', {}, 'pronto'));
    if (!p.ready) b.title = p.note || '';
    b.addEventListener('click', () => { state.platform = p.id; renderTabs(); loadPlatform(); });
    return b;
  }));
}

function renderTrack(t) {
  const a = t.album;
  return el('div', { class: 'plat' },
    a?.cover ? el('img', { src: a.cover, alt: '', width: 120, height: 120, class: 'plat-cover' }) : null,
    el('p', {}, link(t.title, t.url), ` — ${t.artist}`, el('small', { class: 'badge', 'data-conf': t.confidence }, `coincidencia ${t.confidence}`)),
    dl([
      ['Álbum', a ? link(a.title, a.url) : null],
      ['Tipo', a?.recordType],
      ['Fecha', t.releaseDate],
      ['Género', a?.genres?.join(', ')],
      ['Sello', a?.label],
      ['Duración', fmtDur(t.duration)],
      ['ISRC', t.isrc],
      ['UPC', a?.upc],
      ['BPM', t.bpm || null],
      ['Explícita', t.explicit == null ? null : t.explicit ? 'Sí' : 'No'],
      ['Con', t.contributors?.length > 1 ? t.contributors.join(', ') : null],
    ]),
    t.preview ? el('audio', { controls: '', preload: 'none', src: t.preview }) : null);
}

function renderArtist(a) {
  return el('div', { class: 'plat' },
    a.picture ? el('img', { src: a.picture, alt: '', width: 120, height: 120, class: 'plat-cover round' }) : null,
    el('p', {}, link(a.name, a.url)),
    dl([['Fans', fmtFans(a.fans)], ['Álbumes', a.albumCount]]),
    a.topTracks.length ? el('div', {}, el('h3', {}, 'Más escuchadas'), el('ol', { class: 'list' }, ...a.topTracks.map((t) => el('li', {}, link(t.title, t.url), t.album ? el('small', {}, ` · ${t.album}`) : null)))) : null,
    a.discography.length ? el('div', {}, el('h3', {}, 'Discografía'), el('div', { class: 'chips' }, ...a.discography.map((d) => link(`${d.title}${d.year ? ` (${d.year})` : ''}`, d.url, 'chip')))) : null,
    a.related.length ? el('div', {}, el('h3', {}, 'Artistas relacionados'), el('div', { class: 'chips' }, ...a.related.map((r) => link(r.name, r.url, 'chip')))) : null);
}

let platSeq = 0;
async function loadPlatform() {
  renderTabs();
  const seq = ++platSeq;
  const p = state.platforms.find((x) => x.id === state.platform);
  $('platTrack').replaceChildren();
  $('platArtist').replaceChildren();
  $('applyBox').hidden = true;
  if (state.parts?.track) { $('cover').src = state.base.cover; state.applied = null; }
  state.parts = { artist: false, track: false };
  state.found = null;
  if (!p.ready) {
    $('platformStatus').textContent = '';
    $('platTrack').append(el('p', { class: 'muted' }, 'Próximamente.'));
    $('platArtist').append(el('p', { class: 'muted' }, 'Próximamente.'));
    return;
  }
  $('platformStatus').textContent = `Consultando ${p.label}…`;
  try {
    const r = await (await api('/api/platform', { platform: p.id, artist: $('artist').value, title: $('title').value })).json();
    if (seq !== platSeq) return; // llegó tarde: el usuario cambió de pestaña o volvió a buscar
    state.found = r;
    $('platformStatus').textContent = '';
    $('platTrack').replaceChildren(r.track ? renderTrack(r.track) : el('p', { class: 'muted' }, r.trackNote || 'Sin datos.'));
    $('platArtist').replaceChildren(
      r.artist ? renderArtist(r.artist) : el('p', { class: 'muted' }, r.artistNote || 'Sin datos.'),
      r.artist && r.artistNote ? el('p', { class: 'muted small' }, r.artistNote) : null);
    renderPick(r, p);
  } catch (err) {
    if (seq === platSeq) $('platformStatus').textContent = `No se pudo consultar ${p.label}: ${err.message}`;
  }
}

function pickOpt(value, checked, disabled, label, detail) {
  const input = el('input', { type: 'checkbox', name: 'apply', value });
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => (value === 'track' ? setTrack : setArtist)(input.checked));
  return el('label', { class: 'opt' + (disabled ? ' off' : '') }, input, el('span', {}, label, el('small', {}, detail)));
}

// Marcar/desmarcar una ficha la aplica o la revierte al instante; Descargar usa lo que se ve.
function setArtist(on) {
  const a = state.found?.artist;
  state.parts.artist = on && !!a;
  $('artist').value = state.parts.artist ? a.name : state.base.artist;
}

function setTrack(on) {
  const t = state.found?.track;
  const b = state.base;
  state.parts.track = on && !!t;
  if (state.parts.track) {
    $('title').value = t.title;
    if (t.album) $('album').value = t.album.title;
    state.applied = { date: t.releaseDate, genre: t.album?.genres?.[0], isrc: t.isrc, coverUrl: t.album?.cover };
    if (t.album?.cover) $('cover').src = t.album.cover;
  } else {
    $('title').value = b.title;
    $('album').value = b.album;
    state.applied = null;
    $('cover').src = b.cover;
  }
}

// Ofrece usar la ficha de la pista, la del artista o ambas, según lo que haya coincidido.
// El artista (nombre exacto) se aplica solo; la pista solo si la coincidencia es alta.
function renderPick(r, p) {
  const t = r.track;
  const a = r.artist;
  if (!t && !a) return;
  $('applySrc').textContent = p.label;
  $('applyPick').replaceChildren(
    pickOpt('artist', !!a, !a, a ? `Artista · ${a.name}` : 'Artista', a ? 'Nombre' : 'Sin coincidencia'),
    pickOpt('track', false, !t, t ? `Pista · ${t.title}` : 'Pista', t ? 'Título, álbum, fecha, género, ISRC, carátula' : 'Sin coincidencia'));
  $('applyBox').hidden = false;
  if (a) setArtist(true);
  if (t && t.confidence === 'alta') {
    document.querySelector('input[name=apply][value=track]').checked = true;
    setTrack(true);
  }
}

$('download').addEventListener('click', async () => {
  const btn = $('download');
  const status = $('dlStatus');
  btn.disabled = true;
  status.textContent = 'Convirtiendo…';
  showError('');
  try {
    const res = await api('/api/download', {
      url: state.url,
      source: document.querySelector('input[name=source]:checked')?.value,
      target: document.querySelector('input[name=target]:checked')?.value,
      artist: $('artist').value,
      title: $('title').value,
      album: $('album').value,
      date: state.applied?.date || state.meta.uploadDate,
      genre: state.applied?.genre,
      isrc: state.applied?.isrc,
      coverUrl: state.applied?.coverUrl,
    });
    const name = decodeURIComponent(res.headers.get('X-Filename') || 'audio');
    const blob = await res.blob();
    const a = el('a', { href: '#', download: name });
    a.href = URL.createObjectURL(blob);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    status.textContent = `Listo: ${name} (${(blob.size / 1048576).toFixed(1)} MB)`;
  } catch (err) {
    status.textContent = '';
    showError(err.message);
  } finally {
    btn.disabled = false;
  }
});
