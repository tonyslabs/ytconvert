import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isYouTubeUrl, parseTrack, extractLinks } from './lib/parse.js';
import { getInfo, audioFormats, normalizeInfo, fetchSource, convert, makeTempDir, removeDir, TARGETS } from './lib/ytdlp.js';
import { findEverywhere } from './lib/links.js';
import { listProviders, getProvider } from './lib/providers/index.js';
import { writeFile } from 'node:fs/promises';

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_JOBS = 2;
let jobs = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 100_000) throw new Error('Body demasiado grande');
  }
  return data ? JSON.parse(data) : {};
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

async function handleInfo(req, res) {
  const { url } = await readBody(req);
  if (!isYouTubeUrl(url)) return send(res, 400, { error: 'Pegá un link válido de YouTube.' });
  const raw = await getInfo(url);
  const meta = normalizeInfo(raw);
  const formats = audioFormats(raw);
  if (!formats.length) return send(res, 422, { error: 'El video no tiene pistas de audio disponibles.' });
  send(res, 200, {
    meta,
    guess: parseTrack(raw),
    formats,
    outputs: Object.keys(TARGETS).map((id) => ({ id, label: OUTPUT_LABELS[id] })),
    descriptionLinks: extractLinks(meta.description),
    platforms: listProviders(),
  });
}

async function handleLinks(req, res) {
  const { artist = '', title = '', url } = await readBody(req);
  if (!title.trim() && !artist.trim()) return send(res, 400, { error: 'Falta artista o título.' });
  send(res, 200, await findEverywhere({ artist: artist.trim(), title: title.trim(), ytUrl: url }));
}

async function handlePlatform(req, res) {
  const { platform, artist = '', title = '' } = await readBody(req);
  const p = getProvider(platform);
  if (!p) return send(res, 400, { error: 'Plataforma desconocida.' });
  if (!p.ready) return send(res, 501, { error: p.note || 'Esta plataforma aún no está disponible.' });
  if (!title.trim() && !artist.trim()) return send(res, 400, { error: 'Falta artista o título.' });
  send(res, 200, await p.lookup({ artist: artist.trim(), title: title.trim() }));
}

// Solo se aceptan carátulas de las CDN de Deezer, Spotify y YouTube Music (evita SSRF hacia otros hosts).
async function fetchCover(url, dir) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || !/(^|\.)(dzcdn\.net|scdn\.co|googleusercontent\.com)$/i.test(u.hostname)) return null;
  const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
  if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 10_000_000) return null;
  const file = join(dir, 'cover-platform.jpg');
  await writeFile(file, buf);
  return file;
}

async function handleDownload(req, res) {
  const b = await readBody(req);
  if (!isYouTubeUrl(b.url)) return send(res, 400, { error: 'Link inválido.' });
  if (!TARGETS[b.target]) return send(res, 400, { error: 'Formato de salida inválido.' });
  if (b.source && !/^[\w.-]+$/.test(b.source)) return send(res, 400, { error: 'Pista de origen inválida.' });
  if (jobs >= MAX_JOBS) return send(res, 429, { error: 'Hay demasiadas conversiones en curso, probá en unos segundos.' });

  jobs++;
  const dir = await makeTempDir();
  try {
    const fetched = await fetchSource(b.url, b.source, dir);
    const { audio } = fetched;
    const cover = (b.coverUrl && (await fetchCover(b.coverUrl, dir).catch(() => null))) || fetched.cover;
    const year = /^\d{8}$/.test(b.date || '') ? b.date.slice(0, 4) : /^\d{4}(-\d{2}-\d{2})?$/.test(b.date || '') ? b.date : '';
    const out = await convert({
      audio,
      cover,
      dir,
      target: b.target,
      tags: {
        artist: b.artist,
        album_artist: b.artist,
        title: b.title,
        album: b.album,
        date: year,
        genre: b.genre,
        isrc: b.isrc,
        comment: `Fuente: ${b.url}`,
      },
    });
    const { size } = await stat(out.file);
    res.writeHead(200, {
      'Content-Type': out.mime,
      'Content-Length': size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`,
      'X-Filename': encodeURIComponent(out.name),
      'Access-Control-Expose-Headers': 'X-Filename',
    });
    await new Promise((resolve, reject) => {
      const s = createReadStream(out.file);
      s.on('error', reject);
      res.on('close', resolve);
      s.pipe(res);
    });
  } finally {
    jobs--;
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'No encontrado' });
  }
}

const routes = {
  'POST /api/info': handleInfo,
  'POST /api/links': handleLinks,
  'POST /api/platform': handlePlatform,
  'POST /api/download': handleDownload,
};

const server = http.createServer(async (req, res) => {
  const handler = routes[`${req.method} ${req.url.split('?')[0]}`];
  try {
    if (handler) return await handler(req, res);
    if (req.method === 'GET') return await serveStatic(req, res);
    send(res, 405, { error: 'Método no permitido' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: e.message || 'Error interno' });
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => console.log(`ytconvert en http://${HOST}:${PORT}`));
