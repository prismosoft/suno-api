# syntax=docker/dockerfile:1

# Microsoft's Playwright image already holds Chromium 1148 (the revision rebrowser-playwright-core 1.49.1 drives) and its
# system libraries, so no build step downloads a browser.
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS builder
WORKDIR /src
COPY package*.json ./
# The build only needs electron importable (rebrowser-playwright-core references it), never its 100 MB binary from GitHub
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install
COPY . .
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /app
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg

# Disable GPU acceleration, as with it suno-api won't work in a Docker environment
ENV BROWSER_DISABLE_GPU=true
# SUNO_COOKIE comes from the runtime environment only: as a build arg it was written into the build logs and the image.

# The builder's production modules; the browser is in the base image (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright)
COPY package*.json ./
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/.next ./.next
EXPOSE 3000
CMD ["npm", "run", "start"]
