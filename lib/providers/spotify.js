// Proveedor Spotify: Web API con flujo "client credentials" (sin login de usuario).
// Credenciales por env: SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET.
// Limitaciones de la API para apps nuevas: top-tracks y related-artists devuelven 403 (las "más
// escuchadas" salen de una búsqueda ordenada por popularidad y no hay relacionados), el artista ya no
// trae seguidores y el máximo de `limit` es 10.
import { score, norm, artistMatches } from '../links.js';

const API = 'https://api.spotify.com/v1';
const TRACK_THRESHOLD = 0.6;
const q = encodeURIComponent;

const hasCreds = () => !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

let token = null; // { value, exp }
async function getToken() {
  if (token && token.exp > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`Spotify rechazó las credenciales (${r.status})`);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return token.value;
}

async function get(path, retried = false) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 && !retried) { token = null; return get(path, true); }
  if (r.status === 429) throw new Error('Spotify limitó las consultas, reintentá en unos segundos');
  if (!r.ok) throw new Error(`Spotify respondió ${r.status}`);
  return r.json();
}

const year = (d) => (d ? String(d).slice(0, 4) : null);
const biggest = (images) => (images || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || null;

async function searchTracks(artist, title) {
  let list = [];
  if (artist && title) list = (await get(`/search?q=${q(`track:"${title}" artist:"${artist}"`)}&type=track&limit=10`)).tracks?.items || [];
  if (!list.length) list = (await get(`/search?q=${q(`${artist} ${title}`.trim())}&type=track&limit=10`)).tracks?.items || [];
  return list
    .map((r) => ({ raw: r, score: score(artist, title, (r.artists || []).map((a) => a.name).join(' '), r.name) }))
    .filter((r) => artistMatches(artist, title, (r.raw.artists || []).map((a) => a.name).join(' ')))
    .sort((a, b) => b.score - a.score);
}

async function trackDetails(t) {
  const alb = t.album?.id ? await get(`/albums/${t.album.id}`).catch(() => null) : null;
  const album = t.album?.id
    ? {
        id: t.album.id,
        title: t.album.name,
        url: t.album.external_urls?.spotify,
        cover: biggest(alb?.images || t.album.images),
        releaseDate: alb?.release_date || t.album.release_date || null,
        label: alb?.label || null,
        genres: alb?.genres || [],
        recordType: alb?.album_type || t.album.album_type || null,
        nbTracks: alb?.total_tracks ?? t.album.total_tracks ?? null,
        upc: alb?.external_ids?.upc || null,
      }
    : null;
  return {
    id: t.id,
    url: t.external_urls?.spotify,
    title: t.name,
    fullTitle: t.name,
    artist: t.artists?.[0]?.name,
    artistId: t.artists?.[0]?.id,
    contributors: (t.artists || []).map((a) => a.name),
    album,
    duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : null,
    releaseDate: album?.releaseDate || null,
    isrc: t.external_ids?.isrc || null,
    bpm: null,
    rank: t.popularity ?? null,
    explicit: t.explicit ?? null,
    preview: t.preview_url || null,
    trackPosition: t.track_number ?? null,
  };
}

async function artistDetails(id) {
  const a = await get(`/artists/${id}`);
  const [albums, top] = await Promise.all([
    get(`/artists/${id}/albums?include_groups=album,single&limit=10`).catch(() => ({ items: [] })),
    get(`/search?q=${q(`artist:"${a.name}"`)}&type=track&limit=10`).catch(() => ({ tracks: { items: [] } })),
  ]);
  const topTracks = (top.tracks?.items || [])
    .filter((t) => (t.artists || []).some((x) => x.id === id))
    .sort((x, y) => (y.popularity || 0) - (x.popularity || 0))
    .slice(0, 5)
    .map((t) => ({ title: t.name, url: t.external_urls?.spotify, album: t.album?.name, duration: t.duration_ms ? Math.round(t.duration_ms / 1000) : null }));
  return {
    id: a.id,
    name: a.name,
    url: a.external_urls?.spotify,
    picture: biggest(a.images),
    fans: a.followers?.total ?? null,
    albumCount: null,
    genres: a.genres || [],
    topTracks,
    discography: (albums.items || [])
      .sort((x, y) => String(y.release_date).localeCompare(String(x.release_date)))
      .map((al) => ({ title: al.name, url: al.external_urls?.spotify, year: year(al.release_date), type: al.album_type, cover: al.images?.at(-1)?.url })),
    related: [], // related-artists no está disponible para apps nuevas
  };
}

async function findArtistByName(name) {
  if (!name.trim()) return null;
  const list = (await get(`/search?q=${q(`artist:"${name}"`)}&type=artist&limit=5`)).artists?.items || [];
  const want = norm(name);
  return list.find((a) => norm(a.name) === want) || null;
}

export default {
  id: 'spotify',
  label: 'Spotify',
  get ready() { return hasCreds(); },
  get note() { return hasCreds() ? null : 'Faltan las credenciales de Spotify en el servidor.'; },

  async lookup({ artist, title }) {
    const result = { platform: 'spotify', track: null, artist: null, trackNote: null, artistNote: null };

    const best = (await searchTracks(artist, title))[0];
    if (best && best.score >= TRACK_THRESHOLD) {
      result.track = { ...(await trackDetails(best.raw)), score: best.score, confidence: best.score >= 0.85 ? 'alta' : 'media' };
    } else {
      result.trackNote = 'Sin coincidencia en Spotify.';
    }

    let artistId = result.track?.artistId;
    if (artistId) {
      result.artistNote = 'Desde la pista.';
    } else {
      const found = await findArtistByName(artist);
      if (found) {
        artistId = found.id;
        result.artistNote = 'Por nombre exacto.';
      } else {
        result.artistNote = 'Sin coincidencia en Spotify.';
      }
    }
    if (artistId) result.artist = await artistDetails(artistId);
    return result;
  },
};
