// Limpieza de título/canal de YouTube -> artista + canción, y detección de links en la descripción.

const NOISE_WORDS =
  /\b(official|audio|video|lyrics?|letra|visuali[sz]er|hd|hq|4k|free\s*(download|dl)|download|descarga|out now|explicit|full (song|track)|music video|prod)\b/i;

export function stripNoise(s = '') {
  return s
    .replace(/[(\[{][^)\]}]*[)\]}]/g, (m) => (NOISE_WORDS.test(m) ? '' : m))
    .replace(/\s*[|/]{1,2}\s*(official|audio|video|lyrics?|free).*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
    .trim();
}

export function cleanChannel(name = '') {
  return name
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s*(official|oficial)(\s*(channel|canal))?$/i, '')
    .trim();
}

/**
 * Devuelve { artist, title, source } donde source indica de dónde salió:
 * 'metadata' (YouTube Music / contenido de catálogo), 'title' (formato "Artista - Canción"),
 * 'channel' (solo se pudo usar el canal como artista).
 */
export function parseTrack(info) {
  if (info.track && info.artist) {
    return {
      artist: String(info.artist).split(',')[0].trim(),
      title: info.track,
      source: 'metadata',
    };
  }
  const raw = stripNoise(info.title || '');
  const parts = raw.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      artist: stripNoise(parts[0]),
      title: stripNoise(parts.slice(1).join(' - ')),
      source: 'title',
    };
  }
  return {
    artist: cleanChannel(info.artist || info.uploader || info.channel || ''),
    title: raw,
    source: 'channel',
  };
}

const PLATFORMS = [
  ['Spotify', /(^|\.)spotify\.com|spotify\.link/i, 'stream'],
  ['Apple Music', /music\.apple\.com|itunes\.apple\.com/i, 'stream'],
  ['YouTube Music', /music\.youtube\.com/i, 'stream'],
  ['SoundCloud', /soundcloud\.com|snd\.sc/i, 'stream'],
  ['Bandcamp', /bandcamp\.com/i, 'stream'],
  ['Deezer', /deezer\.com|dzr\.page\.link/i, 'stream'],
  ['Tidal', /tidal\.com/i, 'stream'],
  ['Amazon Music', /music\.amazon\./i, 'stream'],
  ['Audiomack', /audiomack\.com/i, 'stream'],
  ['Beatport', /beatport\.com/i, 'stream'],
  ['Smart link', /linktr\.ee|lnk\.to|ffm\.to|smarturl\.it|hypeddit|toneden|orcd\.co|fanlink|song\.link|odesli|distrokid|bfan\.link|linkfire|found\.ee|stem\.ly|ditto\.fm|bio\.site|beacons\.ai/i, 'link'],
  ['Instagram', /instagram\.com/i, 'social'],
  ['TikTok', /tiktok\.com/i, 'social'],
  ['X / Twitter', /(^|\.)(twitter|x)\.com/i, 'social'],
  ['Facebook', /facebook\.com|fb\.me/i, 'social'],
  ['Patreon', /patreon\.com/i, 'social'],
];

export function extractLinks(text = '') {
  const found = new Map();
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      continue;
    }
    for (const [name, re, kind] of PLATFORMS) {
      if (re.test(host)) {
        if (!found.has(url)) found.set(url, { platform: name, kind, url });
        break;
      }
    }
  }
  return [...found.values()];
}

export function isYouTubeUrl(value) {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Clasifica un link de YouTube: video, playlist o canal.
 * Devuelve { kind, url, listId? } con la URL normalizada, o null si no es de YouTube.
 * Un video con `list=` sigue siendo "video" (se baja solo ese), pero trae `listId` para ofrecer la playlist.
 */
export function classifyUrl(value) {
  if (!isYouTubeUrl(value)) return null;
  const u = new URL(value);
  const path = u.pathname;
  const list = u.searchParams.get('list');
  const isShort = /youtu\.be$/i.test(u.hostname);
  const hasVideo = !!u.searchParams.get('v') || isShort || /^\/(shorts|live|embed)\//.test(path);
  const validList = list && /^[\w-]{10,}$/.test(list);

  if (validList && (/^\/playlist\/?$/.test(path) || !hasVideo)) {
    return { kind: 'playlist', url: `https://www.youtube.com/playlist?list=${list}` };
  }
  const ch = path.match(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/[^/]*)?/);
  if (ch && !hasVideo) {
    const tab = /^\/(videos|releases|shorts|streams)$/.test(ch[2] || '') ? ch[2] : '/videos';
    return { kind: 'channel', url: `https://www.youtube.com/${ch[1]}${tab}` };
  }
  return { kind: 'video', url: value, listId: validList && !/^(RD|UL)/.test(list) ? list : null };
}

export function safeFilename(s) {
  return (
    s
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 150) || 'audio'
  );
}
