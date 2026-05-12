FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY web ./web

# Fetch self-hosted woff2 fonts at build time so the running container has no
# third-party CDN dependency. If the network is unavailable, the build fails
# loudly rather than silently shipping system-font fallbacks.
RUN mkdir -p web/fonts \
 && curl -fsSL -o web/fonts/Fraunces.woff2 \
      https://cdn.jsdelivr.net/fontsource/fonts/fraunces:vf@latest/latin-wght-normal.woff2 \
 && curl -fsSL -o web/fonts/Fraunces-Italic.woff2 \
      https://cdn.jsdelivr.net/fontsource/fonts/fraunces:vf@latest/latin-wght-italic.woff2 \
 && curl -fsSL -o web/fonts/Inter.woff2 \
      https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@latest/latin-wght-normal.woff2

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 5180
ENV NODE_ENV=production
ENV PORT=5180
ENV HOST=0.0.0.0
ENV DB_PATH=/app/data/meal-planner.sqlite

CMD ["node", "server/index.mjs"]
