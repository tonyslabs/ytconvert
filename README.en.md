# Drstify

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Drstify: personal Docker app that downloads audio from YouTube in the best available quality. Self-hosted, single-user, no accounts, and no telemetry.**

* **Live demo:** [https://drstify.drskxll.io](https://drstify.drskxll.io) (shared and rate-limited; for regular use, deploy your own instance).
* Sibling project of [HiResSpot](https://hiresspot.drskxll.io) (hi-fi player, currently in development): Drstify downloads the audio, HiResSpot plays it.

---

## What It Is and What It Is NOT

### What It Is
* **Self-hosted and personal:** a lightweight web application to extract audio tracks from YouTube and save them either to your device or to your server library (e.g. the Navidrome music folder).
* **Rich metadata and artwork:** parses artist and title, cleans up clutter from video titles, and enriches tags with high-resolution artwork (1000×1000), release date, album, and ISRC from Deezer, Spotify, or YouTube Music.
* **Flexible downloading:** handles individual videos, full playlists, and channel uploads with batch selection.
* **Private by design:** single-user, no sign-ups, no profiles, no trackers, and no telemetry.

### What It Is NOT
* **NOT multi-user or public:** anyone with access shares the download queue, history, and global settings.
* **NOT a miraculous high-fidelity converter:** YouTube does not provide lossless audio; converting to lossless formats cannot restore audio information that was never there (see [Quality](#quality)).
* **NOT a cloud streaming platform:** all files are processed and stored locally on your own machine or server.
* **NOT an account manager:** there are no user accounts; only an optional single global password (HTTP Basic) is supported when exposed to a network.

---

## Quick Start

### With Docker (Recommended)

Use the root `docker-compose.yml`:

```bash
docker compose up -d
```

Open in your browser: [http://127.0.0.1:3100](http://127.0.0.1:3100)

To customize configuration options, copy `.env.example` to `.env` before running:

```bash
cp .env.example .env
docker compose up -d
```

### Without Docker

**Requirements:** Node.js 22+, `ffmpeg`, and `ffprobe` installed and available in your `PATH`.

```bash
# Downloads standalone yt-dlp to ./bin and checks dependencies
npm run setup

# Starts the server (http://127.0.0.1:3100 by default)
npm start
```

For development with automatic reload or environment variables:

```bash
node --env-file=.env server.js
# or
npm run dev
```

---

## Quality

The source sets the limit: **YouTube only serves lossy compressed audio** (predominantly Opus at ~160 kbps or AAC at ~128 kbps).

* Converting to **FLAC** or **WAV** **does not improve quality or restore lost frequencies**: it simply prevents further degradation from a second lossy re-encoding step.
* The best possible copy is **Original (no re-encode)**, which extracts the highest-bitrate stream exactly as delivered by YouTube.
* Available output formats:
  * `original`: Original stream without re-encoding (best real fidelity).
  * `flac`: FLAC (no loss during re-encoding).
  * `wav`: WAV PCM.
  * `mp3-320`: MP3 at 320 kbps (CBR).
  * `mp3-v0`: MP3 V0 (VBR ~245 kbps).
  * `m4a-256`: M4A (AAC at 256 kbps).
  * `opus`: Opus at 192 kbps.

*We do not promise high fidelity or true lossless audio: the source material is always lossy.*

---

## Security

* **Local-only by default:** `docker-compose.yml` publishes the port on `127.0.0.1:3100` only (without Docker the server also listens on `127.0.0.1` only). To open it to your network, change that IP and set `AUTH_PASSWORD`.
* **HTTP Basic Authentication:** if exposed to a local network (LAN) or the internet, set `AUTH_PASSWORD` in `.env`. It uses constant-time comparison (`timingSafeEqual`) and enforces rate limiting (blocks an IP for 10 minutes after 10 failed attempts).
* **Reverse Proxy & HTTPS:** when exposing the app externally, always place it behind a reverse proxy with HTTPS (Caddy, Nginx, Cloudflare Tunnel, etc.). If behind a trusted reverse proxy, set `TRUST_PROXY=1` so rate limiters see real client IPs via `CF-Connecting-IP` or `X-Forwarded-For`.
* **Shared single-user instance:** anyone with access shares the queue, download history, and settings. Never expose an instance publicly without authentication.
* **Strict URL validation:** the application only accepts links from legitimate YouTube domains (`youtube.com`, `youtu.be`, `music.youtube.com`). It does not send arbitrary external network requests.
* **Hardened Docker container:** the container runs as a non-root user (`node`), with `no-new-privileges:true`, drops all kernel capabilities (`cap_drop: [ALL]`), and limits resources (`mem_limit: 1g`, `cpus: 2`, `pids_limit: 256`).

See [SECURITY.md](SECURITY.md) for more security guidelines and vulnerability disclosure instructions.

---

## Demo Mode

If you wish to host a public preview or demonstration instance (similar to the official demo), enable `DEMO_MODE=1` in your environment variables.

When enabled:
* **Disables owner features:** turns off server library integration (`LIBRARY_DIR`), automatic subscriptions, Telegram bot, modifying global settings, and clearing history.
* **Restricts downloads to browser/device only.**
* **Enforces strict IP-based and global rate limits:**
  * Maximum video duration (`DEMO_MAX_MINUTES`, default: 20).
  * Maximum items fetched from a playlist or channel (`DEMO_MAX_LIST`, default: 10).
  * Allowed download jobs per IP per hour (`DEMO_JOBS_PER_HOUR`, default: 20).
  * Allowed metadata queries per IP per hour (`DEMO_INFO_PER_HOUR`, default: 60).
  * Global queue limit for pending jobs (`DEMO_MAX_PENDING`, default: 30).

---

## Environment Variables

All variables are optional. You can set them in `.env`:

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server listening port | `3100` |
| `HOST` | IP address to bind to | `127.0.0.1` |
| `DATA_DIR` | Directory for history, subscriptions, settings, and temporary outbox | `./data` |
| `LIBRARY_DIR` | Music library path on the server. If unset, downloads are browser-only and subscriptions are disabled | *(disabled)* |
| `LIBRARY_LAYOUT` | Folder layout for saved library tracks: `flat` (`Artist - Title.ext`) or `tree` (`Artist/Album/…`) | `flat` |
| `CONCURRENCY` | Number of simultaneous conversion and download jobs | `3` |
| `OUTBOX_HOURS` | Hours a completed browser download remains in server storage before cleanup | `24` |
| `SUB_CHECK_MINUTES` | Polling interval in minutes to check subscriptions for new tracks (minimum: 5) | `60` |
| `SPOTIFY_CLIENT_ID` | Spotify API Client ID for enhanced metadata | *(empty)* |
| `SPOTIFY_CLIENT_SECRET` | Spotify API Client Secret | *(empty)* |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token to queue downloads via direct messages | *(empty)* |
| `TELEGRAM_CHAT_ID` | Authorized Telegram chat ID (if omitted, the bot replies with your chat ID) | *(empty)* |
| `AUTH_PASSWORD` | Password for HTTP Basic auth (any username). Empty = authentication disabled | *(empty)* |
| `TRUST_PROXY` | Set to `1` to trust proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`) | *(disabled)* |
| `YTDLP_AUTOUPDATE` | Set to `1` to update `yt-dlp` automatically on container launch (`0` to disable) | `1` |
| `DEMO_MODE` | Set to `1` to enable public demo mode (disables owner features and enforces limits) | `0` |
| `DEMO_MAX_MINUTES` | Maximum video duration in minutes under demo mode | `20` |
| `DEMO_MAX_LIST` | Maximum tracks parsed from a playlist/channel under demo mode | `10` |
| `DEMO_JOBS_PER_HOUR` | Allowed downloads per IP per hour under demo mode | `20` |
| `DEMO_INFO_PER_HOUR` | Allowed metadata lookups per IP per hour under demo mode | `60` |
| `DEMO_MAX_PENDING` | Maximum pending jobs in the global queue under demo mode | `30` |

---

## Features

* **Single Video:** queries metadata with `yt-dlp`, cleans artist and title names, displays available audio formats, subtitles, and description links. Allows editing tags and enriching them via Deezer, Spotify, or YouTube Music (artist, title, album, date, genre, ISRC, and 1000×1000 cover art), alongside cross-platform streaming search.
* **Playlists and Channels:** paste a playlist or channel link, inspect tracks, and select which ones to queue. Format, destination, and metadata provider choices apply to the entire batch.
* **Queue & Concurrency:** processes up to `CONCURRENCY` jobs in parallel with live progress reporting, status updates, and cancellation support.
* **Flexible Destinations:** download files directly to your device (browser automatically triggers download when complete) or save them directly to your server music library (`LIBRARY_DIR`).
* **Persistent History:** saves completed downloads in `DATA_DIR/history.json` with JSON export.
* **Automatic Subscriptions:** checks subscribed playlists and channels every `SUB_CHECK_MINUTES`. Subscribing marks existing uploads as seen and only downloads new items to your library.
* **Smart Mode:** the server stores your preferred audio format, destination, metadata provider, and auto-enrichment preference in `settings.json` for reuse across the web UI, subscriptions, and Telegram.
* **SRT Subtitles:** download subtitles per video from the web interface; when saved to the library, subtitles in configured languages are stored alongside the audio file.
* **Clipboard & Drag-and-Drop:** the web UI auto-detects copied YouTube URLs in your clipboard and accepts dragged links dropped anywhere on the page.
* **Telegram Bot:** send a YouTube link directly to your bot and Drstify will queue and download it to your server library automatically.

---

## Legal Disclaimer

* Downloading audiovisual media from YouTube may violate the platform's Terms of Service.
* Copyright laws and private copying exceptions vary significantly across countries and jurisdictions.
* Use this tool only with content you have the lawful right to download, your own original creations, or media distributed under open licenses (such as Creative Commons) or in the public domain.
* Each instance operator is solely and entirely responsible for how their instance is used.
* This project is independent and is not affiliated, endorsed, or associated with YouTube, Google, Spotify, Deezer, or any of their trademarks.
* The software is provided "as is", without warranty of any kind, express or implied, as detailed in the MIT license.

---

## Development

### Running Tests

The test suite runs with Node.js's built-in test runner without extra dependencies:

```bash
npm test
```

### Directory Structure

```text
ytconvert/
├── server.js              # Native HTTP server (zero runtime dependencies), routing and static files
├── lib/
│   ├── ytdlp.js           # Wrapper for yt-dlp and ffmpeg
│   ├── pipeline.js        # Job execution and conversion pipeline
│   ├── jobs.js            # Queue management and concurrency control
│   ├── guard.js           # HTTP Basic authentication, rate limiting, and demo mode
│   ├── subs.js            # Subscription poller for channels and playlists
│   ├── telegram.js        # Telegram bot integration
│   ├── parse.js           # Video title cleaner, description link extractor, and URL parser
│   ├── links.js           # Multi-platform music link finder
│   ├── cover.js           # Cover artwork URL validation
│   ├── store.js           # Lightweight JSON file persistence
│   └── providers/         # Metadata clients (Deezer, Spotify, YouTube Music)
├── public/                # Vanilla frontend (app.js, queue.js, styling)
├── tests/                 # Unit test suite executed via node --test
├── scripts/               # Utility scripts (setup.sh)
├── Dockerfile             # Production container image based on node:22-bookworm-slim
├── docker-compose.yml     # Ready-to-use Docker Compose for local deployment
└── package.json           # Package metadata and scripts
```

---

## Contributing

Contributions, issues, and feature requests are welcome. Before submitting changes, please ensure that all unit tests pass by running `npm test`.

---

## License

Distributed under the [MIT License](LICENSE).
