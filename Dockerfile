# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

# Native build deps for `canvas` (cairo/pango/jpeg/gif/rsvg) and node-gyp toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        pkg-config \
        libcairo2-dev \
        libpango1.0-dev \
        libjpeg-dev \
        libgif-dev \
        librsvg2-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime image ----
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TZ=UTC

# Runtime libs only (no -dev packages, no compiler toolchain).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libcairo2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libjpeg62-turbo \
        libgif7 \
        librsvg2-2 \
        tini \
        unzip \
        ca-certificates \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# tera-api default ports: 80 portal, 8040 gateway, 8050 admin, 8080 arbiter.
EXPOSE 80 8040 8050 8080

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "--expose-gc", "--max_old_space_size=8192", "src/app"]
