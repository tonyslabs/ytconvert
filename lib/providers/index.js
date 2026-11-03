// Registro de plataformas de datos. `ready: false` = espacio reservado, aún sin implementar.
import deezer from './deezer.js';

const youtube = {
  id: 'youtube',
  label: 'YouTube',
  ready: false,
  note: 'Próximamente.',
};

const spotify = {
  id: 'spotify',
  label: 'Spotify',
  ready: false,
  note: 'Próximamente.',
};

const PROVIDERS = [youtube, spotify, deezer];

export const listProviders = () => PROVIDERS.map(({ id, label, ready, note }) => ({ id, label, ready, note: note || null }));
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id);
