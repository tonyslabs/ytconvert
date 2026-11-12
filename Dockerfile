FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

# yt-dlp standalone; se actualiza solo al arrancar porque YouTube lo rompe seguido
RUN mkdir -p bin \
 && curl -fsSL -o bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod +x bin/yt-dlp && ./bin/yt-dlp --version \
 && mkdir -p /data && chown -R node:node /app /data

USER node
ENV HOST=0.0.0.0 PORT=3100 NODE_ENV=production DATA_DIR=/data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "(./bin/yt-dlp -U >/dev/null 2>&1 || true) & exec node server.js"]
