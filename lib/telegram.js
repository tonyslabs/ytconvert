// Descargas remotas por Telegram: mandás un link al bot y se guarda en la biblioteca.
// Solo responde al chat autorizado. Usa long polling (no hace falta abrir puertos).
import { classifyUrl } from './parse.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_RE = /https?:\/\/[^\s<>"']+/i;

export function createTelegram({ token, chatId, jobs, list, getSettings, fetchImpl = fetch, maxBatch = 25 }) {
  let stopped = false;
  const api = async (method, body) => {
    const r = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Error de Telegram');
    return j.result;
  };
  const say = (chat, text) => api('sendMessage', { chat_id: chat, text, disable_web_page_preview: true }).catch(() => {});

  async function handle(msg) {
    if (!msg?.chat) return;
    const chat = msg.chat.id;
    if (!chatId) return say(chat, `Tu chat id es ${chat}. Ponelo en TELEGRAM_CHAT_ID y reiniciá el servidor.`);
    if (String(chat) !== String(chatId)) return;
    const text = msg.text || '';

    if (/^\/(start|ayuda|help)\b/.test(text)) return say(chat, 'Mandame un link de YouTube (video, playlist o canal) y lo guardo en la biblioteca. /estado muestra la cola.');
    if (/^\/estado\b/.test(text)) {
      const all = jobs.list();
      const run = all.filter((j) => j.status === 'running').length;
      const q = all.filter((j) => j.status === 'queued').length;
      return say(chat, `En curso: ${run} · En cola: ${q}`);
    }

    const m = text.match(URL_RE);
    const c = m && classifyUrl(m[0].replace(/[.,;!?)]+$/, ''));
    if (!c) return say(chat, 'No vi un link de YouTube en ese mensaje.');
    const cfg = await getSettings();
    const base = { target: cfg.target, dest: 'library', autoMeta: cfg.autoMeta || null, subLangs: cfg.subLangs };

    if (c.kind === 'video') {
      jobs.add({ ...base, url: c.url }, 'telegram');
      return say(chat, 'En cola 1 pista.');
    }
    const { title, entries } = await list(c.url, maxBatch);
    entries.forEach((e) => jobs.add({ ...base, url: e.url }, 'telegram'));
    return say(chat, `En cola ${entries.length} pistas de "${title || 'la lista'}" (máximo ${maxBatch} por mensaje).`);
  }

  jobs.on('finish', (j) => {
    if (j.origin !== 'telegram' || !chatId) return;
    if (j.status === 'done') say(chatId, `Listo: ${j.name}`);
    else if (j.status === 'error') say(chatId, `Falló ${j.title || j.url}: ${j.error}`);
  });

  async function loop() {
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await api('getUpdates', { timeout: 30, offset, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          await handle(u.message).catch((e) => console.error('telegram:', e.message));
        }
      } catch (e) {
        console.error('telegram:', e.message);
        await sleep(10_000);
      }
    }
  }

  return { start: () => { loop(); }, stop: () => { stopped = true; }, handle };
}
