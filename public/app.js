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
    render();
    loadLinks();
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
  $('cover').src = meta.thumbnail || '';
  $('artist').value = guess.artist;
  $('title').value = guess.title;
  $('album').value = meta.album || '';
  $('guessNote').textContent = {
    metadata: 'Artista y título vienen de la metadata de YouTube Music.',
    title: 'Artista y título deducidos del título del video. Corregilos si hace falta.',
    channel: 'El título no tiene formato "Artista - Canción": usé el canal como artista. Revisalo.',
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
          el('small', {}, [f.album, f.date, `coincidencia ${f.confidence}`].filter(Boolean).join(' · ')),
        ),
        link('Abrir', f.url, 'btn')));
    }
    if (r.odesli) {
      rows.push(el('div', { class: 'hit' }, el('div', {}, el('b', {}, 'Odesli / song.link'), el('small', {}, 'Reconoció este video como canción de catálogo')),
        ...r.odesli.links.map((l) => link(l.platform, l.url, 'chip'))));
    }
    $('found').replaceChildren(...rows);
    if (!rows.length) {
      const weak = r.weak.length ? ` Hubo resultados parecidos pero con baja coincidencia (${r.weak.map((w) => `${w.platform}: ${w.artist} — ${w.title}`).join('; ')}).` : '';
      $('notFound').textContent = `No encontré esta canción en catálogos (normal si el artista la sube solo a YouTube).${weak}`;
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

$('rescan').addEventListener('click', loadLinks);

$('download').addEventListener('click', async () => {
  const btn = $('download');
  const status = $('dlStatus');
  btn.disabled = true;
  status.textContent = 'Descargando y convirtiendo… puede tardar un poco.';
  showError('');
  try {
    const res = await api('/api/download', {
      url: state.url,
      source: document.querySelector('input[name=source]:checked')?.value,
      target: document.querySelector('input[name=target]:checked')?.value,
      artist: $('artist').value,
      title: $('title').value,
      album: $('album').value,
      date: state.meta.uploadDate,
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
