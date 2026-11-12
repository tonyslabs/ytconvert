import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFilename } from './parse.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_BIN = join(ROOT, 'bin', 'yt-dlp');
export const YTDLP = process.env.YTDLP_BIN || (existsSync(LOCAL_BIN) ? LOCAL_BIN : 'yt-dlp');
const BASE_ANY = ['--no-warnings', '--js-runtimes', 'node'];
const BASE = [...BASE_ANY, '--no-playlist'];

function run(cmd, args, { timeout = 120_000, maxBuffer = 64 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer, signal }, (err, stdout, stderr) => {
      if (err) {
        if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return reject(new Error('Cancelado'));
        if (err.code === 'ENOENT') {
          return reject(new Error(`No se encontró "${cmd}". Corré npm run setup.`));
        }
        const msg = (stderr || err.message).split('\n').filter(Boolean).pop() || err.message;
        return reject(new Error(msg));
      }
      resolve(stdout);
    });
  });
}

/** yt-dlp con progreso: llama onPct(0-100) al ver líneas "[download]  12.3% ...". */
function runYtdlp(args, { timeout = 10 * 60_000, signal, onPct } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let last = '';
    let buf = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    const feed = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/[\r\n]+/);
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        last = line;
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m && onPct) onPct(Number(m[1]));
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') return reject(new Error('Cancelado'));
      reject(err.code === 'ENOENT' ? new Error('No se encontró yt-dlp. Corré npm run setup.') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(last.replace(/^ERROR:\s*/, '') || `yt-dlp terminó con código ${code}`));
    });
  });
}

export async function getInfo(url, signal) {
  const out = await run(YTDLP, [...BASE, '-J', url], { timeout: 60_000, signal });
  return JSON.parse(out);
}

/** Entradas de una playlist o canal (sin bajar nada). */
export async function listEntries(url, limit = 200, signal) {
  const out = await run(YTDLP, [...BASE_ANY, '--flat-playlist', '--playlist-end', String(limit), '-J', url], { timeout: 90_000, signal });
  const j = JSON.parse(out);
  const entries = (j.entries || [])
    .filter((e) => e && /^[\w-]{11}$/.test(e.id || ''))
    .map((e) => ({
      id: e.id,
      title: e.title || e.id,
      url: `https://www.youtube.com/watch?v=${e.id}`,
      duration: e.duration || null,
      channel: e.channel || e.uploader || j.channel || j.uploader || '',
    }));
  return { title: j.title || '', channel: j.channel || j.uploader || '', entries };
}

/** Subtítulos disponibles: manuales y automáticos en el idioma original. */
export function subtitleLangs(info) {
  return {
    manual: Object.keys(info.subtitles || {}).filter((k) => k !== 'live_chat'),
    auto: Object.keys(info.automatic_captions || {}).filter((k) => k.endsWith('-orig')),
  };
}

/** Baja subtítulos como SRT. Devuelve [{ lang, file }]. */
export async function fetchSubs(url, langs, dir, signal) {
  await runYtdlp(
    [...BASE, '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', langs.join(','), '--convert-subs', 'srt', '-o', join(dir, 'sub.%(ext)s'), url],
    { timeout: 120_000, signal },
  );
  return (await readdir(dir))
    .filter((f) => /^sub\..+\.srt$/.test(f))
    .map((f) => ({ lang: f.slice(4, -4), file: join(dir, f) }));
}

