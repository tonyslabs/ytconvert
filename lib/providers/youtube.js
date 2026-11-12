// Proveedor YouTube Music: API interna ("innertube") del cliente web de music.youtube.com.
// No es oficial ni tiene llave: puede cambiar sin aviso, por eso todo el parseo es tolerante.
import { score, norm, artistMatches } from '../links.js';

const BASE = 'https://music.youtube.com';
const TRACK_THRESHOLD = 0.6;
const SONGS = 'EgWKAQIIAWoKEAkQBRAKEAMQBA==';   // filtro de búsqueda: Songs
const ARTISTS = 'EgWKAQIgAWoKEAkQBRAKEAMQBA=='; // filtro de búsqueda: Artists

async function call(path, body) {
  const r = await fetch(`${BASE}/youtubei/v1/${path}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00', hl: 'en', gl: 'US' } }, ...body }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`YouTube Music respondió ${r.status}`);
  return r.json();
}

// ---------- utilidades de parseo (exportadas para tests) ----------
export function collect(obj, key, out = []) {
  if (obj && typeof obj === 'object') {
    if (obj[key]) out.push(obj[key]);
    else for (const v of Object.values(obj)) collect(v, key, out);
  }
  return out;
}

/** Sube la resolución de una miniatura de googleusercontent (…=w120-h120-l90-rj → …=w1000-h1000-l90-rj). */
export const bigThumb = (url, size = 1000) => (url ? url.replace(/=w\d+-h\d+/, `=w${size}-h${size}`) : null);

const lastThumb = (renderer) => renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url
  || renderer?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || null;

export function toSeconds(text) {
  if (!/^\d+(:\d{1,2}){1,2}$/.test(text || '')) return null;
  return text.split(':').reduce((acc, n) => acc * 60 + Number(n), 0);
}

const runsOf = (col) => col?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
const endpointId = (run) => run?.navigationEndpoint?.browseEndpoint?.browseId || null;

/** Una fila de canción de búsqueda → datos planos. */
export function parseSongItem(it) {
  const title = runsOf(it.flexColumns?.[0])[0]?.text;
  const videoId = it.playlistItemData?.videoId || runsOf(it.flexColumns?.[0])[0]?.navigationEndpoint?.watchEndpoint?.videoId;
  if (!title || !videoId) return null;
  const runs = runsOf(it.flexColumns?.[1]);
  const artists = runs.filter((r) => /^UC/.test(endpointId(r) || ''));
  const albumRun = runs.find((r) => /^MPREb/.test(endpointId(r) || ''));
  const dur = runs.map((r) => toSeconds(r.text)).find((n) => n != null) ?? null;
  return {
    videoId,
    title,
    artists: artists.map((r) => ({ name: r.text, id: endpointId(r) })),
    album: albumRun ? { title: albumRun.text, id: endpointId(albumRun) } : null,
    duration: dur,
    cover: lastThumb(it.thumbnail),
  };
}

async function searchSongs(artist, title) {
  const j = await call('search', { query: `${artist} ${title}`.trim(), params: SONGS });
  return collect(j, 'musicResponsiveListItemRenderer')
    .map(parseSongItem)
    .filter(Boolean)
    .filter((s) => artistMatches(artist, title, s.artists.map((a) => a.name).join(' ')))
    .map((s) => ({ raw: s, score: score(artist, title, s.artists.map((a) => a.name).join(' '), s.title) }))
    .sort((a, b) => b.score - a.score);
}

async function albumYear(browseId) {
  try {
    const j = await call('browse', { browseId });
    const header = j.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.musicResponsiveHeaderRenderer
      || Object.values(j.header || {})[0];
    const runs = [...(header?.subtitle?.runs || []), ...(header?.straplineTextOne?.runs || [])];
    const y = runs.map((r) => r.text).find((t) => /^(19|20)\d{2}$/.test(t));
    return y || null;
  } catch {
    return null;
  }
}

async function trackDetails(s) {
  const year = s.album?.id ? await albumYear(s.album.id) : null;
  const album = s.album
    ? { id: s.album.id, title: s.album.title, url: `${BASE}/browse/${s.album.id}`, cover: bigThumb(s.cover), releaseDate: year, label: null, genres: [], recordType: null, nbTracks: null, upc: null }
    : null;
  return {
    id: s.videoId,
    url: `${BASE}/watch?v=${s.videoId}`,
    title: s.title,
    fullTitle: s.title,
    artist: s.artists[0]?.name,
    artistId: s.artists[0]?.id || null,
    contributors: s.artists.map((a) => a.name),
    album,
    duration: s.duration,
    releaseDate: year,
    isrc: null,
    bpm: null,
    rank: null,
    explicit: null,
    preview: null,
    trackPosition: null,
  };
}

const twoRow = (r) => {
  const be = r.navigationEndpoint?.browseEndpoint;
  const sub = (r.subtitle?.runs || []).map((x) => x.text);
  return {
    title: r.title?.runs?.[0]?.text,
    id: be?.browseId,
    year: sub.find((t) => /^(19|20)\d{2}$/.test(t)) || null,
    type: sub[0] && !/^\d{4}$/.test(sub[0]) ? sub[0] : null,
    cover: lastThumb(r.thumbnailRenderer),
  };
};

async function artistDetails(id) {
  const j = await call('browse', { browseId: id });
  const header = Object.values(j.header || {})[0] || {};
  const sections = j.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  const shelfTitle = (s) => s.musicShelfRenderer?.title?.runs?.[0]?.text || s.musicCarouselShelfRenderer?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.[0]?.text || '';
  const find = (re) => sections.find((s) => re.test(shelfTitle(s)));
  const carousel = (re) => (find(re)?.musicCarouselShelfRenderer?.contents || []).map((c) => c.musicTwoRowItemRenderer).filter(Boolean).map(twoRow);

  const top = (find(/^top songs$/i)?.musicShelfRenderer?.contents || [])
    .map((c) => c.musicResponsiveListItemRenderer)
    .filter(Boolean)
    .map((it) => {
      const s = parseSongItem(it);
      const t = runsOf(it.flexColumns?.[0])[0]?.text;
      const albumRun = runsOf(it.flexColumns?.[2])[0];
      const vid = it.playlistItemData?.videoId;
      return t && vid ? { title: t, url: `${BASE}/watch?v=${vid}`, album: s?.album?.title || albumRun?.text || null, duration: null } : null;
    })
    .filter(Boolean);

  const subs = header.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText?.runs?.[0]?.text || null;
  const disco = [...carousel(/^albums$/i).map((d) => ({ ...d, type: 'album' })), ...carousel(/^singles/i).map((d) => ({ ...d, type: 'single' }))]
    .filter((d) => d.title && d.id)
    .sort((x, y) => String(y.year).localeCompare(String(x.year)))
    .map((d) => ({ title: d.title, url: `${BASE}/browse/${d.id}`, year: d.year, type: d.type, cover: d.cover }));
  const related = carousel(/might also like/i).filter((r) => r.title && r.id).map((r) => ({ name: r.title, url: `${BASE}/channel/${r.id}`, picture: r.cover }));

  return {
    id,
    name: header.title?.runs?.[0]?.text,
    url: `${BASE}/channel/${id}`,
    picture: lastThumb(header.thumbnail)?.replace(/=w\d+-h\d+/, '=w600-h600') || null,
    fans: subs, // suscriptores (texto tipo "17.8M")
    albumCount: null,
    topTracks: top.slice(0, 5),
    discography: disco.slice(0, 12),
    related: related.slice(0, 6),
  };
}

async function findArtistByName(name) {
  if (!name.trim()) return null;
  const j = await call('search', { query: name, params: ARTISTS });
  const want = norm(name);
  for (const it of collect(j, 'musicResponsiveListItemRenderer')) {
    const nm = runsOf(it.flexColumns?.[0])[0]?.text;
    const id = it.navigationEndpoint?.browseEndpoint?.browseId;
    if (nm && /^UC/.test(id || '') && norm(nm) === want) return { id, name: nm };
  }
  return null;
}

export default {
  id: 'youtube',
  label: 'YouTube Music',
  ready: true,

  async lookup({ artist, title }) {
    const result = { platform: 'youtube', track: null, artist: null, trackNote: null, artistNote: null };

    const best = (await searchSongs(artist, title))[0];
    if (best && best.score >= TRACK_THRESHOLD) {
      result.track = { ...(await trackDetails(best.raw)), score: best.score, confidence: best.score >= 0.85 ? 'alta' : 'media' };
    } else {
      result.trackNote = 'Sin coincidencia en YouTube Music.';
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
        result.artistNote = 'Sin coincidencia en YouTube Music.';
      }
    }
    if (artistId) result.artist = await artistDetails(artistId);
    return result;
  },
};
