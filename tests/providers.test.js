import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSongItem, bigThumb, toSeconds, collect } from '../lib/providers/youtube.js';
import { artistMatches } from '../lib/links.js';

const run = (text, browseId) => ({ text, ...(browseId ? { navigationEndpoint: { browseEndpoint: { browseId } } } : {}) });
const item = {
  playlistItemData: { videoId: 'abc123' },
  thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/x=w60-h60-l90-rj' }, { url: 'https://yt3.googleusercontent.com/x=w120-h120-l90-rj' }] } } },
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('Hotel Room Service')] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [run('Pitbull', 'UC03jIQ'), run(' & '), run('Otro', 'UC999'), run(' • '), run('Mi Álbum', 'MPREb_1'), run(' • '), run('3:59')] } } },
  ],
};

test('parseSongItem extrae título, artistas, álbum y duración', () => {
  const s = parseSongItem(item);
  assert.equal(s.videoId, 'abc123');
  assert.equal(s.title, 'Hotel Room Service');
  assert.deepEqual(s.artists.map((a) => a.name), ['Pitbull', 'Otro']);
  assert.deepEqual(s.album, { title: 'Mi Álbum', id: 'MPREb_1' });
  assert.equal(s.duration, 239);
  assert.match(s.cover, /w120-h120/);
});

test('parseSongItem devuelve null si falta título o videoId', () => {
  assert.equal(parseSongItem({ flexColumns: [] }), null);
});

test('toSeconds y bigThumb', () => {
  assert.equal(toSeconds('1:02:03'), 3723);
  assert.equal(toSeconds('742M plays'), null);
  assert.equal(bigThumb('https://x/y=w120-h120-l90-rj'), 'https://x/y=w1000-h1000-l90-rj');
  assert.equal(bigThumb(null), null);
});

test('collect encuentra nodos anidados', () => {
  assert.equal(collect({ a: [{ b: { k: 1 } }, { k: 2 }] }, 'k').length, 2);
});

test('artistMatches rechaza otro artista con el mismo título y acepta colaboraciones', () => {
  assert.equal(artistMatches('Doly Flackko', 'Bandolera', 'Anuel AA'), false);
  assert.equal(artistMatches('Pitbull', 'Hotel Room Service', 'Pitbull Otro'), true);
  assert.equal(artistMatches('', 'x', 'Cualquiera'), true);
});
