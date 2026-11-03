// Proveedor Deezer: API pública, sin llave. Devuelve datos de la pista y del artista.
import { getJson as rawGet, score, norm } from '../links.js';

const API = 'https://api.deezer.com';
const TRACK_THRESHOLD = 0.6;

async function get(path) {
  const j = await rawGet(`${API}${path}`);
  if (j && j.error) throw new Error(j.error.message || 'Error de Deezer');
  return j;
}

const year = (d) => (d ? String(d).slice(0, 4) : null);
const q = encodeURIComponent;

async function searchTracks(artist, title) {
  // Búsqueda avanzada primero (más precisa); si no da nada, texto libre.
  let list = [];
  if (artist && title) {
    list = (await get(`/search?q=${q(`artist:"${artist}" track:"${title}"`)}&limit=10`)).data || [];
  }
  if (!list.length) list = (await get(`/search?q=${q(`${artist} ${title}`.trim())}&limit=10`)).data || [];
  return list.map((r) => ({ raw: r, score: score(artist, title, r.artist?.name, r.title) })).sort((a, b) => b.score - a.score);
}

async function trackDetails(id) {
  const t = await get(`/track/${id}`);
  let album = null;
  if (t.album?.id) {
    const a = await get(`/album/${t.album.id}`).catch(() => null);
    album = {
      id: t.album.id,
      title: t.album.title,
      url: a?.link || `https://www.deezer.com/album/${t.album.id}`,
      cover: a?.cover_xl || t.album.cover_xl || t.album.cover_big,
      releaseDate: a?.release_date || t.release_date || null,
      label: a?.label || null,
      genres: (a?.genres?.data || []).map((g) => g.name),
      recordType: a?.record_type || null,
      nbTracks: a?.nb_tracks ?? null,
      upc: a?.upc || null,
    };
  }
  return {
    id: t.id,
    url: t.link,
    title: t.title_short || t.title,
    fullTitle: t.title,
    artist: t.artist?.name,
    artistId: t.artist?.id,
    contributors: (t.contributors || []).map((c) => c.name),
    album,
    duration: t.duration || null,
    releaseDate: t.release_date || album?.releaseDate || null,
    isrc: t.isrc || null,
    bpm: t.bpm || null, // 0 = desconocido
    rank: t.rank || null,
    explicit: t.explicit_lyrics ?? null,
    preview: t.preview || null,
    trackPosition: t.track_position ?? null,
  };
}

async function artistDetails(id) {
  const [a, top, albums, related] = await Promise.all([
    get(`/artist/${id}`),
    get(`/artist/${id}/top?limit=5`).catch(() => ({ data: [] })),
    get(`/artist/${id}/albums?limit=12`).catch(() => ({ data: [] })),
    get(`/artist/${id}/related?limit=6`).catch(() => ({ data: [] })),
  ]);
  return {
    id: a.id,
    name: a.name,
    url: a.link,
    picture: a.picture_xl || a.picture_big,
    fans: a.nb_fan ?? null,
    albumCount: a.nb_album ?? null,
    topTracks: (top.data || []).map((t) => ({ title: t.title_short || t.title, url: t.link, album: t.album?.title, duration: t.duration })),
    discography: (albums.data || [])
      .sort((x, y) => String(y.release_date).localeCompare(String(x.release_date)))
      .map((al) => ({ title: al.title, url: `https://www.deezer.com/album/${al.id}`, year: year(al.release_date), type: al.record_type, cover: al.cover_medium })),
    related: (related.data || []).map((r) => ({ name: r.name, url: r.link, picture: r.picture_medium })),
  };
}

/** Busca el artista por nombre; solo acepta nombres prácticamente iguales (evita homónimos distintos). */
async function findArtistByName(name) {
  if (!name.trim()) return null;
  const list = (await get(`/search/artist?q=${q(name)}&limit=5`)).data || [];
  const want = norm(name);
  return list.find((a) => norm(a.name) === want) || null;
}

export default {
  id: 'deezer',
  label: 'Deezer',
  ready: true,

  async lookup({ artist, title }) {
    const result = { platform: 'deezer', track: null, artist: null, trackNote: null, artistNote: null };

    // --- pista ---
    const ranked = await searchTracks(artist, title);
    const best = ranked[0];
    if (best && best.score >= TRACK_THRESHOLD) {
      result.track = { ...(await trackDetails(best.raw.id)), score: best.score, confidence: best.score >= 0.85 ? 'alta' : 'media' };
    } else {
      result.trackNote = 'Sin coincidencia en Deezer.';
    }

    // --- artista: de la pista si hubo match; si no, por nombre exacto ---
    let artistId = result.track?.artistId;
    if (artistId) {
      result.artistNote = 'Desde la pista.';
    } else {
      const found = await findArtistByName(artist);
      if (found) {
        artistId = found.id;
        result.artistNote = 'Por nombre exacto.';
      } else {
        result.artistNote = 'Sin coincidencia en Deezer.';
      }
    }
    if (artistId) result.artist = await artistDetails(artistId);
    return result;
  },
};
