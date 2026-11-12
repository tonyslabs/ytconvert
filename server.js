import http from 'node:http';
import { readFile, stat, rm, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, dirname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTrack, extractLinks, classifyUrl, safeFilename } from './lib/parse.js';
import { getInfo, audioFormats, normalizeInfo, listEntries, fetchSubs, makeTempDir, removeDir, TARGETS } from './lib/ytdlp.js';
import { findEverywhere } from './lib/links.js';
import { listProviders, getProvider } from './lib/providers/index.js';
import { isCoverUrl } from './lib/cover.js';
import { createStore } from './lib/store.js';
import { Jobs } from './lib/jobs.js';
import { createRunner, cleanOutbox } from './lib/pipeline.js';
import { Subs } from './lib/subs.js';
import { createTelegram } from './lib/telegram.js';
import { clientIp, createAuth, createRateLimiter, demoConfig } from './lib/guard.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = join(ROOT, 'public');
const DATA_DIR = resolve(process.env.DATA_DIR || join(ROOT, 'data'));
const DEMO = demoConfig();
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const auth = createAuth({ password: process.env.AUTH_PASSWORD, trustProxy: TRUST_PROXY });
// En modo demo no hay biblioteca, suscripciones ni Telegram: son funciones del dueño.
const LIBRARY_DIR = !DEMO.on && process.env.LIBRARY_DIR ? resolve(process.env.LIBRARY_DIR) : null;
const LIBRARY_LAYOUT = process.env.LIBRARY_LAYOUT === 'tree' ? 'tree' : 'flat';
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 3);
const OUTBOX_HOURS = Number(process.env.OUTBOX_HOURS) || 24;
const SUB_CHECK_MINUTES = Math.max(5, Number(process.env.SUB_CHECK_MINUTES) || 60);
const MAX_PENDING = DEMO.on ? DEMO.maxPending : 500;
const jobLimit = createRateLimiter({ limit: DEMO.jobsPerHour, windowMs: 3600_000 });
const infoLimit = createRateLimiter({ limit: DEMO.infoPerHour, windowMs: 3600_000 });

// Límite por IP solo en modo demo.
function limit(limiter, req, n = 1) {
  if (!DEMO.on) return;
  const r = limiter.take(clientIp(req, TRUST_PROXY), n);
  if (!r.ok) throw new HttpError(429, `Límite de la demo alcanzado. Probá de nuevo en ${Math.ceil(r.retryAfter / 60)} min o instalá tu propia copia.`);
}
const demoOff = () => { if (DEMO.on) bad('No disponible en la demo. Instalá tu propia copia con Docker.', 403); };
const OUTBOX = join(DATA_DIR, 'outbox');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 500_000) throw new HttpError(413, 'Body demasiado grande');
  }
  try { return data ? JSON.parse(data) : {}; } catch { throw new HttpError(400, 'JSON inválido'); }
}

const OUTPUT_LABELS = {
  original: 'Original (sin recodificar)',
  flac: 'FLAC',
  wav: 'WAV',
  'mp3-320': 'MP3 320 kbps',
  'mp3-v0': 'MP3 V0 (VBR ~245 kbps)',
  'm4a-256': 'M4A (AAC 256 kbps)',
  opus: 'Opus 192 kbps',
};
const outputs = () => Object.keys(TARGETS).map((id) => ({ id, label: OUTPUT_LABELS[id] }));

// ---------- ajustes (modo inteligente, compartido entre dispositivos) ----------
const store = createStore(DATA_DIR);
const DEFAULT_SETTINGS = { target: 'flac', dest: 'browser', platform: 'deezer', autoMeta: '', subLangs: [] };
let settings = { ...DEFAULT_SETTINGS };

