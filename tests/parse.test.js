import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTrack, extractLinks, isYouTubeUrl, safeFilename } from '../lib/parse.js';
import { score } from '../lib/links.js';

test('parseTrack: "Artista - Canción (Official Audio)"', () => {
  const r = parseTrack({ title: 'Doly Flackko - Mi Canción (Official Audio) [Free Download]', uploader: 'Doly Flackko' });
  assert.deepEqual(r, { artist: 'Doly Flackko', title: 'Mi Canción', source: 'title' });
});

test('parseTrack: conserva feat. y usa metadata de YT Music', () => {
  assert.equal(parseTrack({ title: 'A - B (feat. C)' }).title, 'B (feat. C)');
  assert.equal(parseTrack({ track: 'T', artist: 'X, Y', title: 'x' }).artist, 'X');
});

test('parseTrack: sin separador cae al canal', () => {
  const r = parseTrack({ title: 'Solo título', uploader: 'Alguien - Topic' });
  assert.equal(r.artist, 'Alguien');
  assert.equal(r.source, 'channel');
});

test('extractLinks detecta plataformas y descarta el resto', () => {
  const l = extractLinks('Spotify: https://open.spotify.com/track/abc. IG https://instagram.com/x y https://ejemplo.com/z');
  assert.deepEqual(l.map((x) => x.platform), ['Spotify', 'Instagram']);
  assert.equal(l[0].url, 'https://open.spotify.com/track/abc');
});

test('isYouTubeUrl', () => {
  assert.ok(isYouTubeUrl('https://youtu.be/abc'));
  assert.ok(isYouTubeUrl('https://music.youtube.com/watch?v=abc'));
  assert.ok(!isYouTubeUrl('https://evil.com/youtube.com'));
  assert.ok(!isYouTubeUrl('file:///etc/passwd'));
});

test('safeFilename', () => assert.equal(safeFilename('a/b:c*d?'), 'abcd'));

test('score: coincidencia alta vs. baja', () => {
  assert.ok(score('Doly Flackko', 'Mi Canción', 'Doly Flackko', 'Mi Cancion') >= 0.85);
  assert.ok(score('Doly Flackko', 'Mi Canción', 'Otro', 'Otra cosa') < 0.3);
});
