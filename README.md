# ytconvert

Web local: pegás un link de YouTube y obtenés el audio en el mejor formato posible, con metadata y links a otras plataformas.

## Uso
```
npm run setup   # baja yt-dlp a ./bin (requiere ffmpeg, ffprobe y node en el PATH)
npm start       # http://127.0.0.1:3100  (PORT / HOST por variable de entorno)
npm test
```

## Qué hace
- `POST /api/info`: yt-dlp lee el video → metadata, pistas de audio disponibles, artista/título deducidos, links de plataformas en la descripción.
- `POST /api/links`: busca la canción en Apple Music (iTunes), Deezer, MusicBrainz y Odesli. Solo marca "encontrado" si título/artista coinciden; si no, ofrece links de búsqueda manual (Spotify, YT Music, SoundCloud, Bandcamp, Tidal, etc.).
- `POST /api/download`: baja la pista elegida y la convierte con ffmpeg (FLAC, WAV, MP3 320/V0, M4A, Opus u original sin recodificar) con tags y carátula cuadrada.

## Calidad
YouTube solo sirve audio con pérdida (Opus ~160 kbps / AAC ~128 kbps). FLAC y WAV no mejoran eso: solo evitan perder más. La mejor copia real es **Original** con la pista de mayor bitrate.

## Estructura
`server.js` (HTTP, sin dependencias) · `lib/ytdlp.js` (yt-dlp + ffmpeg) · `lib/parse.js` · `lib/links.js` · `public/` (front)

## Despliegue
Push a `main` → GitHub Actions corre tests, construye la imagen (`ghcr.io/tonyslabs/ytconvert`) y el runner self-hosted del homelab hace `docker compose pull && up -d` en `~/docker/apps/ytconvert`. El compose de referencia está en `deploy/docker-compose.yml`.
- Contenedor: `ytconvert`, puerto interno **3100**, red Docker `core` (la de cloudflared). Túnel: `http://ytconvert:3100`.
- Prueba por tailnet: `http://100.76.255.29:8094`.
