// Suscripciones: vigila playlists/canales y encola lo nuevo hacia la biblioteca.
import { randomUUID } from 'node:crypto';

const SEEN_MAX = 600;

export class Subs {
  constructor({ store, jobs, list, getSettings, intervalMs = 3600_000 }) {
    Object.assign(this, { store, jobs, list, getSettings, intervalMs });
    this.items = [];
    this.timer = null;
  }

  async init() {
    this.items = await this.store.load('subs', []);
    this.timer = setInterval(() => this.checkAll().catch(() => {}), this.intervalMs);
    this.timer.unref?.();
  }

  view() {
    return this.items.map(({ seen, ...s }) => ({ ...s, seenCount: seen.length }));
  }

  /** Alta: lo que ya existe se marca como visto (no se baja el catálogo viejo). */
  async add(url, kind) {
    if (this.items.some((s) => s.url === url)) throw new Error('Ya estás suscrito a eso.');
    const { title, entries } = await this.list(url, 50);
    const item = { id: randomUUID(), url, kind, title: title || url, enabled: true, addedAt: Date.now(), lastChecked: Date.now(), lastNew: 0, lastError: null, seen: entries.map((e) => e.id) };
    this.items.push(item);
    await this.save();
    return item;
  }

  async remove(id) {
    const n = this.items.length;
    this.items = this.items.filter((s) => s.id !== id);
    await this.save();
    return this.items.length < n;
  }

  async setEnabled(id, enabled) {
    const s = this.items.find((x) => x.id === id);
    if (!s) return false;
    s.enabled = !!enabled;
    await this.save();
    return true;
  }

  async checkAll() {
    for (const s of this.items) if (s.enabled) await this.check(s);
  }

  async check(s) {
    try {
      const { entries } = await this.list(s.url, 15);
      const seen = new Set(s.seen);
      const fresh = entries.filter((e) => !seen.has(e.id)).reverse(); // los más viejos primero
      const cfg = await this.getSettings();
      for (const e of fresh) {
        this.jobs.add({ url: e.url, title: undefined, target: cfg.target, dest: 'library', autoMeta: cfg.autoMeta || null, subLangs: cfg.subLangs }, `sub:${s.id}`);
        s.seen.push(e.id);
      }
      s.seen = s.seen.slice(-SEEN_MAX);
      s.lastNew = fresh.length;
      s.lastError = null;
    } catch (e) {
      s.lastError = e.message;
    }
    s.lastChecked = Date.now();
    await this.save();
  }

  save() {
    return this.store.save('subs', this.items);
  }
}
