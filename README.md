# Drstify

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Drstify: app Docker para uso personal que descarga el audio de YouTube en la mejor calidad disponible. Se autoaloja, un solo usuario, sin cuentas ni telemetría.**

* **Demo de prueba:** [https://drstify.drskxll.io](https://drstify.drskxll.io) (compartida y con límites; para uso real, instala tu propia copia).
* Es hermano de [HiResSpot](https://hiresspot.drskxll.io) (reproductor hi-fi, aún en preparación): Drstify baja el audio, HiResSpot lo reproduce.

---

## Qué es y qué NO es

### Qué es
* **Autoalojado y personal:** una aplicación web ligera para extraer pistas de audio de YouTube y guardarlas en tu dispositivo o en la biblioteca de tu servidor (por ejemplo, la carpeta de música de Navidrome).
* **Metadatos y carátulas:** detecta artista y título, elimina texto sobrante de videos y enriquece los tags con carátulas en alta resolución (1000×1000), fecha, álbum e ISRC desde Deezer, Spotify o YouTube Music.
* **Descarga flexible:** soporta videos individuales, listas de reproducción completas y canales de YouTube con selección por lotes.
* **Privacidad por diseño:** un solo usuario, sin inicio de sesión, sin perfiles, sin rastreadores ni telemetría.

### Qué NO es
* **NO es multiusuario ni público:** quien tiene acceso comparte la cola de descargas, el historial y los ajustes globales.
* **NO es un conversor milagroso de alta fidelidad:** YouTube no ofrece audio sin pérdida; convertir a formatos sin pérdida no añade fidelidad inexistente (ver [Calidad](#calidad)).
* **NO es una plataforma de streaming en la nube:** procesa y almacena los archivos en tu propio equipo o servidor.
* **NO gestiona cuentas de usuario:** no hay base de datos de usuarios; solo admite una contraseña global opcional si se expone en red.

---

## Inicio rápido

### Con Docker (recomendado)

Usa el archivo `docker-compose.yml` incluido en la raíz del repositorio:

```bash
docker compose up -d
```

Abre en tu navegador: [http://127.0.0.1:3100](http://127.0.0.1:3100)

Si deseas personalizar rutas o configuraciones, copia `.env.example` a `.env` antes de levantar el contenedor:

```bash
cp .env.example .env
docker compose up -d
```

### Sin Docker

**Requisitos:** Node.js 22+, `ffmpeg` y `ffprobe` instalados y disponibles en el `PATH`.

```bash
# Descarga yt-dlp standalone a ./bin y comprueba dependencias
npm run setup

# Inicia el servidor (http://127.0.0.1:3100 por defecto)
npm start
```

Para desarrollo con recarga automática o variables personalizadas:

```bash
node --env-file=.env server.js
# o bien
npm run dev
```

---

## Calidad

La fuente manda: **YouTube solo sirve audio comprimido con pérdida (lossy)** (principalmente Opus a ~160 kbps o AAC a ~128 kbps).

* Convertir a **FLAC** o **WAV** **no mejora la calidad ni recupera frecuencias perdidas**: únicamente evita degradar más el sonido con una segunda compresión con pérdida.
* La mejor copia real posible es **Original (sin recodificar)**, que extrae la pista con el mayor bitrate disponible tal cual la entrega YouTube.
* Formatos disponibles:
  * `original`: Original sin recodificar (mejor fidelidad real).
  * `flac`: FLAC (sin pérdida de recompresión).
  * `wav`: WAV PCM.
  * `mp3-320`: MP3 a 320 kbps (CBR).
  * `mp3-v0`: MP3 V0 (VBR ~245 kbps).
  * `m4a-256`: M4A (AAC a 256 kbps).
  * `opus`: Opus a 192 kbps.

*No prometemos alta fidelidad ni audio lossless verdadero: la fuente original siempre es con pérdida.*

---

## Seguridad

* **Solo local por defecto:** el `docker-compose.yml` publica el puerto únicamente en `127.0.0.1:3100` (sin Docker, el servidor también escucha solo en `127.0.0.1`). Para abrirlo a tu red, cambia esa IP y define `AUTH_PASSWORD`.
* **Autenticación HTTP Basic:** si abres el servicio a tu red local (LAN) o a internet, define `AUTH_PASSWORD` en `.env`. Utiliza comparación en tiempo constante (`timingSafeEqual`) y bloquea direcciones tras 10 intentos fallidos en 10 minutos.
* **Proxy inverso y HTTPS:** al exponer la app externamente, ponla siempre detrás de un proxy con HTTPS (Caddy, Nginx, Cloudflare Tunnel, etc.). Si usas un proxy de confianza, activa `TRUST_PROXY=1` para que los límites identifiquen la IP real del cliente mediante `CF-Connecting-IP` o `X-Forwarded-For`.
* **Sin cuentas separadas:** quien accede comparte cola, historial y ajustes. No expongas una instancia sin contraseña.
* **Validación de URLs:** la aplicación solo procesa enlaces hacia dominios válidos de YouTube (`youtube.com`, `youtu.be`, `music.youtube.com`). No realiza peticiones a URLs arbitrarias.
* **Contenedor endurecido:** el contenedor Docker corre como usuario no root (`node`), con `no-new-privileges:true`, descarta todas las capacidades del kernel (`cap_drop: [ALL]`) y limita memoria (`1g`), CPU (`2`) y procesos (`pids_limit: 256`).

Consulta [SECURITY.md](SECURITY.md) para más detalles sobre la política de seguridad y reporte de vulnerabilidades.

---

## Modo demo

Si deseas poner en línea una instancia pública de demostración (como la demo oficial), activa `DEMO_MODE=1` en tus variables de entorno.

Al activarse:
* **Deshabilita funciones del dueño:** apaga la biblioteca en el servidor (`LIBRARY_DIR`), suscripciones automáticas, bot de Telegram, edición de ajustes globales y borrado de historial.
* **Solo permite descargas al navegador/dispositivo.**
* **Aplica límites estrictos por IP y globales:**
  * Duración máxima por video (`DEMO_MAX_MINUTES`, por defecto 20).
  * Límite de pistas leídas en playlists o canales (`DEMO_MAX_LIST`, por defecto 10).
  * Descargas por IP y por hora (`DEMO_JOBS_PER_HOUR`, por defecto 20).
  * Consultas de información por IP y por hora (`DEMO_INFO_PER_HOUR`, por defecto 60).
  * Límite de trabajos pendientes en la cola (`DEMO_MAX_PENDING`, por defecto 30).

---

## Variables de entorno

Todas las variables son opcionales. Puedes definirlas en `.env`:

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `PORT` | Puerto de escucha del servidor HTTP | `3100` |
| `HOST` | Dirección IP donde escucha el servidor | `127.0.0.1` |
| `DATA_DIR` | Directorio para historial, suscripciones, ajustes y descargas temporales | `./data` |
| `LIBRARY_DIR` | Ruta de la biblioteca de música en el servidor. Si se omite, solo se permite descargar al dispositivo y no hay suscripciones | *(desactivado)* |
| `LIBRARY_LAYOUT` | Organización de la biblioteca: `flat` (`Artista - Título.ext`) o `tree` (`Artista/Álbum/…`) | `flat` |
| `CONCURRENCY` | Cantidad de conversiones y descargas simultáneas | `3` |
| `OUTBOX_HOURS` | Horas que un archivo listo para descargar al navegador permanece en el servidor | `24` |
| `SUB_CHECK_MINUTES` | Intervalo en minutos para revisar canales y playlists suscritos (mínimo 5) | `60` |
| `SPOTIFY_CLIENT_ID` | Client ID de Spotify API para enriquecer metadatos | *(vacío)* |
| `SPOTIFY_CLIENT_SECRET` | Client Secret de Spotify API | *(vacío)* |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram para encolar enlaces por chat | *(vacío)* |
| `TELEGRAM_CHAT_ID` | ID del chat de Telegram autorizado (si se omite, el bot solo responde cuál es tu ID) | *(vacío)* |
| `AUTH_PASSWORD` | Contraseña para HTTP Basic (cualquier usuario). Vacío = sin autenticación | *(vacío)* |
| `TRUST_PROXY` | `1` para confiar en cabeceras de proxy (`CF-Connecting-IP`, `X-Forwarded-For`) | *(desactivado)* |
| `YTDLP_AUTOUPDATE` | `1` para actualizar `yt-dlp` al arrancar el contenedor (`0` para omitir) | `1` |
| `DEMO_MODE` | `1` activa el modo demo público (apaga funciones de dueño y activa límites) | `0` |
| `DEMO_MAX_MINUTES` | Minutos máximos por video en modo demo | `20` |
| `DEMO_MAX_LIST` | Pistas máximas leídas de playlist/canal en modo demo | `10` |
| `DEMO_JOBS_PER_HOUR` | Descargas permitidas por IP y hora en modo demo | `20` |
| `DEMO_INFO_PER_HOUR` | Consultas de metadatos permitidas por IP y hora en modo demo | `60` |
| `DEMO_MAX_PENDING` | Trabajos pendientes máximos en la cola en modo demo | `30` |

---

## Funciones

* **Un video:** consulta metadatos con `yt-dlp`, deduce artista y título limpios, muestra pistas de audio disponibles, subtítulos y links encontrados en la descripción. Permite editar etiquetas y completar metadatos con Deezer, Spotify o YouTube Music (artista, título, álbum, fecha, género, ISRC y carátula 1000×1000), además de buscar el tema en otras plataformas de streaming.
* **Playlists y canales:** pega el enlace de una lista o canal, revisa las pistas y selecciona cuáles añadir a la cola. Los ajustes de formato, destino y proveedor de metadatos aplican a todo el lote.
* **Cola de descargas:** gestiona hasta `CONCURRENCY` trabajos en paralelo con barra de progreso, estado en tiempo real y opción de cancelación.
* **Destinos de descarga:** guarda el archivo directamente en tu dispositivo (el navegador lo descarga al finalizar) o envíalo a la biblioteca local del servidor (`LIBRARY_DIR`).
* **Historial persistente:** almacena las descargas completadas en `DATA_DIR/history.json` con exportación a JSON.
* **Suscripciones automáticas:** comprueba periódicamente listas y canales cada `SUB_CHECK_MINUTES`. Al suscribirte marca lo existente como visto y solo descarga el material nuevo a la biblioteca.
* **Modo inteligente:** recuerda en el servidor el formato de audio favorito, destino, proveedor de metadatos y completado automático para reutilizarlos en la web, suscripciones y Telegram.
* **Subtítulos SRT:** descarga subtítulos por video desde la interfaz web; en la biblioteca se guardan junto al archivo de audio para los idiomas configurados.
* **Portapapeles y arrastrar y soltar:** la interfaz web detecta enlaces de YouTube copiados en el portapapeles y permite soltar URLs directamente en la ventana.
* **Bot de Telegram:** envía un link al bot y Drstify lo encolará automáticamente para guardarlo en la biblioteca.

---

## Aviso legal

* Descargar contenido audiovisual desde YouTube puede infringir los Términos de Servicio de la plataforma.
* Las leyes relativas a derechos de autor, propiedad intelectual y copia privada varían según la legislación de cada país.
* Utiliza esta herramienta exclusivamente con contenido sobre el que tengas derechos legítimos de descarga, creaciones propias o material bajo licencias libres (Creative Commons) o de dominio público.
* Cada operador es responsable del uso que haga de su propia instancia.
* Este proyecto es independiente y no está afiliado, respaldado ni asociado con YouTube, Google, Spotify, Deezer ni ninguna de sus filiales.
* El software se proporciona "tal cual" (*as is*), sin garantías de ningún tipo, expresas o implícitas, según lo establecido en la licencia MIT.

---

## Desarrollo

### Ejecución de pruebas

El proyecto no utiliza frameworks de prueba pesados; corre con el test runner nativo de Node.js:

```bash
npm test
```

### Estructura de carpetas

```text
ytconvert/
├── server.js              # Servidor HTTP nativo (sin dependencias externas), rutas y estáticos
├── lib/
│   ├── ytdlp.js           # Wrapper de yt-dlp y ffmpeg
│   ├── pipeline.js        # Ejecución y pipeline de conversión
│   ├── jobs.js            # Gestión de la cola de trabajos y concurrencia
│   ├── guard.js           # Autenticación HTTP Basic, rate limiting y modo demo
│   ├── subs.js            # Monitoreo de suscripciones a canales y playlists
│   ├── telegram.js        # Integración con bot de Telegram
│   ├── parse.js           # Limpieza de títulos, extracción de links y parseo de URLs
│   ├── links.js           # Búsqueda de pistas en plataformas de streaming
│   ├── cover.js           # Validación de URLs de carátulas
│   ├── store.js           # Persistencia en archivos JSON
│   └── providers/         # Clientes de metadatos (Deezer, Spotify, YouTube Music)
├── public/                # Frontend web vanilla (app.js, queue.js, estilos)
├── tests/                 # Pruebas unitarias ejecutables con node --test
├── scripts/               # Scripts auxiliares (setup.sh)
├── Dockerfile             # Imagen de producción basada en node:22-bookworm-slim
├── docker-compose.yml     # Compose listo para despliegue local
└── package.json           # Scripts de proyecto y configuración básica
```

---

## Contribuir

Las contribuciones, sugerencias y reportes de errores son bienvenidos a través de issues y pull requests. Antes de enviar un cambio, asegúrate de que todos los tests pasen ejecutando `npm test`.

---

## Licencia

Distribuido bajo la [Licencia MIT](LICENSE).