const LANG_RE = /^[\w.*-]{2,20}$/;
function cleanSettings(input = {}, base = settings) {
  const s = { ...base };
  if (input.target !== undefined) { if (!TARGETS[input.target]) bad('Formato inválido.'); s.target = input.target; }
  if (input.dest !== undefined) {
    if (!['browser', 'library'].includes(input.dest)) bad('Destino inválido.');
    if (input.dest === 'library' && !LIBRARY_DIR) bad('La biblioteca no está configurada en el servidor.');
    s.dest = input.dest;
  }
  if (input.platform !== undefined) { if (!getProvider(input.platform)) bad('Plataforma inválida.'); s.platform = input.platform; }
  if (input.autoMeta !== undefined) {
    if (input.autoMeta && !getProvider(input.autoMeta)) bad('Plataforma inválida.');
    s.autoMeta = input.autoMeta || '';
  }
  if (input.subLangs !== undefined) {
    if (!Array.isArray(input.subLangs) || input.subLangs.length > 5 || !input.subLangs.every((l) => LANG_RE.test(l))) bad('Idiomas de subtítulos inválidos.');
    s.subLangs = input.subLangs;
  }
  return s;
}

// ---------- cola, suscripciones, telegram ----------
const jobs = new Jobs({
  run: createRunner({ libraryDir: LIBRARY_DIR, layout: LIBRARY_LAYOUT, outboxDir: OUTBOX, maxSeconds: DEMO.on ? DEMO.maxMinutes * 60 : 0 }),
  store,
  concurrency: CONCURRENCY,
  onPrune: (job) => { if (job.dest === 'browser') rm(join(OUTBOX, job.id), { recursive: true, force: true }).catch(() => {}); },
});
const subs = new Subs({ store, jobs, list: listEntries, getSettings: async () => settings, intervalMs: SUB_CHECK_MINUTES * 60_000 });

// ---------- handlers ----------
async function handleConfig(req, res) {
  send(res, 200, {
    library: !!LIBRARY_DIR,
    layout: LIBRARY_LAYOUT,
    telegram: !DEMO.on && !!process.env.TELEGRAM_BOT_TOKEN,
    demo: DEMO.on ? { maxMinutes: DEMO.maxMinutes, maxList: DEMO.maxList } : false,
    concurrency: CONCURRENCY,
    outboxHours: OUTBOX_HOURS,
    subCheckMinutes: SUB_CHECK_MINUTES,
    settings,
    platforms: listProviders(),
    outputs: outputs(),
  });
}

async function handleInfo(req, res) {
  const { url } = await readBody(req);
  const c = classifyUrl(url);
  if (!c) bad('Pegá un link válido de YouTube.');
  limit(infoLimit, req);

  if (c.kind !== 'video') {
    const list = await listEntries(c.url, DEMO.on ? DEMO.maxList : 200);
    if (!list.entries.length) bad('No encontré videos en esa lista o canal.', 422);
    return send(res, 200, { kind: c.kind, listUrl: c.url, ...list });
  }

  const raw = await getInfo(c.url);
  const meta = normalizeInfo(raw);
  const formats = audioFormats(raw);
  if (!formats.length) bad('El video no tiene pistas de audio disponibles.', 422);
  if (DEMO.on && raw.duration > DEMO.maxMinutes * 60) bad(`En la demo el máximo es de ${DEMO.maxMinutes} min por video.`, 422);
  send(res, 200, {
    kind: 'video',
    listUrl: c.listId ? `https://www.youtube.com/playlist?list=${c.listId}` : null,
    meta,
    guess: parseTrack(raw),
    formats,
    outputs: outputs(),
    descriptionLinks: extractLinks(meta.description),
    platforms: listProviders(),
  });
}

async function handleLinks(req, res) {
  const { artist = '', title = '', url } = await readBody(req);
  if (!title.trim() && !artist.trim()) bad('Falta artista o título.');
  send(res, 200, await findEverywhere({ artist: artist.trim(), title: title.trim(), ytUrl: url }));
}

async function handlePlatform(req, res) {
  const { platform, artist = '', title = '' } = await readBody(req);
  const p = getProvider(platform);
  if (!p) bad('Plataforma desconocida.');
  if (!p.ready) bad(p.note || 'Esta plataforma aún no está disponible.', 501);
  if (!title.trim() && !artist.trim()) bad('Falta artista o título.');
  send(res, 200, await p.lookup({ artist: artist.trim(), title: title.trim() }));
}

const str = (v, max = 300) => (v === undefined || v === null ? undefined : String(v).slice(0, max));

