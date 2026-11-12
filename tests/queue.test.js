import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyUrl } from '../lib/parse.js';
import { createStore } from '../lib/store.js';
import { Jobs } from '../lib/jobs.js';
import { Subs } from '../lib/subs.js';
import { createTelegram } from '../lib/telegram.js';
import { uniquePath, segment } from '../lib/pipeline.js';

const tmp = () => mkdtemp(join(tmpdir(), 'drs-test-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(5); } };

test('classifyUrl distingue video, playlist y canal', () => {
  assert.equal(classifyUrl('https://example.com/x'), null);
  assert.deepEqual(classifyUrl('https://www.youtube.com/watch?v=abcdefghijk'), { kind: 'video', url: 'https://www.youtube.com/watch?v=abcdefghijk', listId: null });
  const v = classifyUrl('https://youtu.be/abcdefghijk?list=PLabcdefghij123');
  assert.equal(v.kind, 'video');
  assert.equal(v.listId, 'PLabcdefghij123');
  assert.equal(classifyUrl('https://youtu.be/abcdefghijk?list=RDabcdefghij123').listId, null); // mixes automáticos no
  assert.deepEqual(classifyUrl('https://music.youtube.com/playlist?list=OLAK5uy_abcdefghij'), { kind: 'playlist', url: 'https://www.youtube.com/playlist?list=OLAK5uy_abcdefghij' });
  assert.equal(classifyUrl('https://www.youtube.com/@Pitbull').url, 'https://www.youtube.com/@Pitbull/videos');
  assert.equal(classifyUrl('https://www.youtube.com/channel/UC123/releases').url, 'https://www.youtube.com/channel/UC123/releases');
});

test('Jobs: respeta la concurrencia y el orden', async () => {
  const store = createStore(await tmp());
  let active = 0, peak = 0;
  const order = [];
  const jobs = new Jobs({
    store, concurrency: 2,
    run: async (job) => { active++; peak = Math.max(peak, active); order.push(job.spec.n); await wait(20); active--; return { name: `${job.spec.n}.flac`, size: 1 }; },
  });
  for (let n = 1; n <= 5; n++) jobs.add({ url: 'u', n, dest: 'library' });
  await until(() => jobs.list().every((j) => j.status === 'done'));
  assert.equal(peak, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
});

test('Jobs: error, cancelar en cola y vista sin ruta interna', async () => {
  const store = createStore(await tmp());
  const jobs = new Jobs({
    store, concurrency: 1,
    run: async (job, update, signal) => {
      if (job.spec.fail) throw new Error('boom');
      if (job.spec.slow) await new Promise((res, rej) => signal.addEventListener('abort', () => rej(new Error('Cancelado'))));
      return { name: 'a.flac', size: 1, file: '/secreto/a.flac' };
    },
  });
  const slow = jobs.add({ url: 'u', slow: true, dest: 'browser' });
  const queued = jobs.add({ url: 'u', dest: 'browser' });
  await until(() => jobs.get(slow.id).status === 'running');
  assert.equal(jobs.cancel(queued.id), true);
  assert.equal(jobs.cancel(slow.id), true);
  await until(() => jobs.get(slow.id).status === 'canceled');
  const bad = jobs.add({ url: 'u', fail: true, dest: 'browser' });
  const ok = jobs.add({ url: 'u', dest: 'browser' });
  await until(() => jobs.get(ok.id).status === 'done');
  assert.equal(jobs.get(bad.id).status, 'error');
  assert.equal(jobs.get(bad.id).error, 'boom');
  const view = jobs.list().find((j) => j.id === ok.id);
  assert.equal(view.file, undefined);
  assert.equal(view.fileReady, true);
});

test('Jobs: el historial sobrevive a un reinicio', async () => {
  const dir = await tmp();
  const a = new Jobs({ store: createStore(dir), run: async () => ({ name: 'x.flac', size: 3 }) });
  const j = a.add({ url: 'u', dest: 'library' });
  await until(() => a.get(j.id).status === 'done');
  await wait(30);
  const b = new Jobs({ store: createStore(dir), run: async () => ({}) });
  await b.init();
  assert.equal(b.get(j.id).name, 'x.flac');
  assert.equal(b.get(j.id).spec, undefined);
});

test('Subs: alta marca lo existente como visto y solo encola lo nuevo', async () => {
  const store = createStore(await tmp());
  const added = [];
  const fake = { add: (spec, origin) => added.push({ spec, origin }) };
  let entries = [{ id: 'aaaaaaaaaaa', url: 'ua' }, { id: 'bbbbbbbbbbb', url: 'ub' }];
  const subs = new Subs({ store, jobs: fake, list: async () => ({ title: 'Canal', entries }), getSettings: async () => ({ target: 'flac', autoMeta: 'deezer', subLangs: ['es'] }) });
  const item = await subs.add('https://www.youtube.com/@x/videos', 'channel');
  await subs.check(item);
  assert.equal(added.length, 0);
  entries = [{ id: 'ccccccccccc', url: 'uc' }, ...entries];
  await subs.check(item);
  assert.equal(added.length, 1);
  assert.equal(added[0].spec.url, 'uc');
  assert.equal(added[0].spec.dest, 'library');
  assert.equal(added[0].origin, `sub:${item.id}`);
  await subs.check(item);
  assert.equal(added.length, 1); // no repite
  await assert.rejects(() => subs.add('https://www.youtube.com/@x/videos', 'channel'), /Ya estás suscrito/);
});

test('Telegram: ignora chats ajenos, encola links y responde', async () => {
  const sent = [];
  const jobsFake = { list: () => [], on: () => {}, added: [], add(spec, origin) { this.added.push({ spec, origin }); } };
  const fetchImpl = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { json: async () => ({ ok: true, result: {} }) }; };
  const tg = createTelegram({ token: 'T', chatId: '42', jobs: jobsFake, list: async () => ({ title: 'Lista', entries: [{ url: 'u1' }, { url: 'u2' }] }), getSettings: async () => ({ target: 'flac', autoMeta: '', subLangs: [] }), fetchImpl });
  await tg.handle({ chat: { id: 99 }, text: 'https://youtu.be/abcdefghijk' });
  assert.equal(jobsFake.added.length, 0);
  assert.equal(sent.length, 0); // no le contesta a extraños
  await tg.handle({ chat: { id: 42 }, text: 'mirá esto https://youtu.be/abcdefghijk' });
  assert.equal(jobsFake.added.length, 1);
  assert.equal(jobsFake.added[0].spec.dest, 'library');
  assert.equal(jobsFake.added[0].origin, 'telegram');
  await tg.handle({ chat: { id: 42 }, text: 'https://www.youtube.com/playlist?list=PLabcdefghij123' });
  assert.equal(jobsFake.added.length, 3);
  await tg.handle({ chat: { id: 42 }, text: 'hola' });
  assert.match(sent.at(-1).body.text, /No vi un link/);
});

test('Telegram sin TELEGRAM_CHAT_ID solo dice el chat id', async () => {
  const sent = [];
  const jobsFake = { list: () => [], on: () => {}, add() { throw new Error('no debe encolar'); } };
  const tg = createTelegram({ token: 'T', chatId: '', jobs: jobsFake, list: async () => ({}), getSettings: async () => ({}), fetchImpl: async (u, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ ok: true, result: {} }) }; } });
  await tg.handle({ chat: { id: 7 }, text: 'https://youtu.be/abcdefghijk' });
  assert.match(sent[0].text, /chat id es 7/);
});

test('uniquePath no pisa archivos existentes', async () => {
  const dir = await tmp();
  const f = join(dir, 'A - B.flac');
  assert.equal(await uniquePath(f), f);
  await writeFile(f, 'x');
  assert.equal(await uniquePath(f), join(dir, 'A - B (2).flac'));
});

test('segment: no permite escapar de la biblioteca', () => {
  assert.equal(segment('..', 'x'), '_');
  assert.equal(segment('.', 'x'), '_');
  assert.equal(segment('../../etc', 'x'), '....etc');
  assert.equal(segment('', 'Desconocido'), 'Desconocido');
  assert.equal(segment('AC/DC', 'x'), 'ACDC');
});
