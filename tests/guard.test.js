import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientIp, createAuth, createRateLimiter, demoConfig } from '../lib/guard.js';

const basic = (user, pass) => ({ headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` }, socket: { remoteAddress: '1.2.3.4' } });
const anon = { headers: {}, socket: { remoteAddress: '1.2.3.4' } };

test('createAuth: sin contraseña no pide nada', () => {
  assert.equal(createAuth({}).check(anon), null);
  assert.equal(createAuth({}).enabled, false);
});

test('createAuth: pide contraseña, acepta cualquier usuario y rechaza la incorrecta', () => {
  const a = createAuth({ password: 's3cr3t:con-dos-puntos' });
  assert.equal(a.check(anon).status, 401);
  assert.match(a.check(anon).headers['WWW-Authenticate'], /^Basic realm=/);
  assert.equal(a.check(basic('yo', 's3cr3t:con-dos-puntos')), null);
  assert.equal(a.check(basic('', 's3cr3t:con-dos-puntos')), null);
  assert.equal(a.check(basic('yo', 'mala')).status, 401);
  assert.equal(a.check({ headers: { authorization: 'Bearer x' }, socket: anon.socket }).status, 401);
});

test('createAuth: bloquea tras 10 intentos fallidos y se recupera con el tiempo', () => {
  let t = 0;
  const a = createAuth({ password: 'ok', now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(a.check(basic('x', 'mala')).status, 401);
  const blocked = a.check(basic('x', 'mala'));
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['Retry-After']) > 0);
  t += 10 * 60_000 + 1;
  assert.equal(a.check(basic('x', 'ok')), null);
});

test('createRateLimiter: ventana deslizante por clave', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.take('a', 2).ok, true);
  assert.equal(rl.take('a', 2).ok, false); // 4 > 3
  assert.equal(rl.take('b', 3).ok, true);  // otra clave
  t = 1001;
  assert.equal(rl.take('a', 3).ok, true);
  rl.sweep();
});

test('clientIp: solo confía en las cabeceras del proxy si se pide', () => {
  const req = { headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8, 1.1.1.1' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.equal(clientIp(req, false), '10.0.0.1');
  assert.equal(clientIp(req, true), '9.9.9.9');
  delete req.headers['cf-connecting-ip'];
  assert.equal(clientIp(req, true), '8.8.8.8');
});

test('demoConfig: apagado por defecto y con valores por omisión', () => {
  assert.equal(demoConfig({}).on, false);
  const d = demoConfig({ DEMO_MODE: '1', DEMO_MAX_MINUTES: 'basura' });
  assert.equal(d.on, true);
  assert.equal(d.maxMinutes, 20);
  assert.equal(demoConfig({ DEMO_MODE: '1', DEMO_MAX_LIST: '5' }).maxList, 5);
});

test('servidor: contraseña, healthz y funciones de dueño bloqueadas en la demo', async () => {
  process.env.AUTH_PASSWORD = 'clave-de-prueba';
  process.env.DEMO_MODE = '1';
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'drs-guard-'));
  const { server } = await import('../server.js');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ok = { authorization: `Basic ${Buffer.from('u:clave-de-prueba').toString('base64')}` };
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    const noAuth = await fetch(`${base}/api/config`);
    assert.equal(noAuth.status, 401);
    assert.ok(noAuth.headers.get('www-authenticate'));
    assert.equal((await fetch(`${base}/`)).status, 401);
    assert.equal((await fetch(`${base}/api/config`, { headers: { authorization: 'Basic ' + Buffer.from('u:mala').toString('base64') } })).status, 401);

    const cfg = await (await fetch(`${base}/api/config`, { headers: ok })).json();
    assert.equal(cfg.library, false);
    assert.equal(cfg.telegram, false);
    assert.equal(cfg.demo.maxMinutes, 20);

    for (const [method, path] of [['POST', '/api/settings'], ['POST', '/api/jobs/clear'], ['POST', '/api/jobs/remove'], ['GET', '/api/history/export'], ['POST', '/api/subs'], ['POST', '/api/subs/check']]) {
      const r = await fetch(`${base}${path}`, { method, headers: { ...ok, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    assert.equal((await fetch(`${base}/`, { headers: ok })).status, 200);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
});
