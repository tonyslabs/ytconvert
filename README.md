# ytconvert

Web local: pegás un link de YouTube y obtenés el audio en el mejor formato posible, con metadata y links a otras plataformas.

## Uso
```
npm run setup   # baja yt-dlp a ./bin (requiere ffmpeg, ffprobe y node en el PATH)
npm start       # http://127.0.0.1:3100  (PORT / HOST por variable de entorno)
npm test
```

## Qué hace
- **Un video:** `POST /api/info` (yt-dlp → metadata, pistas de audio, artista/título deducidos, links de la descripción, subtítulos disponibles). Etiqueta editable, datos de **Deezer / Spotify / YouTube Music** (`lib/providers/`) aplicables a los tags (artista, título, álbum, fecha, género, ISRC, carátula 1000×1000) y búsqueda en otras plataformas (`POST /api/links`).
- **Playlists y canales:** pegás el link y elegís qué pistas añadir a la cola. Formato, destino y "completar datos con…" valen para todo el lote.
- **Cola** (`lib/jobs.js`, `lib/pipeline.js`): hasta `CONCURRENCY` trabajos a la vez, con progreso y cancelación. Destino: tu dispositivo (se baja solo al terminar) o la **biblioteca del servidor** (`LIBRARY_DIR`, p. ej. la carpeta de Navidrome).
- **Historial** persistente (`DATA_DIR/history.json`) con exportación JSON.
- **Suscripciones** (`lib/subs.js`): vigila playlists/canales cada `SUB_CHECK_MINUTES` y baja lo nuevo a la biblioteca. Al suscribirte, lo que ya existe no se baja.
- **Modo inteligente:** el servidor recuerda formato, destino, plataforma y completado automático (`/api/settings`); lo usan la web, las suscripciones y Telegram.
- **Subtítulos SRT:** por video desde la web; en la biblioteca se guardan junto a la música para los idiomas de Ajustes.
- **Portapapeles y arrastrar/soltar:** la web ofrece el link de YouTube copiado y acepta uno soltado en la página.
- **Telegram** (`lib/telegram.js`, opcional): mandás un link al bot y se guarda en la biblioteca.

## Variables de entorno
| Variable | Para qué |
|---|---|
| `PORT`, `HOST` | Dónde escucha (por defecto `127.0.0.1:3100`) |
| `DATA_DIR` | Historial, suscripciones, ajustes y buzón de salida (por defecto `./data`) |
| `LIBRARY_DIR` | Carpeta de la biblioteca; sin ella, solo destino "dispositivo" y sin suscripciones |
| `LIBRARY_LAYOUT` | `flat` (por defecto, `Artista - Título.ext`) o `tree` (`Artista/Álbum/…`) |
| `CONCURRENCY` | Trabajos simultáneos (3) |
| `OUTBOX_HOURS` | Horas que un archivo "para bajar" sigue en el servidor (24) |
| `SUB_CHECK_MINUTES` | Cada cuánto se revisan las suscripciones (60) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Activan la fuente Spotify |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Activan el bot (sin chat id, el bot solo contesta cuál es el tuyo) |

Para desarrollo local con credenciales: `node --env-file=.env server.js` (`.env` está en `.gitignore`).

## Calidad
YouTube solo sirve audio con pérdida (Opus ~160 kbps / AAC ~128 kbps). FLAC y WAV no mejoran eso: solo evitan perder más. La mejor copia real es **Original** con la pista de mayor bitrate.

## Estructura
`server.js` (HTTP, sin dependencias) · `lib/ytdlp.js` (yt-dlp + ffmpeg) · `lib/jobs.js` + `lib/pipeline.js` (cola y ejecución) · `lib/subs.js` · `lib/telegram.js` · `lib/providers/` · `lib/parse.js` · `lib/links.js` · `public/` (front: `app.js` + `queue.js`)

## Despliegue
Push a `main` → GitHub Actions corre tests, construye la imagen (`ghcr.io/tonyslabs/ytconvert`) y el runner self-hosted del homelab hace `docker compose pull && up -d` en `~/docker/apps/ytconvert`. El compose de referencia está en `deploy/docker-compose.yml`.
- Contenedor: `ytconvert`, puerto interno **3100**, red Docker `core` (la de cloudflared). Túnel: `http://ytconvert:3100`.
- Prueba por tailnet: `http://100.76.255.29:8094`.
- Volúmenes: `/data/apps/ytconvert → /data` y `/data/shared/music → /music` (con `group_add: ["33"]` para escribir en la carpeta de `www-data`).
