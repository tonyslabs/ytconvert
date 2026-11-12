// Solo se aceptan carátulas de las CDN de Deezer, Spotify y YouTube Music (evita SSRF hacia otros hosts).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const isCoverUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(dzcdn\.net|scdn\.co|googleusercontent\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
};

export async function fetchCover(url, dir) {
  if (!isCoverUrl(url)) return null;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 10_000_000) return null;
  const file = join(dir, 'cover-platform.jpg');
  await writeFile(file, buf);
  return file;
}
