// Registro de plataformas de datos. `ready: false` = no disponible (p. ej. Spotify sin credenciales).
import deezer from './deezer.js';
import spotify from './spotify.js';
import youtube from './youtube.js';

const PROVIDERS = [youtube, spotify, deezer];

export const listProviders = () => PROVIDERS.map(({ id, label, ready, note }) => ({ id, label, ready, note: note || null }));
export const getProvider = (id) => PROVIDERS.find((p) => p.id === id);
