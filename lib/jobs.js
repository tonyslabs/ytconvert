// Cola de trabajos con concurrencia limitada. El "cómo" de cada trabajo lo inyecta `run`.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const KEEP = 300; // trabajos terminados que se recuerdan

export class Jobs extends EventEmitter {
  constructor({ run, store, concurrency = 3, onPrune = () => {} }) {
    super();
    this.runFn = run;
    this.store = store;
    this.concurrency = concurrency;
    this.onPrune = onPrune;
    this.jobs = new Map();
    this.running = 0;
  }

  async init() {
    for (const j of await this.store.load('history', [])) this.jobs.set(j.id, j);
  }

  /** Vista pública: sin la ruta interna del archivo ni internals. */
  view(job) {
    const { spec, abort, file, ...rest } = job;
    return { ...rest, fileReady: job.status === 'done' && job.dest === 'browser' && !!file };
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => this.view(j));
  }

  get(id) {
    return this.jobs.get(id);
  }

  add(spec, origin = 'ui') {
    const job = {
      id: randomUUID(),
      origin,
      spec,
      url: spec.url,
      dest: spec.dest,
      target: spec.target,
      title: spec.title || spec.label || '',
      artist: spec.artist || '',
      status: 'queued',
      stage: 'En cola',
      pct: 0,
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.emit('add', this.view(job));
    queueMicrotask(() => this.pump());
    return this.view(job);
  }

  pump() {
    while (this.running < this.concurrency) {
      const next = [...this.jobs.values()].filter((j) => j.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!next) break;
      this.start(next);
    }
  }

  async start(job) {
    job.status = 'running';
    job.stage = 'Iniciando';
    job.startedAt = Date.now();
    job.abort = new AbortController();
    this.running++;
    try {
      const result = await this.runFn(job, (patch) => Object.assign(job, patch), job.abort.signal);
      Object.assign(job, result, { status: 'done', stage: 'Listo', pct: 100 });
    } catch (e) {
      if (job.abort.signal.aborted) Object.assign(job, { status: 'canceled', stage: 'Cancelado' });
      else Object.assign(job, { status: 'error', stage: 'Error', error: e.message || String(e) });
    } finally {
      job.finishedAt = Date.now();
      this.running--;
      await this.persist().catch((e) => console.error('history:', e.message));
      this.emit('finish', this.view(job));
      this.pump();
    }
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === 'queued') {
      Object.assign(job, { status: 'canceled', stage: 'Cancelado', finishedAt: Date.now() });
      this.persist().catch(() => {});
      return true;
    }
    if (job.status === 'running') {
      job.abort.abort();
      return true;
    }
    return false;
  }

  async remove(id) {
    const job = this.jobs.get(id);
    if (!job || ['queued', 'running'].includes(job.status)) return false;
    this.jobs.delete(id);
    this.onPrune(job);
    await this.persist();
    return true;
  }

  async clearFinished() {
    for (const [id, j] of this.jobs) {
      if (!['queued', 'running'].includes(j.status)) {
        this.jobs.delete(id);
        this.onPrune(j);
      }
    }
    await this.persist();
  }

  async persist() {
    const done = [...this.jobs.values()].filter((j) => !['queued', 'running'].includes(j.status)).sort((a, b) => b.finishedAt - a.finishedAt);
    for (const old of done.slice(KEEP)) {
      this.jobs.delete(old.id);
      this.onPrune(old);
    }
    await this.store.save('history', done.slice(0, KEEP).map(({ spec, abort, ...j }) => j));
  }
}
