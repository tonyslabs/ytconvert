// Busca la canción en otras plataformas. Todas las APIs usadas son públicas y sin llave.
// Como la música suele ser solo-YouTube, nunca se asume que exista: se devuelve
// "encontrado" solo si el título/artista coinciden razonablemente; si no, solo links de búsqueda.

const UA = 'ytconvert/0.1 (uso personal local)';

export const norm = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(feat|ft|featuring|prod)\b.*$/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));

function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function score(wantArtist, wantTitle, gotArtist, gotTitle) {
  const wa = norm(wantArtist);
  const ga = norm(gotArtist);
  const artist = wa && ga && (ga.includes(wa) || wa.includes(ga)) ? 1 : jaccard(wantArtist, gotArtist);
  const title = jaccard(wantTitle, gotTitle);
  return Math.round((title * 0.65 + artist * 0.35) * 100) / 100;
}

/** Si se pidió un artista, el resultado debe ser de ese artista (evita aceptar otra canción con el mismo título). */
export function artistMatches(wantArtist, title, gotArtist) {
  if (!norm(wantArtist)) return true;
  return score(wantArtist, title, gotArtist, title) >= 0.9;
}

export async function getJson(url, ms = 8000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

const guard = (name, p) => p.catch((e) => ({ platform: name, error: e.message, matches: [] }));

async function itunes(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const j = await getJson(`https://itunes.apple.com/search?term=${q}&entity=song&limit=8`);
  return {
    platform: 'Apple Music',
    matches: (j.results || []).map((r) => ({
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName,
      url: r.trackViewUrl,
      cover: r.artworkUrl100,
      score: score(artist, title, r.artistName, r.trackName),
    })),
  };
}

async function deezer(artist, title) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const j = await getJson(`https://api.deezer.com/search?q=${q}&limit=8`);
  return {
    platform: 'Deezer',
    matches: (j.data || []).map((r) => ({
      title: r.title,
      artist: r.artist?.name,
      album: r.album?.title,
      url: r.link,
      cover: r.album?.cover_medium,
      score: score(artist, title, r.artist?.name, r.title),
    })),
  };
}

async function musicbrainz(artist, title) {
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  const j = await getJson(`https://musicbrainz.org/ws/2/recording?query=${q}&fmt=json&limit=5`);
  return {
    platform: 'MusicBrainz',
    matches: (j.recordings || []).map((r) => {
      const a = (r['artist-credit'] || []).map((c) => c.name).join(', ');
      return {
        title: r.title,
        artist: a,
        album: r.releases?.[0]?.title,
        date: r.releases?.[0]?.date || r['first-release-date'],
        url: `https://musicbrainz.org/recording/${r.id}`,
        score: score(artist, title, a, r.title),
      };
    }),
  };
}

/** Odesli/song.link: dado el link de YouTube, devuelve el resto de plataformas si es una canción de catálogo. */
async function odesli(ytUrl) {
  const j = await getJson(
    `https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(ytUrl)}&userCountry=US`,
    10000,
  );
  const links = Object.entries(j.linksByPlatform || {}).map(([k, v]) => ({ platform: k, url: v.url }));
  return { platform: 'Odesli', pageUrl: j.pageUrl, links };
}

const THRESHOLD = 0.6;

export async function findEverywhere({ artist, title, ytUrl }) {
  const [it, dz, mb, od] = await Promise.all([
    guard('Apple Music', itunes(artist, title)),
    guard('Deezer', deezer(artist, title)),
    guard('MusicBrainz', musicbrainz(artist, title)),
    odesli(ytUrl).catch(() => null),
  ]);

  const found = [];
  const pool = [];
  for (const r of [it, dz, mb]) {
    const best = (r.matches || []).sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= THRESHOLD) found.push({ platform: r.platform, ...best, confidence: best.score >= 0.85 ? 'alta' : 'media' });
    else if (best) pool.push({ platform: r.platform, ...best, confidence: 'baja' });
  }

  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const qa = encodeURIComponent(artist);
  const search = (name, track, artistUrl) => ({ platform: name, track, artist: artistUrl });
  const searchLinks = [
    search('Spotify', `https://open.spotify.com/search/${q}`, `https://open.spotify.com/search/${qa}/artists`),
    search('YouTube Music', `https://music.youtube.com/search?q=${q}`, `https://music.youtube.com/search?q=${qa}`),
    search('Apple Music', `https://music.apple.com/search?term=${q}`, `https://music.apple.com/search?term=${qa}`),
    search('SoundCloud', `https://soundcloud.com/search?q=${q}`, `https://soundcloud.com/search/people?q=${qa}`),
    search('Bandcamp', `https://bandcamp.com/search?q=${q}`, `https://bandcamp.com/search?q=${qa}&item_type=b`),
    search('Tidal', `https://tidal.com/search?q=${q}`, `https://tidal.com/search?q=${qa}`),
    search('Deezer', `https://www.deezer.com/search/${q}`, `https://www.deezer.com/search/${qa}/artist`),
    search('Amazon Music', `https://music.amazon.com/search/${q}`, `https://music.amazon.com/search/${qa}`),
    search('Audiomack', `https://audiomack.com/search?q=${q}`, `https://audiomack.com/search?q=${qa}`),
  ];

  return {
    query: { artist, title },
    found,
    weak: pool,
    odesli: od && od.links.length ? od : null,
    searchLinks,
    errors: [it, dz, mb].filter((r) => r.error).map((r) => ({ platform: r.platform, error: r.error })),
  };
}
