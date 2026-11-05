# syntax=docker/dockerfile:1

FROM node:lts-bookworm AS builder
WORKDIR /src
COPY package*.json ./
# The build only needs electron importable (rebrowser-playwright-core references it), never its 100 MB binary from GitHub
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
# Also downloads Chromium 1148 (@playwright/browser-chromium), the revision rebrowser-playwright-core drives
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:lts-bookworm
WORKDIR /app

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y libnss3 \
    libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libxkbcommon0 libasound2 libcups2 xvfb ffmpeg

# Disable GPU acceleration, as with it suno-api won't work in a Docker environment
ENV BROWSER_DISABLE_GPU=true
# SUNO_COOKIE comes from the runtime environment only: as a build arg it was written into the build logs and the image.

# The builder's production modules and browser, so this stage downloads nothing
COPY package*.json ./
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /root/.cache/ms-playwright /root/.cache/ms-playwright
COPY --from=builder /src/.next ./.next
EXPOSE 3000
CMD ["npm", "run", "start"]
