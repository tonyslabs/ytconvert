// Ejecuta un trabajo completo: analizar → (completar datos) → bajar → convertir → guardar.
import { copyFile, mkdir, rm, stat, access, readdir } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { getInfo, audioFormats, fetchSource, fetchSubs, convert, makeTempDir, removeDir } from './ytdlp.js';
import { parseTrack, safeFilename } from './parse.js';
import { fetchCover } from './cover.js';
import { norm } from './links.js';
import { getProvider } from './providers/index.js';

const exists = (p) => access(p).then(() => true, () => false);

/** Nombre seguro para una carpeta: sin separadores y sin "." / ".." (evita salir de la biblioteca). */
export function segment(name, fallback) {
  const v = safeFilename(name || fallback);
  return /^\.+$/.test(v) ? '_' : v;
}

/** Evita pisar un archivo existente: "A.flac" → "A (2).flac". */
export async function uniquePath(file) {
  if (!(await exists(file))) return file;
  const ext = extname(file);
  const base = file.slice(0, file.length - ext.length);
  for (let i = 2; i < 1000; i++) {
    const cand = `${base} (${i})${ext}`;
    if (!(await exists(cand))) return cand;
  }
  throw new Error('No se pudo elegir un nombre libre');
}

/** Completa artista/pista con una plataforma, solo si coincide bien. Devuelve lo que cambió. */
export async function autoComplete(platformId, t) {
  const p = getProvider(platformId);
  if (!p || !p.ready) return {};
  const r = await p.lookup({ artist: t.artist, title: t.title });
  const out = {};
  if (r.artist && norm(r.artist.name) === norm(t.artist)) out.artist = r.artist.name;
  if (r.track?.confidence === 'alta') {
    Object.assign(out, {
      title: r.track.title,
      album: r.track.album?.title || t.album,
      date: r.track.releaseDate || t.date,
      genre: r.track.album?.genres?.[0] || t.genre,
      isrc: r.track.isrc || t.isrc,
      coverUrl: r.track.album?.cover || t.coverUrl,
    });
  }
  return out;
}

export function createRunner({ libraryDir, layout = 'flat', outboxDir, maxSeconds = 0 }) {
  return async function run(job, update, signal) {
    const spec = job.spec;
    const tmp = await makeTempDir();
    try {
      update({ stage: 'Analizando', pct: 2 });
      const raw = await getInfo(spec.url, signal);
      if (maxSeconds && raw.duration > maxSeconds) throw new Error(`Supera el máximo de ${Math.round(maxSeconds / 60)} min de esta instancia.`);
      const guess = parseTrack(raw);
      let t = {
        artist: spec.artist ?? guess.artist,
        title: spec.title ?? guess.title,
        album: spec.album ?? (raw.album || ''),
        date: spec.date ?? raw.upload_date ?? '',
        genre: spec.genre,
        isrc: spec.isrc,
        coverUrl: spec.coverUrl,
      };
      update({ artist: t.artist, title: t.title });

      if (spec.autoMeta) {
        update({ stage: 'Buscando datos', pct: 5 });
        t = { ...t, ...(await autoComplete(spec.autoMeta, t).catch(() => ({}))) };
        update({ artist: t.artist, title: t.title });
      }

      const source = spec.source || audioFormats(raw)[0]?.id || 'bestaudio';
      update({ stage: 'Descargando', pct: 8 });
      const fetched = await fetchSource(spec.url, source, tmp, {
        signal,
        onPct: (p) => update({ stage: 'Descargando', pct: Math.round(8 + p * 0.7) }),
      });
      const cover = (t.coverUrl && (await fetchCover(t.coverUrl, tmp).catch(() => null))) || fetched.cover;

      update({ stage: 'Convirtiendo', pct: 80 });
      const year = /^\d{8}$/.test(t.date || '') ? t.date.slice(0, 4) : /^\d{4}(-\d{2}-\d{2})?$/.test(t.date || '') ? t.date : '';
      const out = await convert({
        audio: fetched.audio,
        cover,
        dir: tmp,
        target: spec.target,
        signal,
        tags: {
          artist: t.artist,
          album_artist: t.artist,
          title: t.title,
          album: t.album,
          date: year,
          genre: t.genre,
          isrc: t.isrc,
          comment: `Fuente: ${spec.url}`,
        },
      });

      update({ stage: 'Guardando', pct: 92 });
      if (spec.dest === 'library') {
        if (!libraryDir) throw new Error('La biblioteca no está configurada en el servidor.');
        const dir = layout === 'tree' ? join(libraryDir, segment(t.artist, 'Desconocido'), segment(t.album, 'Sencillos')) : libraryDir;
        await mkdir(dir, { recursive: true });
        const final = await uniquePath(join(dir, out.name));
        await copyFile(out.file, final);
        if (spec.subLangs?.length) {
          const subs = await fetchSubs(spec.url, spec.subLangs, tmp, signal).catch(() => []);
          for (const s of subs) await copyFile(s.file, `${final.slice(0, final.length - extname(final).length)}.${s.lang}.srt`);
        }
        return { name: basename(final), size: (await stat(final)).size, file: final };
      }
      const dir = join(outboxDir, job.id);
      await mkdir(dir, { recursive: true });
      const final = join(dir, out.name);
      await copyFile(out.file, final);
      return { name: out.name, size: (await stat(final)).size, file: final };
    } finally {
      await removeDir(tmp);
    }
  };
}

/** Borra del buzón de salida las carpetas más viejas que `hours`. */
export async function cleanOutbox(outboxDir, hours) {
  let names = [];
  try { names = await readdir(outboxDir); } catch { return 0; }
  let n = 0;
  for (const name of names) {
    const p = join(outboxDir, name);
    try {
      if (Date.now() - (await stat(p)).mtimeMs > hours * 3600_000) { await rm(p, { recursive: true, force: true }); n++; }
    } catch {}
  }
  return n;
}
