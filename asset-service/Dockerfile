FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV ASSET_SERVICE_HOST=0.0.0.0
ENV ASSET_SERVICE_PORT=8100

WORKDIR /service

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /service

USER appuser

EXPOSE 8100

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${ASSET_SERVICE_PORT}/healthz" || exit 1

CMD ["npm", "start"]