function cleanSpec(raw) {
  const c = classifyUrl(raw?.url);
  if (!c || c.kind !== 'video') bad('Link inválido en la lista.');
  if (!TARGETS[raw.target]) bad('Formato de salida inválido.');
  const dest = raw.dest === 'library' ? 'library' : 'browser';
  if (dest === 'library' && !LIBRARY_DIR) bad('La biblioteca no está configurada en el servidor.');
  if (raw.source && !/^[\w.-]+$/.test(raw.source)) bad('Pista de origen inválida.');
  if (raw.autoMeta && !getProvider(raw.autoMeta)) bad('Plataforma inválida.');
  const subLangs = Array.isArray(raw.subLangs) ? raw.subLangs.filter((l) => LANG_RE.test(l)).slice(0, 5) : [];
  return {
    url: c.url,
    target: raw.target,
    dest,
    source: raw.source || undefined,
    artist: str(raw.artist),
    title: str(raw.title),
    label: str(raw.label),
    album: str(raw.album),
    date: str(raw.date, 20),
    genre: str(raw.genre, 80),
    isrc: str(raw.isrc, 20),
    coverUrl: raw.coverUrl && isCoverUrl(raw.coverUrl) ? raw.coverUrl : undefined,
    autoMeta: raw.autoMeta || null,
    subLangs: dest === 'library' ? subLangs : [],
  };
}

async function handleJobsAdd(req, res) {
  const { items } = await readBody(req);
  if (!Array.isArray(items) || !items.length) bad('No hay nada para agregar.');
  if (items.length > 200) bad('Máximo 200 por tanda.');
  const pending = jobs.list().filter((j) => ['queued', 'running'].includes(j.status)).length;
  if (pending + items.length > MAX_PENDING) bad('La cola está llena.', 429);
  const specs = items.map(cleanSpec); // valida todo antes de encolar nada
  limit(jobLimit, req, specs.length);
  send(res, 200, { jobs: specs.map((s) => jobs.add(s, 'ui')) });
}

async function handleJobsList(req, res) {
  send(res, 200, { jobs: jobs.list().slice(0, 150) });
}

async function handleJobsCancel(req, res) {
  const { id } = await readBody(req);
  send(res, 200, { ok: jobs.cancel(id) });
}

async function handleJobsRemove(req, res) {
  demoOff();
  const { id } = await readBody(req);
  send(res, 200, { ok: await jobs.remove(id) });
}

async function handleJobsClear(req, res) {
  demoOff();
  await jobs.clearFinished();
  send(res, 200, { ok: true });
}

