#!/usr/bin/env bash
# Descarga/actualiza el binario standalone de yt-dlp en ./bin (idempotente).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p bin
curl -fsSL -o bin/yt-dlp.tmp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux
chmod +x bin/yt-dlp.tmp
mv -f bin/yt-dlp.tmp bin/yt-dlp
echo "yt-dlp $(./bin/yt-dlp --version)"
for c in ffmpeg ffprobe node; do command -v "$c" >/dev/null || { echo "Falta $c"; exit 1; }; done
echo "ffmpeg, ffprobe y node: OK"
