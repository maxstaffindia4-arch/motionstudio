# Phase 0 render spike — Motion Studio transparent-export pipeline.
# Renders engine compositions to ProRes 4444 MOV masters, then derives
# VP9-alpha WebM and composited MP4s with ffmpeg (Motion Lab method).
#
#   docker build -f spikes/render/Dockerfile -t motion-studio-render .
#   docker run --rm -v "$PWD/spikes/render:/work" motion-studio-render
#
# Build context = repo root. No network needed at render time; the image
# is fully self-contained (fonts are warmed into the hyperframes cache at
# build time).

FROM node:22-bookworm-slim

# --- system deps: Chromium runtime libs + ffmpeg/ffprobe ---
# hyperframes drives a headless Chrome; the list mirrors puppeteer/chromium
# requirements for Debian bookworm.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
  && rm -rf /var/lib/apt/lists/*

# --- non-root user ---
RUN useradd -m -u 10001 -s /bin/bash app
ENV HOME=/home/app

# --- hyperframes CLI (pinned to the version verified in Phase 1) ---
RUN npm install -g hyperframes@0.9.59

WORKDIR /work

# Fixtures + scripts are bind-mounted or COPY'd at build time. COPY keeps
# the image self-contained; use a mount for iterative runs instead.
COPY spikes/render/fixtures /work/fixtures
COPY spikes/render/scripts /work/scripts
COPY spikes/render/package.json /work/package.json

# tsx to run the TS scripts (matches repo dev tooling).
RUN npm install --prefix /work --no-audit --no-fund tsx@4.23.15

USER app
WORKDIR /work

# Warm the hyperframes font cache at BUILD time (network available here,
# not at render time): snapshot one fixture so Inter/Montserrat/etc. are
# cached under $HOME/.cache/hyperframes/fonts.
RUN hyperframes snapshot fixtures/text-slam-landscape --at 1 --no-end -o /tmp/fontwarm >/dev/null 2>&1 || true

# Default: render everything, then verify.
#   docker run --rm -v "$PWD/spikes/render/out:/work/out" motion-studio-render
CMD ["sh", "-c", "node /work/node_modules/tsx/dist/cli.mjs scripts/render-all.ts fixtures out && node /work/node_modules/tsx/dist/cli.mjs scripts/verify.ts fixtures out"]