async function handleJobFile(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const job = jobs.get(id);
  if (!job || job.status !== 'done' || job.dest !== 'browser' || !job.file) bad('Ese archivo no está disponible.', 404);
  let size;
  try { size = (await stat(job.file)).size; } catch { bad('El archivo ya expiró del servidor.', 410); }
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.name)}`,
  });
  await new Promise((resolveP, reject) => {
    const s = createReadStream(job.file);
    s.on('error', reject);
    res.on('close', resolveP);
    s.pipe(res);
  });
}

async function handleHistoryExport(req, res) {
  demoOff();
  const rows = jobs.list().filter((j) => !['queued', 'running'].includes(j.status)).map((j) => ({
    url: j.url, artist: j.artist, title: j.title, target: j.target, dest: j.dest, status: j.status, name: j.name || null, size: j.size || null,
    finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null, error: j.error || null,
  }));
  send(res, 200, rows, { 'Content-Disposition': 'attachment; filename="drstify-historial.json"' });
}

async function handleSettingsGet(req, res) { send(res, 200, settings); }
async function handleSettingsSet(req, res) {
  demoOff();
  settings = cleanSettings(await readBody(req));
  await store.save('settings', settings);
  send(res, 200, settings);
}

function needLibrary() { demoOff(); if (!LIBRARY_DIR) bad('Las suscripciones necesitan la biblioteca del servidor (LIBRARY_DIR).'); }
async function handleSubsList(req, res) { send(res, 200, { enabled: !!LIBRARY_DIR, items: subs.view() }); }
async function handleSubsAdd(req, res) {
  needLibrary();
  const { url } = await readBody(req);
  const c = classifyUrl(url);
  if (!c || c.kind === 'video') bad('Pegá el link de una playlist o de un canal.');
  const item = await subs.add(c.url, c.kind);
  send(res, 200, { id: item.id });
}
async function handleSubsRemove(req, res) { demoOff(); send(res, 200, { ok: await subs.remove((await readBody(req)).id) }); }
async function handleSubsToggle(req, res) { demoOff(); const b = await readBody(req); send(res, 200, { ok: await subs.setEnabled(b.id, b.enabled) }); }
async function handleSubsCheck(req, res) {
  demoOff();
  const { id } = await readBody(req);
  const targets = id ? subs.items.filter((s) => s.id === id) : subs.items.filter((s) => s.enabled);
  for (const s of targets) await subs.check(s);
  send(res, 200, { checked: targets.length, items: subs.view() });
}

async function handleSubtitles(req, res) {
  const { url, lang, title = '' } = await readBody(req);
  const c = classifyUrl(url);
  if (!c || c.kind !== 'video') bad('Link inválido.');
  if (!LANG_RE.test(lang || '')) bad('Idioma inválido.');
  limit(infoLimit, req);
  const dir = await makeTempDir();
  try {
    const files = await fetchSubs(c.url, [lang], dir);
    if (!files.length) bad('No hay subtítulos en ese idioma.', 404);
    const text = await readFile(files[0].file, 'utf8');
    const name = `${safeFilename(title || 'subtitulos')}.${files[0].lang}.srt`;
    res.writeHead(200, {
      'Content-Type': 'application/x-subrip; charset=utf-8',
      'X-Filename': encodeURIComponent(name),
      'Access-Control-Expose-Headers': 'X-Filename',
    });
    res.end(text);
  } finally {
    await removeDir(dir);
  }
}

async function serveStatic(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'No' });
  try {
    const data = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'No encontrado' });
  }
}

const routes = {
  'GET /api/config': handleConfig,
  'POST /api/info': handleInfo,
  'POST /api/links': handleLinks,
  'POST /api/platform': handlePlatform,
  'POST /api/jobs': handleJobsAdd,
  'GET /api/jobs': handleJobsList,
  'POST /api/jobs/cancel': handleJobsCancel,
  'POST /api/jobs/remove': handleJobsRemove,
  'POST /api/jobs/clear': handleJobsClear,
  'GET /api/jobs/file': handleJobFile,
  'GET /api/history/export': handleHistoryExport,
  'GET /api/settings': handleSettingsGet,
  'POST /api/settings': handleSettingsSet,
  'GET /api/subs': handleSubsList,
  'POST /api/subs': handleSubsAdd,
  'POST /api/subs/remove': handleSubsRemove,
  'POST /api/subs/toggle': handleSubsToggle,
  'POST /api/subs/check': handleSubsCheck,
  'POST /api/subtitles': handleSubtitles,
};

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/healthz') return send(res, 200, { ok: true }); // sin contraseña: lo usa el healthcheck de Docker
  const denied = auth.check(req);
  if (denied) return send(res, denied.status, { error: denied.error }, denied.headers);
  const handler = routes[`${req.method} ${path}`];
  try {
    if (handler) return await handler(req, res);
    if (req.method === 'GET') return await serveStatic(req, res);
    send(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || 'Error interno' });
    else res.destroy();
  }
});

async function boot() {
  await mkdir(OUTBOX, { recursive: true });
  if (LIBRARY_DIR) await mkdir(LIBRARY_DIR, { recursive: true }).catch((e) => console.error(`LIBRARY_DIR no escribible: ${e.message}`));
  try { settings = cleanSettings(await store.load('settings', {}), DEFAULT_SETTINGS); } catch { settings = { ...DEFAULT_SETTINGS }; }
  await jobs.init();
  await subs.init();
  cleanOutbox(OUTBOX, OUTBOX_HOURS);
  setInterval(() => { cleanOutbox(OUTBOX, OUTBOX_HOURS); jobLimit.sweep(); infoLimit.sweep(); auth.sweep(); }, 3600_000).unref();
  if (!DEMO.on && process.env.TELEGRAM_BOT_TOKEN) {
    createTelegram({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, jobs, list: listEntries, getSettings: async () => settings }).start();
  }
  server.listen(PORT, HOST, () => console.log(`ytconvert en http://${HOST}:${PORT}${LIBRARY_DIR ? ` · biblioteca: ${LIBRARY_DIR}` : ''}${auth.enabled ? ' · con contraseña' : ''}${DEMO.on ? ' · MODO DEMO' : ''}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) boot();
export { server, boot, jobs, subs, cleanSettings };