/** Formatos de solo audio, del mejor al peor. */
export function audioFormats(info) {
  const list = (info.formats || [])
    .filter((f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none')
    .map((f) => ({
      id: f.format_id,
      ext: f.ext,
      codec: f.acodec.split('.')[0],
      abr: Math.round(f.abr || f.tbr || 0),
      asr: f.asr || null,
      size: f.filesize || f.filesize_approx || null,
      note: f.format_note || '',
      drc: /drc/i.test(f.format_id),
      lang: f.language || null,
    }))
    // las pistas "drc" (compresión dinámica) y de idiomas dobles no son lo que queremos por defecto
    .filter((f) => !f.drc);
  list.sort((a, b) => b.abr - a.abr || (b.codec === 'opus') - (a.codec === 'opus'));
  return list;
}

export function normalizeInfo(info) {
  return {
    id: info.id,
    url: info.webpage_url,
    title: info.title,
    channel: info.channel || info.uploader,
    channelUrl: info.channel_url || info.uploader_url || null,
    uploadDate: info.upload_date || null, // YYYYMMDD
    duration: info.duration || null,
    views: info.view_count ?? null,
    likes: info.like_count ?? null,
    description: info.description || '',
    tags: info.tags || [],
    categories: info.categories || [],
    license: info.license || null,
    thumbnail: info.thumbnail || null,
    album: info.album || null,
    track: info.track || null,
    artist: info.artist || null,
    releaseYear: info.release_year || null,
    subtitleLangs: subtitleLangs(info),
    chapters: (info.chapters || []).map((c) => ({ title: c.title, start: c.start_time })),
  };
}

const AUDIO_EXTS = new Set(['webm', 'm4a', 'opus', 'mp4', 'ogg', 'mp3', 'aac']);

/** Baja el audio original + la miniatura a un directorio temporal. */
export async function fetchSource(url, formatId, dir, { onPct, signal } = {}) {
  const args = [
    ...BASE,
    '--newline',
    '-f',
    formatId || 'bestaudio',
    '-o',
    join(dir, 'source.%(ext)s'),
    '--write-thumbnail',
    '--convert-thumbnails',
    'jpg',
    url,
  ];
  await runYtdlp(args, { timeout: 10 * 60_000, signal, onPct });
  const files = await readdir(dir);
  const audio = files.find((f) => f.startsWith('source.') && AUDIO_EXTS.has(f.split('.').pop()));
  if (!audio) throw new Error('yt-dlp no produjo ningún archivo de audio');
  const cover = files.find((f) => f === 'source.jpg');
  return { audio: join(dir, audio), cover: cover ? join(dir, cover) : null };
}

// ---------- ffmpeg ----------

export const TARGETS = {
  original: { label: 'Original (sin recodificar)', cover: true },
  flac: { ext: 'flac', args: ['-c:a', 'flac', '-compression_level', '8'], cover: true },
  wav: { ext: 'wav', args: ['-c:a', 'pcm_s16le'], cover: false },
  'mp3-320': { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '320k', '-id3v2_version', '3'], cover: true },
  'mp3-v0': { ext: 'mp3', args: ['-c:a', 'libmp3lame', '-q:a', '0', '-id3v2_version', '3'], cover: true },
  'm4a-256': { ext: 'm4a', args: ['-c:a', 'aac', '-b:a', '256k'], cover: true },
  opus: { ext: 'opus', args: ['-c:a', 'libopus', '-b:a', '192k'], cover: false },
};

async function probeCodec(file) {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name',
    '-of', 'default=nw=1:nk=1', file,
  ]);
  return out.trim();
}

const ORIGINAL_EXT = { opus: 'opus', aac: 'm4a', vorbis: 'ogg', mp3: 'mp3', flac: 'flac' };

/** Convierte/remuxea con ffmpeg, escribe los tags y (si aplica) la carátula cuadrada. */
export async function convert({ audio, cover, dir, target, tags, signal }) {
  const t = TARGETS[target];
  if (!t) throw new Error('Formato de salida desconocido');

  let ext = t.ext;
  let codecArgs = t.args;
  if (target === 'original') {
    const codec = await probeCodec(audio);
    ext = ORIGINAL_EXT[codec] || audio.split('.').pop();
    codecArgs = ['-c:a', 'copy'];
  }

  // Ogg/Opus y WAV no admiten carátula adjunta vía ffmpeg
  const coverOk = t.cover && ['flac', 'mp3', 'm4a', 'mp4'].includes(ext);
  let coverFile = null;
  if (cover && coverOk) {
    coverFile = join(dir, 'cover-square.jpg');
    await run('ffmpeg', [
      '-y', '-i', cover, '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=1000:1000:force_original_aspect_ratio=decrease",
      '-q:v', '2', coverFile,
    ], { signal });
  }

  const out = join(dir, `out.${ext}`);
  const meta = Object.entries(tags)
    .filter(([, v]) => v)
    .flatMap(([k, v]) => ['-metadata', `${k}=${v}`]);

  const args = ['-y', '-i', audio];
  if (coverFile) args.push('-i', coverFile);
  args.push('-map', '0:a');
  if (coverFile) args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic');
  args.push(...codecArgs, '-map_metadata', '-1', ...meta, out);
  await run('ffmpeg', args, { timeout: 10 * 60_000, signal });

  const mime = { flac: 'audio/flac', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg' };
  const name = safeFilename(`${tags.artist ? tags.artist + ' - ' : ''}${tags.title || 'audio'}`) + `.${ext}`;
  return { file: out, name, mime: mime[ext] || 'application/octet-stream' };
}

export async function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'ytconvert-'));
}
export const removeDir = (dir) => rm(dir, { recursive: true, force: true });
