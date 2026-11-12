// Protecciones opcionales para exponer Drstify: contraseña (HTTP Basic), límite de uso por IP y
// detección de la IP real tras un proxy. Sin dependencias.
import { timingSafeEqual, createHash } from 'node:crypto';

const sha = (s) => createHash('sha256').update(String(s)).digest();

// IP del cliente. Las cabeceras de proxy solo se creen si TRUST_PROXY está activo: si no, cualquiera
// podría falsificarlas para esquivar los límites.
export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'desconocida';
}

// Ventana deslizante simple: `limit` unidades por `windowMs` y por clave.
export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const hits = new Map(); // clave -> [[t, n], ...]
  const used = (key, t) => {
    const list = (hits.get(key) || []).filter(([ts]) => t - ts < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list.reduce((a, [, n]) => a + n, 0);
  };
  return {
    // Consume `n` unidades. Devuelve { ok, retryAfter } (segundos).
    take(key, n = 1) {
      const t = now();
      if (used(key, t) + n > limit) {
        const oldest = (hits.get(key) || [[t]])[0][0];
        return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) };
      }
      const list = hits.get(key) || [];
      list.push([t, n]);
      hits.set(key, list);
      return { ok: true, retryAfter: 0 };
    },
    // Quita entradas viejas (llamar de vez en cuando para no crecer sin fin).
    sweep() { const t = now(); for (const k of [...hits.keys()]) used(k, t); },
    size: () => hits.size,
  };
}

// Autenticación HTTP Basic con una sola contraseña (cualquier usuario). Desactivada si no hay contraseña.
// Tras 10 fallos desde una IP en 10 minutos, esa IP recibe 429.
export function createAuth({ password, trustProxy = false, now = Date.now } = {}) {
  const enabled = !!password;
  const expected = enabled ? sha(password) : null;
  const fails = createRateLimiter({ limit: 10, windowMs: 10 * 60_000, now });
  return {
    enabled,
    // Devuelve null si pasa, o { status, headers, error } si hay que rechazar.
    check(req) {
      if (!enabled) return null;
      const ip = clientIp(req, trustProxy);
      const challenge = { 'WWW-Authenticate': 'Basic realm="Drstify", charset="UTF-8"' };
      const header = req.headers.authorization || '';
      if (/^basic /i.test(header)) {
        const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
        const given = decoded.slice(decoded.indexOf(':') + 1);
        if (decoded.includes(':') && timingSafeEqual(sha(given), expected)) return null;
        const f = fails.take(ip);
        if (!f.ok) return { status: 429, headers: { 'Retry-After': String(f.retryAfter) }, error: 'Demasiados intentos. Esperá unos minutos.' };
      }
      return { status: 401, headers: challenge, error: 'Se necesita la contraseña.' };
    },
    sweep: () => fails.sweep(),
  };
}

// Configuración del modo demo a partir de variables de entorno. Apagado por defecto.
export function demoConfig(env = process.env) {
  const on = env.DEMO_MODE === '1' || env.DEMO_MODE === 'true';
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    on,
    maxMinutes: num(env.DEMO_MAX_MINUTES, 20),    // duración máxima por video
    maxList: num(env.DEMO_MAX_LIST, 10),          // pistas máximas al leer una playlist o canal
    jobsPerHour: num(env.DEMO_JOBS_PER_HOUR, 20), // trabajos por IP y hora
    infoPerHour: num(env.DEMO_INFO_PER_HOUR, 60), // consultas de info por IP y hora
    maxPending: num(env.DEMO_MAX_PENDING, 30),    // tope de la cola global
  };
}
