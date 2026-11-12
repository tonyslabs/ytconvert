// Persistencia mínima en JSON (sin dependencias). Escritura atómica y serializada por archivo.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export function createStore(dir) {
  const chains = new Map();

  async function load(name, fallback) {
    try {
      return JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'));
    } catch {
      return structuredClone(fallback);
    }
  }

  function save(name, data) {
    const json = JSON.stringify(data, null, 1);
    const file = join(dir, `${name}.json`);
    const next = (chains.get(name) || Promise.resolve()).then(async () => {
      await mkdir(dir, { recursive: true });
      await writeFile(`${file}.tmp`, json);
      await rename(`${file}.tmp`, file);
    });
    chains.set(name, next.catch(() => {}));
    return next;
  }

  return { load, save, dir };
}
